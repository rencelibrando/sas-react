import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import {
  searchDocuments,
  getDocumentById,
  getDocumentStatusHistory,
  releaseDocument,
  createOutgoingDocument
} from "../services/documentService";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal";
import { formatDate, formatDateTime, getStatusBadgeClass, getStatusLabel } from "../utils/formatters";
import "../styles/colors.css";
import "./AdminMemorandums.css";

const AdminMemorandums = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [memorandums, setMemorandums] = useState([]);
  const [enrichedMemorandums, setEnrichedMemorandums] = useState([]);
  const [selectedMemorandum, setSelectedMemorandum] = useState(null);
  const [selectedHistory, setSelectedHistory] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [previewMemo, setPreviewMemo] = useState(null);

  const emptyForm = {
    orderNumber: "",
    subject: "",
    description: "",
    file: null
  };
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
        await loadMemorandums();
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMemorandums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const loadMemorandums = async () => {
    try {
      setLoading(true);
      const filters = {
        direction: "outgoing",
        documentType: "Memorandum"
      };
      if (filterStatus !== "all") filters.status = filterStatus;

      const docs = await searchDocuments(filters);
      const memosOnly = docs.filter((d) => d.documentType === "Memorandum");
      setMemorandums(memosOnly);
      const enriched = await enrichWithUsernames(memosOnly);
      setEnrichedMemorandums(enriched);
    } catch (err) {
      console.error("Error loading memorandums:", err);
      setError("Failed to load memorandums");
    } finally {
      setLoading(false);
    }
  };

  const enrichWithUsernames = async (docs) => {
    return Promise.all(
      docs.map(async (memo) => {
        const enriched = { ...memo };
        if (memo.createdBy) {
          try {
            const u = await getUserById(memo.createdBy);
            enriched.createdByName = u?.fullName || u?.email || "Unknown";
          } catch {
            enriched.createdByName = "Unknown";
          }
        }
        if (memo.releasedBy) {
          try {
            const u = await getUserById(memo.releasedBy);
            enriched.releasedByName = u?.fullName || u?.email || "Unknown";
          } catch {
            enriched.releasedByName = "Unknown";
          }
        }
        return enriched;
      })
    );
  };

  const handleViewDetails = async (documentId) => {
    try {
      setLoading(true);
      const memo = await getDocumentById(documentId);
      const [enriched] = await enrichWithUsernames([memo]);
      setSelectedMemorandum(enriched);

      const history = await getDocumentStatusHistory(documentId);
      const enrichedHistory = await Promise.all(
        history.map(async (entry) => {
          if (entry.changedBy) {
            try {
              const u = await getUserById(entry.changedBy);
              return { ...entry, changedByName: u?.fullName || u?.email || "Unknown" };
            } catch {
              return { ...entry, changedByName: "Unknown" };
            }
          }
          return { ...entry, changedByName: "Unknown" };
        })
      );
      setSelectedHistory(enrichedHistory);
      setShowDetailModal(true);
    } catch (err) {
      console.error("Error loading memorandum details:", err);
      setError("Failed to load memorandum details");
    } finally {
      setLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!selectedMemorandum) return;
    if (!window.confirm("Release this memorandum? All organizations will be able to see it. This cannot be undone.")) {
      return;
    }
    try {
      setLoading(true);
      setError("");
      await releaseDocument(selectedMemorandum.documentId, auth.currentUser.uid);
      setSuccess("Memorandum released successfully");
      setShowReleaseModal(false);
      await loadMemorandums();
    } catch (err) {
      setError(err.message || "Failed to release memorandum");
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setFormData(emptyForm);
    setFormError("");
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setFormData(emptyForm);
    setFormError("");
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setFormData((prev) => ({ ...prev, file }));
  };

  const handleSubmitMemorandum = async (e) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("User not authenticated");

      await createOutgoingDocument(
        {
          documentType: "Memorandum",
          title: formData.subject,
          description: formData.description,
          orderNumber: formData.orderNumber
        },
        formData.file,
        user.uid
      );

      setSuccess("Memorandum created successfully");
      closeAddModal();
      await loadMemorandums();
    } catch (err) {
      console.error("Error creating memorandum:", err);
      setFormError(err.message || "Failed to create memorandum. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout userData={userData} currentPage="memorandums">
      {loading && !memorandums.length ? (
        <LoadingScreen compact={true} />
      ) : (
        <div className="admin-memorandums">
          <div className="admin-memorandums-header">
            <h1 className="admin-memorandums-title">Memorandums</h1>
            <div className="admin-memorandums-actions">
              <select
                className="filter-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="approved">Draft (Approved)</option>
                <option value="released">Released</option>
              </select>
              <button className="btn-add-memorandum" onClick={openAddModal}>
                + New Memorandum
              </button>
            </div>
          </div>

          {error && (
            <div className="admin-memorandums-alert admin-memorandums-alert-error">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}

          {success && (
            <div className="admin-memorandums-alert admin-memorandums-alert-success">
              {success}
              <button onClick={() => setSuccess("")}>×</button>
            </div>
          )}

          <div className="admin-memorandums-list">
            {enrichedMemorandums.length === 0 ? (
              <div className="admin-memorandums-empty">
                <p>No memorandums found</p>
              </div>
            ) : (
              <table className="memorandums-table">
                <thead>
                  <tr>
                    <th>Order Number</th>
                    <th>Subject</th>
                    <th>Date Released</th>
                    <th>Released By</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedMemorandums.map((memo) => (
                    <tr key={memo.documentId}>
                      <td>{memo.documentNumber || "—"}</td>
                      <td className="table-title">{memo.title}</td>
                      <td>{memo.dateReleased ? formatDate(memo.dateReleased) : "—"}</td>
                      <td>{memo.releasedByName || "—"}</td>
                      <td>
                        <span className={`status-badge ${getStatusBadgeClass(memo.status)}`}>
                          {getStatusLabel(memo.status)}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="action-button action-button-view"
                            onClick={() => handleViewDetails(memo.documentId)}
                          >
                            View
                          </button>
                          {memo.fileUrl && (
                            <button
                              className="action-button action-button-view"
                              onClick={() => setPreviewMemo(memo)}
                            >
                              Preview
                            </button>
                          )}
                          {memo.status === "approved" && (
                            <button
                              className="action-button action-button-release"
                              onClick={() => {
                                setSelectedMemorandum(memo);
                                setShowReleaseModal(true);
                              }}
                            >
                              Release
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showReleaseModal && selectedMemorandum && (
            <div className="modal-overlay" onClick={() => setShowReleaseModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>Release Memorandum</h3>
                <p>Release "{selectedMemorandum.title}"?</p>
                <p className="modal-warning">Once released, this memorandum is visible to all organizations. This cannot be undone.</p>
                <div className="modal-actions">
                  <button className="form-button form-button-secondary" onClick={() => setShowReleaseModal(false)}>
                    Cancel
                  </button>
                  <button className="form-button form-button-primary" onClick={handleRelease}>
                    Release
                  </button>
                </div>
              </div>
            </div>
          )}

          {showDetailModal && selectedMemorandum && (
            <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
              <div className="modal-content modal-content-large" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{selectedMemorandum.title}</h3>
                  <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div className="detail-info">
                    <div className="info-row">
                      <span className="info-label">Order Number:</span>
                      <span className="info-value">{selectedMemorandum.documentNumber || "Not assigned"}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Status:</span>
                      <span className={`status-badge ${getStatusBadgeClass(selectedMemorandum.status)}`}>
                        {getStatusLabel(selectedMemorandum.status)}
                      </span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Date Released:</span>
                      <span className="info-value">{selectedMemorandum.dateReleased ? formatDate(selectedMemorandum.dateReleased) : "—"}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Released By:</span>
                      <span className="info-value">{selectedMemorandum.releasedByName || "—"}</span>
                    </div>
                    {selectedMemorandum.description && (
                      <div className="info-row-full">
                        <span className="info-label">Description:</span>
                        <p className="info-description">{selectedMemorandum.description}</p>
                      </div>
                    )}
                    {selectedMemorandum.fileUrl && (
                      <div className="info-row-full">
                        <div className="memorandum-file-actions">
                          <button
                            type="button"
                            className="action-button action-button-view"
                            onClick={() => setPreviewMemo(selectedMemorandum)}
                          >
                            👁 Preview File
                          </button>
                          <a
                            href={selectedMemorandum.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="file-download-link"
                          >
                            📄 Download: {selectedMemorandum.fileName}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="detail-history-section">
                    <h4 className="history-section-title">Status History</h4>
                    {selectedHistory.length === 0 ? (
                      <div className="history-empty">No history available</div>
                    ) : (
                      <div className="history-timeline">
                        {selectedHistory.map((entry, index) => (
                          <div key={entry.historyId || index} className="history-item">
                            <div className="history-item-dot"></div>
                            <div className="history-item-content">
                              <div className="history-item-header">
                                <span className={`status-badge ${getStatusBadgeClass(entry.status)}`}>
                                  {getStatusLabel(entry.status)}
                                </span>
                                <span className="history-item-date">{formatDateTime(entry.timestamp)}</span>
                              </div>
                              <div className="history-item-meta">
                                <span className="history-item-user">
                                  Changed by: {entry.changedByName || "Unknown"}
                                </span>
                                {entry.previousStatus && (
                                  <span className="history-item-transition">
                                    (from {getStatusLabel(entry.previousStatus)})
                                  </span>
                                )}
                              </div>
                              {entry.remarks && <p className="history-item-remarks">{entry.remarks}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {showAddModal && (
            <div
              className="modal-overlay"
              onClick={() => {
                if (!submitting) closeAddModal();
              }}
            >
              <div className="modal-content modal-content-large" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>New Memorandum</h3>
                  {!submitting && (
                    <button className="modal-close" onClick={closeAddModal}>×</button>
                  )}
                </div>
                <form onSubmit={handleSubmitMemorandum}>
                  <div className="modal-body">
                    {formError && <div className="form-error">{formError}</div>}

                    <div className="form-group">
                      <label htmlFor="orderNumber" className="form-label">
                        Order Number <span className="required">*</span>
                      </label>
                      <input
                        type="text"
                        id="orderNumber"
                        className="form-input"
                        value={formData.orderNumber}
                        onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                        placeholder="e.g., MEMO-2026-001"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="subject" className="form-label">
                        Subject <span className="required">*</span>
                      </label>
                      <input
                        type="text"
                        id="subject"
                        className="form-input"
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="description" className="form-label">
                        Description <span className="required">*</span>
                      </label>
                      <textarea
                        id="description"
                        className="form-input"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={4}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="file" className="form-label">
                        Upload Document <span className="required">*</span>
                      </label>
                      <input
                        type="file"
                        id="file"
                        className="form-input-file"
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                        onChange={handleFileChange}
                        required
                      />
                      <span className="form-hint">Accepted formats: PDF, Word, JPG, PNG, WEBP (Max 50MB)</span>
                      {formData.file && (
                        <div className="file-selected">
                          <span>Selected: {formData.file.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="modal-actions">
                      <button
                        type="button"
                        className="form-button form-button-secondary"
                        onClick={closeAddModal}
                        disabled={submitting}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="form-button form-button-primary"
                        disabled={submitting}
                      >
                        {submitting ? "Creating..." : "Create Memorandum"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
      {previewMemo && (
        <DocumentPreviewModal
          key={previewMemo.fileUrl}
          fileUrl={previewMemo.fileUrl}
          fileName={previewMemo.fileName}
          title={previewMemo.title}
          onClose={() => setPreviewMemo(null)}
        />
      )}
    </AdminLayout>
  );
};

export default AdminMemorandums;
