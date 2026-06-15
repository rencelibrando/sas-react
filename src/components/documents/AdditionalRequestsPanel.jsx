import { getRequestFiles } from "../../utils/proposalConstants";
import "./AdditionalRequestsPanel.css";

const REQUEST_STATUS_LABEL = {
  pending: "Awaiting response",
  uploaded: "Response received — needs review",
  responded: "Response received — needs review",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/**
 * Reviewer-side panel for raising and managing additional document requests on a
 * proposal. Shared by SAS review (AdminActivityProposals) and ISG assessment
 * (ISGEndorsementPage). All state and actions are owned by the parent page.
 */
const AdditionalRequestsPanel = ({
  requests,
  showAddForm,
  setShowAddForm,
  newLabel,
  setNewLabel,
  newDescription,
  setNewDescription,
  creating,
  error,
  busyId,
  onCreate,
  onResolve,
  onReopen,
  onCancel,
  onPreview,
}) => {
  const sorted = [...requests].sort((a, b) => {
    const order = { pending: 0, responded: 1, uploaded: 1, resolved: 2, cancelled: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  return (
    <div className="additional-requests-section">
      <div className="additional-requests-header">
        <h4 className="actions-section-title">Additional Document Requests</h4>
        {!showAddForm && (
          <button
            type="button"
            className="form-button form-button-secondary"
            onClick={() => setShowAddForm(true)}
          >
            + Request Additional Document
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="additional-request-form">
          <div className="form-group">
            <label className="form-label">Document name *</label>
            <input
              type="text"
              className="filter-input"
              placeholder="e.g. Venue MOA, Parental Consent Forms"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={creating}
              maxLength={120}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description / instructions</label>
            <textarea
              className="filter-input"
              rows={3}
              placeholder="Explain what the organization needs to provide and why."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              disabled={creating}
              maxLength={1000}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="form-button form-button-secondary"
              onClick={() => {
                setShowAddForm(false);
                setNewLabel("");
                setNewDescription("");
              }}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="button"
              className="form-button form-button-primary"
              onClick={onCreate}
              disabled={creating || !newLabel.trim()}
            >
              {creating ? "Sending..." : "Send Request"}
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="additional-requests-empty">
          No additional documents have been requested for this proposal.
        </p>
      ) : (
        <ul className="additional-requests-list">
          {sorted.map((req) => {
            const isOpen =
              req.status === "pending" ||
              req.status === "uploaded" ||
              req.status === "responded";
            const busy = busyId === req.id;
            return (
              <li
                key={req.id}
                className={`additional-request-item status-${req.status}`}
              >
                <div className="additional-request-main">
                  <div className="additional-request-label">{req.label}</div>
                  {req.description && (
                    <p className="additional-request-desc">{req.description}</p>
                  )}
                  <div className="additional-request-status">
                    <span className={`request-status-pill status-${req.status}`}>
                      {REQUEST_STATUS_LABEL[req.status] || req.status}
                    </span>
                  </div>
                  {req.responseText && (
                    <p className="additional-request-reply">
                      <strong>Reply:</strong> {req.responseText}
                    </p>
                  )}
                  {getRequestFiles(req).map((f, i) => (
                    <div key={i} className="additional-request-file">
                      <button
                        type="button"
                        className="file-download-link file-preview-btn"
                        onClick={() => onPreview(req, f, i)}
                      >
                        📄 {f.fileName}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="additional-request-actions">
                  {isOpen && (
                    <button
                      type="button"
                      className="form-button form-button-primary"
                      onClick={() => onResolve(req.id)}
                      disabled={busy}
                    >
                      {busy ? "..." : "Mark Resolved"}
                    </button>
                  )}
                  {req.status === "resolved" && (
                    <button
                      type="button"
                      className="form-button form-button-secondary"
                      onClick={() => onReopen(req.id)}
                      disabled={busy}
                    >
                      {busy ? "..." : "Reopen"}
                    </button>
                  )}
                  {isOpen && (
                    <button
                      type="button"
                      className="form-button form-button-secondary"
                      onClick={() => onCancel(req.id)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AdditionalRequestsPanel;
