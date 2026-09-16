import { Button, Modal, ModalSize } from "@gouvfr-lasuite/ui-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface DeclineSignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
  isLoading?: boolean;
}

export const DeclineSignModal = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: DeclineSignModalProps) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={ModalSize.SMALL}
      title={t("decline_sign_modal.title", "Refuser de signer le document")}
      rightActions={
        <>
          <Button variant="bordered" onClick={onClose} disabled={isLoading}>
            {t("decline_sign_modal.cancel", "Annuler")}
          </Button>
          <Button
            color="error"
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
          >
            {t("decline_sign_modal.confirm", "Confirmer le refus")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" }}>
        <p style={{ margin: 0, color: "#3a3a3a", fontSize: "0.95rem" }}>
          {t(
            "decline_sign_modal.description",
            "Êtes-vous sûr de vouloir refuser de signer ce document ? L'émetteur en sera informé et le document sera marqué comme refusé.",
          )}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            htmlFor="decline-reason"
            style={{ fontSize: "0.85rem", fontWeight: 600, color: "#161616" }}
          >
            {t("decline_sign_modal.reason_label", "Motif du refus (optionnel)")}
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(
              "decline_sign_modal.reason_placeholder",
              "Indiquez la raison de votre refus si vous le souhaitez...",
            )}
            rows={3}
            style={{
              padding: "8px 12px",
              border: "1px solid #cecece",
              borderRadius: "4px",
              resize: "vertical",
              fontFamily: "inherit",
              fontSize: "0.9rem",
            }}
          />
        </div>
      </div>
    </Modal>
  );
};
