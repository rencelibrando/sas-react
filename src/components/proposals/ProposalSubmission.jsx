import { useState } from "react";
import { auth } from "../../config/firebase";
import { submitActivityProposal } from "../../services/documentService";
import {
  REQUIREMENT_KEYS,
  REQUIREMENT_LABELS,
  getRequiredKeys,
  isConditionalKey,
  isISGSubmitter,
} from "../../utils/proposalConstants";
import "../../styles/colors.css";
import "./ProposalSubmission.css";

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ProposalSubmission = ({ onSuccess, onCancel, organizationId, orgType }) => {
  const isISG = isISGSubmitter(orgType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [activityEndDate, setActivityEndDate] = useState("");
  const [proposalFlags, setProposalFlags] = useState({
    hasSpeakers: false,
    collectsFees: false,
  });
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const requiredKeys = getRequiredKeys(proposalFlags, { isISG });
  const uploadedCount = requiredKeys.filter((k) => uploadedFiles[k]).length;
  const isComplete =
    uploadedCount === requiredKeys.length && title.trim() && activityDate;

  const handleFlagChange = (flag) => {
    const next = { ...proposalFlags, [flag]: !proposalFlags[flag] };
    setProposalFlags(next);
    // Remove file for the key that just became optional
    const nowRequired = getRequiredKeys(next);
    setUploadedFiles((prev) => {
      const cleaned = { ...prev };
      for (const key of Object.keys(cleaned)) {
        if (isConditionalKey(key) && !nowRequired.includes(key)) {
          delete cleaned[key];
        }
      }
      return cleaned;
    });
  };

  const handleFileSelect = (requirementKey, file) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(
        `Invalid file type for "${REQUIREMENT_LABELS[requirementKey]}". Upload PDF or Word (.pdf, .doc, .docx).`
      );
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(
        `File too large: "${REQUIREMENT_LABELS[requirementKey]}". Maximum 50 MB.`
      );
      return;
    }
    setError("");
    setUploadedFiles((prev) => ({ ...prev, [requirementKey]: file }));
  };

  const handleFileRemove = (requirementKey) => {
    setUploadedFiles((prev) => {
      const next = { ...prev };
      delete next[requirementKey];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Please enter a proposal title.");
      return;
    }
    if (!activityDate) {
      setError("Please select the activity date.");
      return;
    }
    if (activityEndDate && activityEndDate < activityDate) {
      setError("Activity end date cannot be earlier than the start date.");
      return;
    }
    if (uploadedCount < requiredKeys.length) {
      setError(
        `Please upload all required documents. ${uploadedCount} of ${requiredKeys.length} uploaded.`
      );
      return;
    }

    const user = auth.currentUser;
    if (!user || !organizationId) {
      setError("Session expired. Please refresh and try again.");
      return;
    }

    setLoading(true);
    setUploadStatus(`Uploading documents (0 / ${Object.keys(uploadedFiles).length})…`);

    try {
      await submitActivityProposal(
        {
          title,
          description,
          activityDate,
          activityEndDate: activityEndDate || null,
          proposalFlags,
          submitterRole: orgType || null,
        },
        uploadedFiles,
        user.uid,
        organizationId
      );

      setUploadStatus("");
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message || "Failed to submit proposal. Please try again.");
      setUploadStatus("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="proposal-submission">
      <div className="proposal-submission-header">
        <h2>Submit New Activity Proposal</h2>
        {onCancel && (
          <button type="button" className="close-button" onClick={onCancel}>
            ×
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="proposal-submission-form">
        {error && <div className="form-error">{error}</div>}

        {/* ── Section 1: Proposal Information ──────────────────── */}
        <div className="form-section">
          <h3 className="form-section-title">1. Proposal Information</h3>

          <div className="form-group">
            <label htmlFor="title" className="form-label">
              Activity / Event Title <span className="required">*</span>
            </label>
            <input
              type="text"
              id="title"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter the name of your activity or event"
              maxLength={200}
              disabled={loading}
            />
            <span className="form-hint">{title.length}/200 characters</span>
          </div>

          <div className="form-group">
            <label htmlFor="description" className="form-label">
              Description
            </label>
            <textarea
              id="description"
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe the nature and objectives of the activity…"
              rows={4}
              maxLength={1000}
              disabled={loading}
            />
            <span className="form-hint">
              {description.length}/1000 characters
            </span>
          </div>

          <div className="form-group form-group--row">
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="activityDate" className="form-label">
                Activity Date <span className="required">*</span>
              </label>
              <input
                type="date"
                id="activityDate"
                className="form-input"
                value={activityDate}
                onChange={(e) => setActivityDate(e.target.value)}
                disabled={loading}
              />
              <span className="form-hint">
                Used to schedule post-activity report deadlines.
              </span>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="activityEndDate" className="form-label">
                Activity End Date
              </label>
              <input
                type="date"
                id="activityEndDate"
                className="form-input"
                value={activityEndDate}
                onChange={(e) => setActivityEndDate(e.target.value)}
                min={activityDate || undefined}
                disabled={loading}
              />
              <span className="form-hint">
                Optional — leave blank for single-day events.
              </span>
            </div>
          </div>

        </div>

        {/* ── Section 2: Event Type ─────────────────────────────── */}
        <div className="form-section">
          <h3 className="form-section-title">2. Event Type</h3>
          <p className="form-section-hint">
            Check all that apply — this determines which supporting documents
            are required.
          </p>

          <div className="flag-options">
            <label className="flag-option">
              <input
                type="checkbox"
                checked={proposalFlags.hasSpeakers}
                onChange={() => handleFlagChange("hasSpeakers")}
                disabled={loading}
              />
              <span className="flag-label">
                This event involves speakers or facilitators
                <span className="flag-sublabel">
                  Adds: Profile of Speakers/Facilitators
                </span>
              </span>
            </label>

            <label className="flag-option">
              <input
                type="checkbox"
                checked={proposalFlags.collectsFees}
                onChange={() => handleFlagChange("collectsFees")}
                disabled={loading}
              />
              <span className="flag-label">
                This event will collect registration / participation fees
                <span className="flag-sublabel">
                  Adds: Resolution on fee collection + minutes of meeting
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* ── Section 3: Required Documents ────────────────────── */}
        <div className="form-section">
          <div className="checklist-header">
            <h3 className="form-section-title">3. Required Documents</h3>
            <span
              className={`checklist-progress ${
                isComplete ? "checklist-progress--done" : ""
              }`}
            >
              {uploadedCount} / {requiredKeys.length} uploaded
            </span>
          </div>
          <p className="form-section-hint">
            All listed documents must be uploaded before submitting. PDF or
            Word files only, max 50 MB each.
          </p>

          <div className="requirement-list">
            {REQUIREMENT_KEYS.map((key) => {
              const isRequired = requiredKeys.includes(key);
              const isConditional = isConditionalKey(key);
              const file = uploadedFiles[key];

              if (isConditional && !isRequired) return null;

              return (
                <div
                  key={key}
                  className={`requirement-row ${file ? "requirement-row--done" : ""} ${isConditional ? "requirement-row--conditional" : ""}`}
                >
                  <div className="requirement-status">
                    {file ? (
                      <span className="req-icon req-icon--done">✓</span>
                    ) : (
                      <span className="req-icon req-icon--empty" />
                    )}
                  </div>

                  <div className="requirement-info">
                    <span className="requirement-label">
                      {REQUIREMENT_LABELS[key]}
                    </span>
                    {isConditional && (
                      <span className="badge-conditional">conditional</span>
                    )}
                  </div>

                  <div className="requirement-upload">
                    {file ? (
                      <>
                        <span className="file-name-display" title={file.name}>
                          {file.name.length > 30
                            ? `${file.name.substring(0, 28)}…`
                            : file.name}
                        </span>
                        <button
                          type="button"
                          className="btn-remove-file"
                          onClick={() => handleFileRemove(key)}
                          disabled={loading}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="file"
                          id={`file-${key}`}
                          className="file-input-hidden"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) =>
                            handleFileSelect(key, e.target.files[0])
                          }
                          disabled={loading}
                        />
                        <label
                          htmlFor={`file-${key}`}
                          className="btn-upload-file"
                        >
                          Upload
                        </label>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="form-actions">
          {uploadStatus && (
            <span className="upload-status">{uploadStatus}</span>
          )}
          {onCancel && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !isComplete}
          >
            {loading ? "Submitting…" : "Submit Proposal"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProposalSubmission;
