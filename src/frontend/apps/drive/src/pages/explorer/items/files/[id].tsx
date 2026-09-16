import { GenericDisclaimer } from "@/features/ui/components/generic-disclaimer/GenericDisclaimer";
import { SpinnerPage } from "@/features/ui/components/spinner/SpinnerPage";
import {
  CustomFilesPreview,
  CustomFilesPreviewMode,
} from "@/features/ui/preview/CustomFilesPreview";
import { Icon, Button } from "@gouvfr-lasuite/ui-components";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import { useItem } from "@/features/explorer/hooks/useQueries";
import { GlobalLayout } from "@/features/layouts/components/global/GlobalLayout";

export default function FilePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const itemId = router.query.id as string;

  const { data: item, isLoading, error } = useItem(itemId);

  // On 403, 401, the user is automatically redirected to the 401/403 page.

  // If the error is a 401 or 403, we want to show the spinner page because an auto redirect is happening.
  if (isLoading || (error && [401, 403].includes(error.code))) {
    return <SpinnerPage />;
  }

  // Can happen if the file is deleted.
  if (!item) {
    return (
      <GenericDisclaimer
        message={t("explorer.files.not_found.description")}
        imageSrc="/assets/403-background.png"
      >
        <Button href="/" icon={<Icon name="home" />}>
          {t("403.button")}
        </Button>
      </GenericDisclaimer>
    );
  }

  const signMode =
    router.query.mode === "selfsign" ||
    router.query.mode === "requestsign" ||
    router.query.mode === "sign"
      ? (router.query.mode as "selfsign" | "requestsign" | "sign")
      : undefined;

  const handleClose = () => {
    if (window.history.length > 1) {
      router.back();
    } else if (item.parents && item.parents.length > 0) {
      const directParent = item.parents[item.parents.length - 1];
      router.push(`/explorer/items/${directParent.id}`);
    } else if (item.sign_status === "waiting") {
      router.push("/explorer/items/shared-with-me");
    } else {
      router.push("/explorer/items/my-files");
    }
  };

  return (
    <div>
      <CustomFilesPreview
        currentItem={item}
        items={[item]}
        mode={CustomFilesPreviewMode.CONTEXTUAL}
        isSignMode={!!signMode}
        signMode={signMode}
        onClose={handleClose}
      />
    </div>
  );

}

FilePage.getLayout = function getLayout(page: React.ReactElement) {
  return <GlobalLayout>{page}</GlobalLayout>;
};
