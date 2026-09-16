import { Item, ItemType } from "@/features/drivers/types";
import {
  FilePreview,
  FilePreviewType,
  Button,
  useModal,
} from "@gouvfr-lasuite/ui-components";
import { useTranslation } from "react-i18next";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";
import posthog from "posthog-js";
import { itemToPreviewFile } from "@/features/explorer/utils/utils";
import { useDownloadItem } from "@/features/items/hooks/useDownloadItem";
import { ItemInfo } from "@/features/items/components/ItemInfo";
import { ItemShareModal } from "@/features/explorer/components/modals/share/ItemShareModal";
import { ItemSignModal } from "@/features/explorer/components/modals/sign/ItemSignModal";
import { openWopiInNewTab } from "@/features/wopi/openWopi";
import { useAuth } from "@/features/auth/Auth";
import { AnonymousCTA } from "../components/anonymous-cta/AnonymousCTA";
import { MyFilesCTA } from "../components/my-files-cta/MyFilesCTA";
import {
  SignZone,
  SignZoneOverlayManager,
} from "@/features/explorer/components/modals/sign/SignZoneOverlayManager";
import {
  useMutationCreateSignRequests,
  useMutationExecuteSign,
  useMutationDeclineSign,
} from "@/features/explorer/hooks/useMutationsAccesses";
import { DeclineSignModal } from "@/features/explorer/components/modals/sign/DeclineSignModal";
import { useRouter } from "next/router";

export enum CustomFilesPreviewMode {
  // The actions header will be the default actions header.
  DEFAULT = "default",
  // The actions header will be contextual to the authentication status of the user.
  CONTEXTUAL = "contextual",
}

export type SignMode = "selfsign" | "requestsign" | "sign";

type CustomFilesPreviewProps = {
  currentItem?: Item;
  items: Item[];
  setPreviewItem?: (item?: Item) => void;
  onClose?: () => void;
  mode?: CustomFilesPreviewMode;
  isSignMode?: boolean;
  signMode?: SignMode;
};

export const CustomFilesPreview = ({
  currentItem,
  items,
  setPreviewItem,
  onClose,
  mode = CustomFilesPreviewMode.DEFAULT,
  isSignMode = false,
  signMode,
}: CustomFilesPreviewProps) => {
  const { handleDownloadItem } = useDownloadItem();
  const { user } = useAuth();
  const router = useRouter();
  const [signZone, setSignZone] = useState<SignZone | null>(null);

  // Always reset zone placement when switching documents or modes
  useEffect(() => {
    setSignZone(null);
  }, [currentItem?.id, signMode]);

  const files = useMemo(() => {
    return items
      .filter((item) => item.type === ItemType.FILE)
      .map(itemToPreviewFile);
  }, [items]);

  const handleClosePreview = () => {
    if (onClose) {
      onClose();
    } else if (setPreviewItem) {
      setPreviewItem(undefined);
    } else {
      if (window.history.length > 1) {
        router.back();
      } else if ((currentItem as any)?.parentId) {
        router.push(`/explorer/items/${(currentItem as any).parentId}`);
      } else if (currentItem?.sign_status === "waiting") {
        router.push("/explorer/items/shared-with-me");
      } else {
        router.push("/explorer/items/my-files");
      }
    }
  };

  const handleChangePreviewItem = (file?: FilePreviewType) => {
    const item = items.find((item) => file?.id === item.id);
    setPreviewItem?.(item);
  };

  const effectiveSignMode: SignMode | undefined =
    signMode ||
    (isSignMode
      ? "selfsign"
      : currentItem?.sign_status === "waiting" && currentItem?.abilities?.can_sign
      ? "sign"
      : undefined);

  const effectiveIsSignMode = isSignMode || !!effectiveSignMode;

  // If item has an attached sign_request, compute fixedZone
  const fixedZone: SignZone | null = useMemo(() => {
    if (!currentItem?.sign_request) return null;
    return {
      pageIndex: currentItem.sign_request.zone_page,
      xPct: currentItem.sign_request.zone_x,
      yPct: currentItem.sign_request.zone_y,
      widthPct: currentItem.sign_request.zone_width,
      heightPct: currentItem.sign_request.zone_height,
    };
  }, [currentItem?.sign_request]);

  const signerDisplayName = useMemo(() => {
    if (effectiveSignMode === "selfsign") {
      return (user as any)?.full_name || user?.email || "";
    }
    if (effectiveSignMode === "sign") {
      return (user as any)?.full_name || currentItem?.sign_request?.signer_name || user?.email || "";
    }
    return "";

  }, [effectiveSignMode, user, currentItem?.sign_request]);

  const isLockedFile = !!(effectiveIsSignMode || currentItem?.sign_status);

  return (
    <>
      <FilePreview
        isOpen={!!currentItem}
        onClose={handleClosePreview}
        files={files}
        onChangeFile={handleChangePreviewItem}
        handleDownloadFile={() => handleDownloadItem(currentItem)}
        openedFileId={currentItem?.id}
        onFileOpen={(file) =>
          posthog.capture("file_preview_opened", {
            id: file.id,
            size: file.size,
            mimetype: file.mimetype,
          })
        }
        onOpenInEditor={isLockedFile ? undefined : openWopiInNewTab}
        customHeaderActions={(actions) => (
          <CustomFilesPreviewRightHeader
            currentItem={currentItem}
            mode={mode}
            isSignMode={effectiveIsSignMode}
            signMode={effectiveSignMode}
            signZone={signZone}
          >
            {actions}
          </CustomFilesPreviewRightHeader>
        )}
        sidebarContent={currentItem && <ItemInfo item={currentItem} />}
      />
      <SignZoneOverlayManager
        isSignMode={effectiveIsSignMode}
        signMode={effectiveSignMode}
        currentItemId={currentItem?.id}
        fixedZone={fixedZone}
        signerDisplayName={signerDisplayName}
        onZoneChange={setSignZone}
      />
    </>
  );
};

type CustomFilesPreviewRightHeaderProps = {
  currentItem?: Item;
  mode: CustomFilesPreviewMode;
  isSignMode?: boolean;
  signMode?: SignMode;
  signZone?: SignZone | null;
  children: React.ReactNode;
};

const CustomFilesPreviewRightHeader = ({
  children,
  currentItem,
  mode,
  isSignMode,
  signMode,
  signZone,
}: CustomFilesPreviewRightHeaderProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const shareModal = useModal();
  const signModal = useModal();
  const { mutateAsync: createSignRequests } = useMutationCreateSignRequests();
  const { mutateAsync: executeSign } = useMutationExecuteSign();
  const { mutateAsync: declineSign } = useMutationDeclineSign();
  const router = useRouter();

  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!currentItem) {
    return null;
  }

  const storedInvitees =
    typeof window !== "undefined"
      ? sessionStorage.getItem("sign_invitees")
      : null;
  const signers: string[] = storedInvitees ? JSON.parse(storedInvitees) : [];

  const handleSelfSign = async () => {
    if (!signZone) return;
    setIsSubmitting(true);
    try {
      await createSignRequests({
        itemId: currentItem.id,
        signers: [user?.email ?? ""],
        zone: signZone,
        is_self_sign: true,
      });
      sessionStorage.removeItem("sign_invitees");
      if ((currentItem as any).parentId) {
        router.push(`/explorer/items/${(currentItem as any).parentId}`);
      } else {
        router.push("/explorer/items/my-files");
      }
    } catch (err) {
      console.error("Failed to self-sign document", err);
      alert(t("sign_viewer.error_create", "Une erreur est survenue lors de la signature du document."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendRequests = async () => {
    if (!signZone) return;
    setIsSubmitting(true);
    try {
      const currentStored =
        typeof window !== "undefined"
          ? sessionStorage.getItem("sign_invitees")
          : null;
      const targetSigners: string[] = currentStored
        ? JSON.parse(currentStored)
        : signers;

      if (!targetSigners || targetSigners.length === 0) {
        alert(t("sign_viewer.no_signers", "Aucun signataire spécifié."));
        return;
      }

      await createSignRequests({
        itemId: currentItem.id,
        signers: targetSigners,
        zone: signZone,
        is_self_sign: false,
      });
      sessionStorage.removeItem("sign_invitees");
      if ((currentItem as any).parentId) {
        router.push(`/explorer/items/${(currentItem as any).parentId}`);
      } else {
        router.push("/explorer/items/my-files");
      }
    } catch (err) {
      console.error("Failed to send sign requests", err);
      alert(t("sign_viewer.error_create", "Une erreur est survenue lors de l'envoi de la demande de signature."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExecuteSign = async () => {
    setIsSubmitting(true);
    try {
      await executeSign({ itemId: currentItem.id });
      router.push("/explorer/items/shared-with-me");
    } catch (err) {
      console.error("Failed to sign document", err);
      alert("Une erreur est survenue lors de la signature.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDecline = async (reason?: string) => {
    setIsSubmitting(true);
    try {
      await declineSign({ itemId: currentItem.id, reason });
      setIsDeclineModalOpen(false);
      router.push("/explorer/items/shared-with-me");
    } catch (err) {
      console.error("Failed to decline sign request", err);
      alert("Une erreur est survenue lors du refus de la signature.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      {/* Mode A / Option C: Self sign */}
      {isSignMode && signMode === "selfsign" && (
        <Button
          color="brand"
          icon={<span className="material-icons">draw</span>}
          disabled={!signZone || isSubmitting}
          onClick={handleSelfSign}
        >
          {signZone
            ? t("sign_viewer.self_sign_btn", "Signer le document")
            : t("sign_viewer.place_zone", "Cliquez sur le document pour placer la zone")}
        </Button>
      )}

      {/* Mode A / Option D: Request signatures from others */}
      {isSignMode && signMode === "requestsign" && (
        <Button
          color="brand"
          icon={<span className="material-icons">send</span>}
          disabled={!signZone || isSubmitting}
          onClick={handleSendRequests}
        >
          {signZone
            ? t("sign_viewer.send_requests_btn", {
                count: signers.length,
                defaultValue: `Envoyer la demande${signers.length > 0 ? ` (${signers.length})` : ""}`,
              })
            : t("sign_viewer.place_zone", "Cliquez sur le document pour placer la zone")}
        </Button>
      )}

      {/* Mode B: Recipient signing or declining */}
      {isSignMode && signMode === "sign" && (
        <>
          <Button
            variant="bordered"
            disabled={isSubmitting}
            onClick={() => setIsDeclineModalOpen(true)}
          >
            {t("sign_viewer.recipient_decline_btn", "Refuser")}
          </Button>
          <Button
            color="brand"
            icon={<span className="material-icons">check</span>}
            disabled={isSubmitting}
            onClick={handleExecuteSign}
          >
            {t("sign_viewer.recipient_sign_btn", "Signer le document")}
          </Button>

          <DeclineSignModal
            isOpen={isDeclineModalOpen}
            onClose={() => setIsDeclineModalOpen(false)}
            isLoading={isSubmitting}
            onConfirm={handleConfirmDecline}
          />
        </>
      )}

      {/* Default share button (when not in sign mode) */}
      {!isSignMode && mode === CustomFilesPreviewMode.DEFAULT && !currentItem.sign_status && (
        <>
          <div className="custom-files-preview-right-header">
            <Button variant="tertiary" onClick={shareModal.open}>
              {t("explorer.rightPanel.share")}
            </Button>
          </div>

          {shareModal.isOpen && (
            <ItemShareModal {...shareModal} item={currentItem} />
          )}
        </>
      )}

      {/* Sign / Request signatures button when viewing file that is signable */}
      {!isSignMode && currentItem?.abilities?.can_sign && currentItem?.sign_status !== "waiting" && (
        <>
          <div className="custom-files-preview-right-header">
            <Button
              variant="tertiary"
              icon={<span className="material-icons">draw</span>}
              onClick={signModal.open}
            >
              {t("explorer.item.actions.sign", "Signer")}
            </Button>
          </div>

          {signModal.isOpen && (
            <ItemSignModal {...signModal} item={currentItem} />
          )}
        </>
      )}

      {children}

      {mode === CustomFilesPreviewMode.CONTEXTUAL && (
        <div className="custom-files-preview-right-header">
          {user ? <MyFilesCTA /> : <AnonymousCTA />}
        </div>
      )}
    </div>
  );
};
