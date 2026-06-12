import PrivacyPolicyContent from "../components/PrivacyPolicyContent";
import "./PrivacyPolicyPage.css";

const goBack = () => {
  window.dispatchEvent(new CustomEvent("pageNavigate", { detail: "home" }));
  window.dispatchEvent(new CustomEvent("adminNavigate", { detail: "dashboard" }));
};

const PrivacyPolicyPage = () => (
  <div className="privacy-policy-page">
    <div className="privacy-policy-card">
      <header className="privacy-policy-header">
        <h1>Privacy Notice</h1>
        <p>EARIST Student Affairs System (SAS) Portal</p>
      </header>
      <PrivacyPolicyContent />
      <div className="privacy-policy-actions">
        <button type="button" className="privacy-back-button" onClick={goBack}>
          Back
        </button>
      </div>
    </div>
  </div>
);

export default PrivacyPolicyPage;
