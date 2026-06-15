import { useState, useEffect, useMemo } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import {
  getDocumentsByOrganization,
  getDocumentById,
  getDocumentStatusHistory,
  uploadAdditionalDocument,
  respondToAdditionalRequest,
  notifyReviewerOfResponse,
} from "../services/documentService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import ProposalSubmission from "../components/proposals/ProposalSubmission";
import LoadingScreen from "../components/LoadingScreen";
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal";
import { subscribeToCommentSummary } from "../services/commentService";
import { formatDate, formatDateTime, getProposalDisplayStatus, getProposalHistoryDisplay, getPipelineStageLabel, getStageOffice } from "../utils/formatters";
import { REQUIREMENT_LABELS, REQUEST_STATUS_LABELS, getRequestFiles } from "../utils/proposalConstants";
import "../styles/colors.css";
import "./ActivityProposalsPage.css";

const ORG_PIPELINE_ORDER = [
  "isg_endorsement",
  "sas_review",
  "vpaa_review",
  "op_approval",
  "sas_release",
  "isg_distribution"
];

const ISG_PIPELINE_ORDER = [
  "sas_review",
  "vpaa_review",
  "op_approval",
  "fms_review",
  "procurement_review",
  "sas_release"
];

const getPipelineOrderFor = (proposal) =>
  proposal?.submitterRole === "ISG" ? ISG_PIPELINE_ORDER : ORG_PIPELINE_ORDER;

const PipelineProgress = ({ proposal }) => {
  const stagesArr = proposal?.pipeline?.stages || [];
  const currentStage = proposal?.pipeline?.currentStage;
  const pipelineOrder = getPipelineOrderFor(proposal);

  const lastEntryByStage = {};
  stagesArr.forEach((entry) => {
    if (entry?.stage) lastEntryByStage[entry.stage] = entry;
  });

  // A stage that ended in a negative decision (reject/return) is not "completed".
  const NEGATIVE_ACTIONS = new Set(["returned", "return", "reject", "rejected"]);
  const completedSet = new Set();
  stagesArr.forEach((entry) => {
    if (entry?.completedAt && entry?.action && !NEGATIVE_ACTIONS.has(entry.action)) {
      completedSet.add(entry.stage);
    }
  });

  return (
    <div className="detail-history-section">
      <h4 className="history-section-title">Pipeline Progress</h4>
      <div className="history-timeline">
        {pipelineOrder.map((stageKey) => {
          const entry = lastEntryByStage[stageKey];
          const office = getStageOffice(stageKey);
          const isCurrent = currentStage === stageKey;
          const isCompleted = completedSet.has(stageKey);
          const wasRejected = NEGATIVE_ACTIONS.has(entry?.action);

          let stateLabel;
          let stateClass;
          if (wasRejected) {
            stateLabel = `Rejected by ${office}`;
            stateClass = "status-badge-rejected";
          } else if (isCompleted) {
            stateLabel = `Completed by ${office}`;
            stateClass = "status-badge-approved";
          } else if (isCurrent && entry?.firstViewedAt) {
            stateLabel = `Opened by ${office}`;
            stateClass = "status-badge-review";
          } else if (isCurrent) {
            stateLabel = getPipelineStageLabel(stageKey);
            stateClass = "status-badge-pending";
          } else {
            stateLabel = "Not yet reached";
            stateClass = "status-badge-default";
          }

          const timestamp =
            entry?.completedAt ||
            entry?.firstViewedAt ||
            entry?.tokenSentAt ||
            null;

          return (
            <div key={stageKey} className="history-item">
              <div className="history-item-dot"></div>
              <div className="history-item-content">
                <div className="history-item-header">
                  <span className={`status-badge ${stateClass}`}>
                    {stateLabel}
                  </span>
                  {timestamp && (
                    <span className="history-item-date">
                      {formatDateTime(timestamp)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OrgRequestItem = ({ req, busy, onUpload, onSend, onPreview }) => {
  const [reply, setReply] = useState(req.responseText || "");
  const office = req.requestedByOffice || "SAS";
  const files = getRequestFiles(req);
  const canSend = !busy && (reply.trim().length > 0 || files.length > 0);

  return (
    <li className={`additional-request-item status-${req.status}`}>
      <div className="additional-request-main">
        <div className="additional-request-label">
          {req.label}
          <span className="additional-request-from"> — requested by {office}</span>
        </div>
        {req.description && (
          <p className="additional-request-desc">{req.description}</p>
        )}
        <div className="additional-request-status">
          <span className={`request-status-pill status-${req.status}`}>
            {REQUEST_STATUS_LABELS[req.status] || req.status}
          </span>
        </div>
        {req.status !== "pending" && req.responseText && (
          <p className="additional-request-reply">
            <strong>Your reply:</strong> {req.responseText}
          </p>
        )}
        {files.length > 0 && (
          <div className="additional-request-files">
            {files.map((f, i) => (
              <button
                key={i}
                type="button"
                className="file-download-link file-preview-btn"
                onClick={() => onPreview(req, f, i)}
              >
                📄 {f.fileName}
              </button>
            ))}
          </div>
        )}
      </div>

      {req.status === "pending" && (
        <div className="additional-request-actions">
          <div className="additional-request-reply-group">
            <label className="additional-request-reply-label">
              Reply to {office}&apos;s message (optional)
            </label>
            <textarea
              className="additional-request-reply-input"
              rows={3}
              placeholder={`Write your reply to ${office}...`}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="additional-request-buttons">
            <label
              className={`form-button form-button-secondary ${busy ? "is-busy" : ""}`}
              style={{ cursor: busy ? "wait" : "pointer" }}
            >
              {busy
                ? "Uploading..."
                : files.length > 0
                ? "Add another file"
                : "Add file"}
              <input
                type="file"
                accept="application/pdf,.pdf,.doc,.docx,image/jpeg,image/png"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onUpload(req.id, file);
                }}
              />
            </label>
            <button
              type="button"
              className="form-button form-button-primary"
              disabled={!canSend}
              onClick={() => onSend(req.id, reply.trim())}
            >
              {busy ? "Sending..." : "Send response to reviewer"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const OrgAdditionalRequestsPanel = ({
  requests,
  busyId,
  error,
  onUpload,
  onSend,
  onPreview,
}) => {
  const sorted = [...requests].sort((a, b) => {
    const order = { pending: 0, responded: 1, uploaded: 1, resolved: 2, cancelled: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });
  const openCount = sorted.filter(
    (r) => r.status === "pending" || r.status === "uploaded" || r.status === "responded"
  ).length;

  return (
    <div className="org-additional-requests-section">
      <h4 className="actions-section-title">
        Requests from Reviewers
        {openCount > 0 && (
          <span className="open-count-pill"> {openCount} open</span>
        )}
      </h4>
      <p className="org-additional-help">
        A reviewing office has asked for a clarification and/or document(s) for
        this proposal. For each open item you can write a reply and attach one or
        more files, then click <strong>Send response to reviewer</strong>. Your
        proposal keeps its place in the pipeline — no need to resubmit the whole
        proposal — and the reviewer is notified once when you send. After you
        send, the item locks until the reviewer reviews it or asks again.
      </p>
      {error && <p className="form-error">{error}</p>}
      <ul className="additional-requests-list">
        {sorted.map((req) => (
          <OrgRequestItem
            key={req.id}
            req={req}
            busy={busyId === req.id}
            onUpload={onUpload}
            onSend={onSend}
            onPreview={onPreview}
          />
        ))}
      </ul>
    </div>
  );
};

const ActivityProposalsPage = ({ orgType: orgTypeProp = null }) => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [selectedProposalHistory, setSelectedProposalHistory] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [commentSummary, setCommentSummary] = useState({ unresolvedReviewerTotal: 0, byRequirement: {} });

  useEffect(() => {
    if (!selectedProposal?.documentId) {
      setCommentSummary({ unresolvedReviewerTotal: 0, byRequirement: {} });
      return;
    }
    const unsub = subscribeToCommentSummary(selectedProposal.documentId, setCommentSummary);
    return () => unsub?.();
  }, [selectedProposal?.documentId]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);

        if (userDoc?.organizationId) {
          const orgDoc = await getOrganizationById(userDoc.organizationId);
          setOrganizationData(orgDoc);

          // Fetch activity proposals
          const docs = await getDocumentsByOrganization(userDoc.organizationId, {
            documentType: "activity_proposal"
          });
          setProposals(docs);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSubmitSuccess = async () => {
    setShowSubmitForm(false);
    // Reload proposals
    const user = auth.currentUser;
    if (user && userData?.organizationId) {
      const docs = await getDocumentsByOrganization(userData.organizationId, {
        documentType: "activity_proposal"
      });
      setProposals(docs);
    }
  };

  const handleViewProposal = async (proposalId) => {
    try {
      setLoadingDetail(true);
      const doc = await getDocumentById(proposalId);
      setSelectedProposal(doc);

      // Fetch status history
      const history = await getDocumentStatusHistory(proposalId);
      setSelectedProposalHistory(history);
    } catch (error) {
      console.error("Error loading proposal details:", error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const [additionalUploadBusyId, setAdditionalUploadBusyId] = useState(null);
  const [additionalUploadError, setAdditionalUploadError] = useState("");

  const refreshAfterResponse = async () => {
    await handleViewProposal(selectedProposal.documentId);
    if (userData?.organizationId) {
      const docs = await getDocumentsByOrganization(userData.organizationId, {
        documentType: "activity_proposal",
      });
      setProposals(docs);
    }
  };

  const handleUploadAdditional = async (requestId, file) => {
    if (!selectedProposal || !file) return;
    setAdditionalUploadBusyId(requestId);
    setAdditionalUploadError("");
    try {
      // Upload appends the file only; the reviewer is notified once the org
      // clicks "Send response to reviewer" (handleSendResponse).
      await uploadAdditionalDocument({
        documentId: selectedProposal.documentId,
        requestId,
        file,
        userId: auth.currentUser.uid,
      });
      await refreshAfterResponse();
    } catch (err) {
      setAdditionalUploadError(err.message || "Failed to upload document.");
    } finally {
      setAdditionalUploadBusyId(null);
    }
  };

  const handleSendResponse = async (requestId, responseText) => {
    if (!selectedProposal) return;
    setAdditionalUploadBusyId(requestId);
    setAdditionalUploadError("");
    try {
      // Mark responded (records the optional written reply), then re-notify the
      // requesting office once with a fresh review link.
      await respondToAdditionalRequest({
        documentId: selectedProposal.documentId,
        requestId,
        responseText,
        userId: auth.currentUser.uid,
      });
      await notifyReviewerOfResponse({
        documentId: selectedProposal.documentId,
        requestId,
      });
      await refreshAfterResponse();
    } catch (err) {
      setAdditionalUploadError(err.message || "Failed to send response.");
    } finally {
      setAdditionalUploadBusyId(null);
    }
  };

  // Filter proposals based on search, status, and date range
  const filteredProposals = useMemo(() => {
    return proposals.filter((proposal) => {
      // Search filter (title, document number, remarks)
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = 
          proposal.title?.toLowerCase().includes(searchLower) ||
          proposal.documentNumber?.toLowerCase().includes(searchLower) ||
          proposal.remarks?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== "all" && proposal.status !== statusFilter) {
        return false;
      }

      // Date range filter
      if (proposal.dateSubmitted) {
        const proposalDate = proposal.dateSubmitted.toDate 
          ? proposal.dateSubmitted.toDate() 
          : new Date(proposal.dateSubmitted);
        
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (proposalDate < fromDate) return false;
        }

        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          if (proposalDate > toDate) return false;
        }
      }

      return true;
    });
  }, [proposals, searchTerm, statusFilter, dateFrom, dateTo]);

  const handleClearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const organizationName = organizationData?.name || "Organization";
  const userRole = userData?.role || "ISG";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="home-container">
      <Navbar
        organizationName={organizationName}
        role={userRole}
        userName={userName}
      />
      
      <DashboardLayout currentPage="activity-proposals" orgType={orgTypeProp ?? organizationData?.type ?? null}>
        {loading ? (
          <LoadingScreen compact={true} />
        ) : (
        <div className="activity-proposals-page">
          <div className="page-header">
            <h1 className="page-title">Activity Proposals</h1>
            <button 
              className="btn-primary"
              onClick={() => setShowSubmitForm(true)}
            >
              + Submit New Proposal
            </button>
          </div>

          {/* Filters Section */}
          {proposals.length > 0 && (
            <div className="filters-section">
              <div className="filters-row">
                <div className="filter-group">
                  <label htmlFor="search-input" className="filter-label">Search</label>
                  <input
                    id="search-input"
                    type="text"
                    className="filter-input"
                    placeholder="Search by title, document number, or remarks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="status-filter" className="filter-label">Status</label>
                  <select
                    id="status-filter"
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="in_pipeline">In Pipeline</option>
                    <option value="returned">Returned</option>
                    <option value="approved">Approved</option>
                    <option value="released">Released</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label htmlFor="date-from" className="filter-label">Date From</label>
                  <input
                    id="date-from"
                    type="date"
                    className="filter-input"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label htmlFor="date-to" className="filter-label">Date To</label>
                  <input
                    id="date-to"
                    type="date"
                    className="filter-input"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                {(searchTerm || statusFilter !== "all" || dateFrom || dateTo) && (
                  <button
                    className="btn-clear-filters"
                    onClick={handleClearFilters}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          )}

          {proposals.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <p className="empty-message">No activity proposals submitted yet</p>
              <p className="empty-hint">Submit your first activity proposal to get started</p>
            </div>
          ) : (
            <>
              {filteredProposals.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔍</div>
                  <p className="empty-message">No proposals match your filters</p>
                  <p className="empty-hint">Try adjusting your search criteria</p>
                </div>
              ) : (
                <div className="proposals-table-container">
                  <table className="proposals-table">
                    <thead>
                      <tr>
                        <th>Proposal Title</th>
                        <th>Date Submitted</th>
                        <th>Status</th>
                        <th>Last Update</th>
                        <th>Remarks</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProposals.map((proposal) => {
                      const display = getProposalDisplayStatus(proposal);
                      const openAddl = (proposal.additionalRequests || []).filter(
                        (r) => r.status === "pending"
                      ).length;
                      return (
                    <tr key={proposal.documentId}>
                      <td className="table-title">{proposal.title}</td>
                      <td>{formatDate(proposal.dateSubmitted)}</td>
                      <td>
                        <span className={`status-badge ${display.badgeClass}`}>
                          {display.label}
                        </span>
                        {openAddl > 0 && (
                          <div className="open-additional-chip">
                            📎 {openAddl} additional doc{openAddl === 1 ? "" : "s"} requested
                          </div>
                        )}
                      </td>
                      <td>{formatDateTime(proposal.lastUpdated)}</td>
                      <td className="table-remarks">
                        {proposal.remarks ? (
                          <span title={proposal.remarks}>
                            {proposal.remarks.length > 50 
                              ? `${proposal.remarks.substring(0, 50)}...` 
                              : proposal.remarks}
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        <button
                          className="btn-view"
                          onClick={() => handleViewProposal(proposal.documentId)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Submit Form Modal */}
          {showSubmitForm && (
            <div className="modal-overlay" onClick={() => setShowSubmitForm(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <ProposalSubmission
                  onSuccess={handleSubmitSuccess}
                  onCancel={() => setShowSubmitForm(false)}
                  organizationId={organizationData?.organizationId}
                  orgType={organizationData?.type}
                />
              </div>
            </div>
          )}

          {/* Detail View Modal */}
          {selectedProposal && (
            <div className="modal-overlay" onClick={() => setSelectedProposal(null)}>
              <div className="modal-content modal-content-large" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{selectedProposal.title}</h3>
                  <button className="modal-close" onClick={() => setSelectedProposal(null)}>×</button>
                </div>
                <div className="modal-body">
                  {loadingDetail ? (
                    <div className="loading-state">Loading...</div>
                  ) : (
                    <>
                      <div className="detail-info">
                        <div className="info-row">
                          <span className="info-label">Status:</span>
                          {(() => {
                            const display = getProposalDisplayStatus(selectedProposal);
                            return (
                              <span className={`status-badge ${display.badgeClass}`}>
                                {display.label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="info-row">
                          <span className="info-label">Document Number:</span>
                          <span className="info-value">
                            {selectedProposal.documentNumber || "Not assigned"}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Date Submitted:</span>
                          <span className="info-value">
                            {formatDate(selectedProposal.dateSubmitted)}
                          </span>
                        </div>
                        {selectedProposal.description && (
                          <div className="info-row-full">
                            <span className="info-label">Description:</span>
                            <p className="info-description">{selectedProposal.description}</p>
                          </div>
                        )}
                        {selectedProposal.remarks && (
                          <div className="info-row-full">
                            <span className="info-label">Remarks:</span>
                            <p className="info-remarks">{selectedProposal.remarks}</p>
                          </div>
                        )}
                        {selectedProposal.files?.length > 0 && (
                          <div className="info-row-full">
                            <span className="info-label">Attached Documents:</span>
                            <div className="files-list">
                              {selectedProposal.files.map((f, i) => {
                                const counts = commentSummary.byRequirement[f.requirementKey];
                                const resolvedCount = counts ? counts.total - counts.unresolved : 0;
                                return (
                                  <div key={i} className="file-list-item">
                                    <button
                                      type="button"
                                      className="file-download-link file-preview-btn"
                                      onClick={() => setPreviewFile({
                                        fileUrl: f.fileUrl,
                                        fileName: f.fileName,
                                        title: REQUIREMENT_LABELS[f.requirementKey] || f.fileName,
                                        documentId: selectedProposal.documentId,
                                        requirementKey: f.requirementKey,
                                        fileVersion: f.version || 1,
                                        previousVersion: f.previousVersion || null,
                                      })}
                                    >
                                      📄 {REQUIREMENT_LABELS[f.requirementKey] || f.fileName}
                                    </button>
                                    {counts && counts.total > 0 && (
                                      <div className="file-comment-counts">
                                        {counts.unresolved > 0 && (
                                          <span className="file-comment-pending">
                                            💬 {counts.unresolved} unresolved
                                          </span>
                                        )}
                                        {resolvedCount > 0 && (
                                          <span className="file-comment-resolved">
                                            ✓ {resolvedCount} resolved
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Requests raised by reviewers */}
                      {(selectedProposal.additionalRequests || []).length > 0 && (
                        <OrgAdditionalRequestsPanel
                          requests={selectedProposal.additionalRequests}
                          busyId={additionalUploadBusyId}
                          error={additionalUploadError}
                          onUpload={handleUploadAdditional}
                          onSend={handleSendResponse}
                          onPreview={(req, f, i) =>
                            setPreviewFile({
                              fileUrl: f.fileUrl,
                              fileName: f.fileName,
                              title: req.label,
                              documentId: selectedProposal.documentId,
                              requirementKey: `additional:${req.id}:${i}`,
                            })
                          }
                        />
                      )}

                      {/* Pipeline Progress */}
                      <PipelineProgress proposal={selectedProposal} />

                      {/* Status History */}
                      <div className="detail-history-section">
                        <h4 className="history-section-title">Activity Log</h4>
                        {selectedProposalHistory.length === 0 ? (
                          <div className="history-empty">No history available</div>
                        ) : (
                          <div className="history-timeline">
                            {selectedProposalHistory.map((entry, index) => (
                              <div key={entry.historyId || index} className="history-item">
                                <div className="history-item-dot"></div>
                                <div className="history-item-content">
                                  <div className="history-item-header">
                                    {(() => {
                                      const hist = getProposalHistoryDisplay(entry);
                                      return (
                                        <span className={`status-badge ${hist.badgeClass}`}>
                                          {hist.label}
                                        </span>
                                      );
                                    })()}
                                    <span className="history-item-date">
                                      {formatDateTime(entry.timestamp)}
                                    </span>
                                  </div>
                                  {entry.remarks && (
                                    <p className="history-item-remarks">{entry.remarks}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </DashboardLayout>
      {previewFile && (
        <DocumentPreviewModal
          key={previewFile.fileUrl}
          fileUrl={previewFile.fileUrl}
          fileName={previewFile.fileName}
          title={previewFile.title}
          documentId={previewFile.documentId}
          requirementKey={previewFile.requirementKey}
          fileVersion={previewFile.fileVersion}
          previousVersion={previewFile.previousVersion}
          currentUser={userData ? {
            uid: auth.currentUser?.uid,
            name: userData.fullName || userData.name,
            role: userData.userRole || userData.role,
          } : null}
          viewerRole="org"
          documentStage={selectedProposal?.pipeline?.currentStage || null}
          authorScope="submitter"
          canPost={!!selectedProposal?.pipeline?.currentStage}
          onRevisionUploaded={() => {
            if (selectedProposal?.documentId) {
              handleViewProposal(selectedProposal.documentId);
            }
          }}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

export default ActivityProposalsPage;

