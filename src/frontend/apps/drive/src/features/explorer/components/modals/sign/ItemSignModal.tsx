import {
  Button,
  Modal,
  ModalSize,
  removeFileExtension,
} from "@gouvfr-lasuite/ui-components";
import { useRouter } from "next/router";
import { KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Item, User } from "@/features/drivers/types";
import { useAuth } from "@/features/auth/Auth";
import { useUsers } from "@/features/users/hooks/useUserQueries";

export interface ItemSignModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
}

export const ItemSignModal = ({ isOpen, onClose, item }: ItemSignModalProps) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { user: currentUser } = useAuth();

  const [signers, setSigners] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Search registered users as the user types
  const { data: searchResults, isLoading: isSearching } = useUsers(
    { q: inputValue },
    {
      enabled: inputValue.trim().length >= 2,
      placeholderData: (prev: User[] | undefined) => prev,
    },
  );

  const filteredSuggestions = useMemo(() => {
    if (!searchResults) return [];
    return searchResults.filter(
      (u: User) => !signers.includes(u.email.toLowerCase()) && u.email.toLowerCase() !== currentUser?.email?.toLowerCase(),
    );
  }, [searchResults, signers, currentUser]);

  const addSigner = (emailToAdd: string) => {
    const trimmed = emailToAdd.trim().toLowerCase();
    if (!trimmed) return;
    // Simple email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return;
    }
    if (!signers.includes(trimmed)) {
      setSigners((prev) => [...prev, trimmed]);
    }
    setInputValue("");
    setShowSuggestions(false);
  };

  const removeSigner = (emailToRemove: string) => {
    setSigners((prev) => prev.filter((e) => e !== emailToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSigner(inputValue);
    }
  };

  const handleSignMyself = () => {
    sessionStorage.removeItem("sign_invitees");
    onClose();
    router.push(`/explorer/items/files/${item.id}?mode=selfsign`);
  };

  const handleContinue = () => {
    if (signers.length === 0) return;
    sessionStorage.setItem("sign_invitees", JSON.stringify(signers));
    onClose();
    router.push(`/explorer/items/files/${item.id}?mode=requestsign`);
  };


  const fileName = removeFileExtension(item.title);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={ModalSize.MEDIUM}
      title={t("sign_modal.title", { title: fileName, defaultValue: `Faire signer : ${fileName}` })}
      aria-label="Sign modal"
      rightActions={
        <>
          <Button variant="bordered" onClick={onClose}>
            {t("sign_modal.cancel", "Annuler")}
          </Button>
          <Button
            color="brand"
            disabled={signers.length === 0}
            onClick={handleContinue}
          >
            {t("sign_modal.continue", "Continuer vers le document")}
          </Button>
        </>
      }
    >
      <div className="sign-modal-content">
        {/* Section 1: Sign myself */}
        <div className="sign-modal-section sign-modal-section--self">
          <div className="sign-modal-section__header">
            <span className="sign-modal-section__title">
              {t("sign_modal.self_section_title", "Vous devez signer ce document vous-même ?")}
            </span>
          </div>
          <Button
            variant="secondary"
            color="brand"
            onClick={handleSignMyself}
            icon={<span className="material-icons">draw</span>}
          >
            {t("sign_modal.self_button", "Signer le document moi-même")}
          </Button>
        </div>

        {/* Divider */}
        <div className="sign-modal-divider">
          <span>{t("sign_modal.or", "ou faire signer par d'autres personnes")}</span>
        </div>

        {/* Section 2: Request signatures from others */}
        <div className="sign-modal-section">
          <div className="sign-modal-section__header">
            <span className="sign-modal-section__title">
              {t("sign_modal.request_section_title", "Inviter des personnes à signer ce document")}
            </span>
            <p className="sign-modal-section__desc">
              {t("sign_modal.request_section_desc", "Renseignez les adresses email des personnes qui doivent signer :")}
            </p>
          </div>

          {/* Email input + Add button */}
          <div className="sign-modal-input-row">
            <div className="sign-modal-input-wrapper">
              <input
                type="email"
                className="sign-modal-input"
                placeholder={t("sign_modal.input_placeholder", "Adresse email (ex : nom@exemple.fr)")}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
              />

              {/* Autocomplete suggestions dropdown */}
              {showSuggestions && inputValue.trim().length >= 2 && (
                <div className="sign-modal-suggestions">
                  {isSearching && (
                    <div className="sign-modal-suggestions__item sign-modal-suggestions__item--loading">
                      Recherche...
                    </div>
                  )}
                  {!isSearching && filteredSuggestions.length === 0 && (
                    <div
                      className="sign-modal-suggestions__item"
                      onClick={() => addSigner(inputValue)}
                    >
                      <span className="material-icons">mail</span>
                      <span>Ajouter &quot;{inputValue.trim()}&quot;</span>
                    </div>
                  )}
                  {filteredSuggestions.map((user: User) => (
                    <div
                      key={user.id}
                      className="sign-modal-suggestions__item"
                      onClick={() => addSigner(user.email)}
                    >
                      <span className="material-icons">person</span>
                      <div className="sign-modal-suggestions__user-info">
                        <strong>{user.full_name || user.email}</strong>
                        {user.full_name && <small>{user.email}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              variant="secondary"
              color="brand"
              onClick={() => addSigner(inputValue)}
              disabled={!inputValue.trim()}
            >
              {t("sign_modal.add_button", "Ajouter")}
            </Button>
          </div>

          {/* Added Signers List */}
          <div className="sign-modal-signers">
            <div className="sign-modal-signers__title">
              {t("sign_modal.signers_title", {
                count: signers.length,
                defaultValue: `Signataires à inviter (${signers.length})`,
              })}
            </div>

            {signers.length === 0 ? (
              <div className="sign-modal-signers__empty">
                <span className="material-icons">group_add</span>
                <p>
                  {t(
                    "sign_modal.no_signers",
                    "Aucun signataire ajouté. Saisissez une adresse email ci-dessus et cliquez sur Ajouter.",
                  )}
                </p>
              </div>
            ) : (
              <div className="sign-modal-signers__list">
                {signers.map((email) => (
                  <div key={email} className="sign-modal-signer-item">
                    <div className="sign-modal-signer-item__info">
                      <span className="material-icons sign-modal-signer-item__avatar">
                        account_circle
                      </span>
                      <span className="sign-modal-signer-item__email">{email}</span>
                    </div>
                    <div className="sign-modal-signer-item__actions">
                      <span className="sign-modal-role-badge">
                        {t("sign_modal.role_signer", "Signataire")}
                      </span>
                      <button
                        type="button"
                        className="sign-modal-remove-btn"
                        onClick={() => removeSigner(email)}
                        title={t("sign_modal.remove_signer", "Supprimer")}
                        aria-label={t("sign_modal.remove_signer", "Supprimer")}
                      >
                        <span className="material-icons">close</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
