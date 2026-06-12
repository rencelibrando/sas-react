import { useState } from "react";
import PrivacyPolicyContent from "./PrivacyPolicyContent";
import "../pages/PrivacyPolicyPage.css";

/**
 * First-login privacy-consent gate. Shown when the signed-in user's Firestore
 * doc is missing `privacyConsentAt`. The whole app is blocked behind this
 * overlay until the user accepts (recording consent) or declines (signed out).
 */
const ConsentModal = ({ onAccept, onDecline }) => {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    try {
      await onAccept();
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    setBusy(true);
    try {
      await onDecline();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="consent-modal-overlay" role="dialog" aria-modal="true">
      <div className="consent-modal">
        <header className="consent-modal-header">
          <h2>Privacy Notice & Consent</h2>
          <p>Please review and accept to continue using the portal.</p>
        </header>
        <div className="consent-modal-body">
          <PrivacyPolicyContent />
        </div>
        <div className="consent-modal-actions">
          <button
            type="button"
            className="consent-decline"
            onClick={handleDecline}
            disabled={busy}
          >
            Decline & sign out
          </button>
          <button
            type="button"
            className="consent-accept"
            onClick={handleAccept}
            disabled={busy}
          >
            {busy ? "Saving..." : "I agree"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentModal;
