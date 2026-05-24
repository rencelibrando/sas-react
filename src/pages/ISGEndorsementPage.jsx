import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getAllOrganizations } from "../services/organizationService";
import {
  getProposalsAtStage,
  endorseProposal,
  returnProposalFromISG,
  getDocumentStatusHistory,
  markProposalFileViewed,
} from "../services/documentService";
import { getUserById } from "../services/userService";
import { subscribeToCommentSummary } from "../services/commentService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal";
import { formatDate, formatDateTime, getStatusBadgeClass, getStatusLabel } from "../utils/formatters";
import { REQUIREMENT_LABELS } from "../utils/proposalConstants";
import "../styles/colors.css";
import "./ISGEndorsementPage.css";

const ISGEndorsementPage = () => {
  const [loading, setLoading] = useState(true);
  const [orgMap, setOrgMap] = useState({});
  const [proposals, setProposals] = useState([]);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [proposalHistory, setProposalHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [userData, setUserData] = useState(null);
  const [commentSummary, setCommentSummary] = useState({ unresolvedReviewerTotal: 0, byRequirement: {} });
  const unresolvedReviewerCount = commentSummary.unresolvedReviewerTotal;

  // Forward to SAS confirmation modal
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardRemarks, setForwardRemarks] = useState("");
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardError, setForwardError] = useState("");

  // Return to org modal
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState("");

  const loadProposals = async () => {
    const docs = await getProposalsAtStage("isg_endorsement");
    setProposals(docs);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const uid = auth.currentUser?.uid;
        const [allOrgs, docs, userDoc] = await Promise.all([
          getAllOrganizations(),
          getProposalsAtStage("isg_endorsement"),
          uid ? getUserById(uid) : Promise.resolve(null),
        ]);
        const map = {};
        allOrgs.forEach((o) => { map[o.organizationId] = o.name; });
        setOrgMap(map);
        setProposals(docs);
        setUserData(userDoc);
      } catch (err) {
        console.error("Error loading ISG endorsement queue:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!selectedProposal?.documentId) {
      setCommentSummary({ unresolvedReviewerTotal: 0, byRequirement: {} });
      return;
    }
    const unsub = subscribeToCommentSummary(selectedProposal.documentId, setCommentSummary);
    return () => unsub?.();
  }, [selectedProposal?.documentId]);

  const handleViewProposal = async (proposal) => {
    setSelectedProposal(proposal);
    setShowForwardModal(false);
    setShowReturnModal(false);
    setLoadingDetail(true);
    try {
      const history = await getDocumentStatusHistory(proposal.documentId);
      setProposalHistory(history);
    } catch (err) {
      console.error("Error loading history:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeAll = () => {
    setSelectedProposal(null);
    setShowForwardModal(false);
    setShowReturnModal(false);
    setForwardRemarks("");
    setForwardError("");
    setReturnRemarks("");
    setReturnError("");
  };

  const handleForward = async () => {
    setForwardLoading(true);
    setForwardError("");
    try {
      await endorseProposal(
        selectedProposal.documentId,
        auth.currentUser.uid,
        forwardRemarks.trim()
      );
      closeAll();
      await loadProposals();
    } catch (err) {
      setForwardError(err.message || "Failed to forward proposal.");
    } finally {
      setForwardLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!returnRemarks.trim()) {
      setReturnError("Please provide a reason for returning the proposal.");
      return;
    }
    setReturnLoading(true);
    setReturnError("");
    try {
      await returnProposalFromISG(
        selectedProposal.documentId,
        auth.currentUser.uid,
        returnRemarks.trim()
      );
      closeAll();
      await loadProposals();
    } catch (err) {
      setReturnError(err.message || "Failed to return proposal.");
    } finally {
      setReturnLoading(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="home-container">
      <Navbar />
      <DashboardLayout currentPage="isg-endorsement" orgType="ISG">
        <div className="isg-endorsement-page">
          <div className="page-header">
            <h1 className="page-title">ISG Assessment Queue</h1>
            <span className="queue-count">{proposals.length} pending</span>
          </div>

          {proposals.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <p className="empty-message">Queue is clear</p>
              <p className="empty-hint">No activity proposals are awaiting ISG assessment</p>
            </div>
          ) : (
            <div className="proposals-table-container">
              <table className="proposals-table">
                <thead>
                  <tr>
                    <th>Proposal Title</th>
                    <th>Organization</th>
                    <th>Date Submitted</th>
                    <th>Files</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((proposal) => (
                    <tr key={proposal.documentId}>
                      <td className="table-title">{proposal.title}</td>
                      <td>{orgMap[proposal.organizationId] || proposal.organizationId}</td>
                      <td>{formatDate(proposal.dateSubmitted)}</td>
                      <td>{proposal.files?.length || 0} file(s)</td>
                      <td>
                        <button
                          className="btn-view"
                          onClick={() => handleViewProposal(proposal)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detail / Review Modal */}
          {selectedProposal && !showForwardModal && !showReturnModal && (
            <div className="modal-overlay" onClick={closeAll}>
              <div
                className="modal-content modal-content-large"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h3>{selectedProposal.title}</h3>
                  <button className="modal-close" onClick={closeAll}>×</button>
                </div>
                <div className="modal-body">
                  {loadingDetail ? (
                    <div className="loading-state">Loading...</div>
                  ) : (
                    <>
                      <div className="detail-info">
                        <div className="info-row">
                          <span className="info-label">Organization:</span>
                          <span className="info-value">
                            {orgMap[selectedProposal.organizationId] || selectedProposal.organizationId}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Date Submitted:</span>
                          <span className="info-value">{formatDate(selectedProposal.dateSubmitted)}</span>
                        </div>
                        {selectedProposal.proposalFlags && (
                          <div className="info-row">
                            <span className="info-label">Event Type:</span>
                            <span className="info-value">
                              {[
                                selectedProposal.proposalFlags.hasSpeakers && "Has Speakers",
                                selectedProposal.proposalFlags.collectsFees && "Collects Fees",
                              ]
                                .filter(Boolean)
                                .join(", ") || "Standard"}
                            </span>
                          </div>
                        )}
                        {selectedProposal.description && (
                          <div className="info-row-full">
                            <span className="info-label">Description:</span>
                            <p className="info-description">{selectedProposal.description}</p>
                          </div>
                        )}
                        {selectedProposal.files?.length > 0 && (
                          <div className="info-row-full">
                            <span className="info-label">Submitted Documents:</span>
                            <div className="files-list">
                              {selectedProposal.files.map((f, i) => {
                                const counts = commentSummary.byRequirement[f.requirementKey];
                                const resolvedCount = counts ? counts.total - counts.unresolved : 0;
                                return (
                                  <div key={i} className="file-list-item">
                                    <button
                                      type="button"
                                      className="file-download-link file-preview-btn"
                                      onClick={() => {
                                        const uid = auth.currentUser?.uid;
                                        if (uid && selectedProposal?.documentId) {
                                          markProposalFileViewed(
                                            selectedProposal.documentId,
                                            uid,
                                            "isg_endorsement"
                                          );
                                        }
                                        setPreviewFile({
                                          fileUrl: f.fileUrl,
                                          fileName: f.fileName,
                                          title: REQUIREMENT_LABELS[f.requirementKey] || f.fileName,
                                          documentId: selectedProposal.documentId,
                                          requirementKey: f.requirementKey,
                                          fileVersion: f.version || 1,
                                          previousVersion: f.previousVersion || null,
                                        });
                                      }}
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

                      {unresolvedReviewerCount > 0 && (
                        <div className="comment-gate-banner">
                          ⚠ {unresolvedReviewerCount} unresolved reviewer comment{unresolvedReviewerCount === 1 ? "" : "s"}.
                          The proposal can't be forwarded until they're resolved.
                        </div>
                      )}

                      <div className="action-section">
                        <button
                          className="btn-endorse"
                          onClick={() => setShowForwardModal(true)}
                          disabled={unresolvedReviewerCount > 0}
                          title={unresolvedReviewerCount > 0 ? "Resolve all reviewer comments first" : ""}
                        >
                          Forward to SAS
                        </button>
                        <button
                          className="btn-return"
                          onClick={() => setShowReturnModal(true)}
                        >
                          Return for Revision
                        </button>
                      </div>

                      {proposalHistory.length > 0 && (
                        <div className="detail-history-section">
                          <h4 className="history-section-title">Status History</h4>
                          <div className="history-timeline">
                            {proposalHistory.map((entry, index) => (
                              <div key={entry.historyId || index} className="history-item">
                                <div className="history-item-dot"></div>
                                <div className="history-item-content">
                                  <div className="history-item-header">
                                    <span className={`status-badge ${getStatusBadgeClass(entry.status)}`}>
                                      {getStatusLabel(entry.status)}
                                    </span>
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
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Forward to SAS Confirmation Modal */}
          {showForwardModal && selectedProposal && (
            <div
              className="modal-overlay"
              onClick={() => { setShowForwardModal(false); setForwardRemarks(""); setForwardError(""); }}
            >
              <div className="modal-content modal-content-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Forward to SAS</h3>
                  <button
                    className="modal-close"
                    onClick={() => { setShowForwardModal(false); setForwardRemarks(""); setForwardError(""); }}
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  <p className="endorse-instruction">
                    Forward <strong>{selectedProposal.title}</strong> to SAS for review.
                    SAS will generate the endorsement letter.
                  </p>
                  <div className="form-group">
                    <label className="form-label">Remarks (optional)</label>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      placeholder="Any notes for SAS..."
                      value={forwardRemarks}
                      onChange={(e) => setForwardRemarks(e.target.value)}
                    />
                  </div>
                  {forwardError && <p className="form-error">{forwardError}</p>}
                  <div className="modal-footer">
                    <button
                      className="btn-secondary"
                      onClick={() => { setShowForwardModal(false); setForwardRemarks(""); setForwardError(""); }}
                      disabled={forwardLoading}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-endorse"
                      onClick={handleForward}
                      disabled={forwardLoading}
                    >
                      {forwardLoading ? "Forwarding..." : "Confirm Forward"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Return Modal */}
          {showReturnModal && selectedProposal && (
            <div
              className="modal-overlay"
              onClick={() => { setShowReturnModal(false); setReturnRemarks(""); setReturnError(""); }}
            >
              <div className="modal-content modal-content-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Return for Revision</h3>
                  <button
                    className="modal-close"
                    onClick={() => { setShowReturnModal(false); setReturnRemarks(""); setReturnError(""); }}
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  <p className="return-instruction">
                    State the reason for returning{" "}
                    <strong>{selectedProposal.title}</strong> to the organization.
                  </p>
                  <div className="form-group">
                    <label className="form-label">Reason / Remarks *</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      placeholder="Describe what needs to be corrected or clarified..."
                      value={returnRemarks}
                      onChange={(e) => setReturnRemarks(e.target.value)}
                    />
                  </div>
                  {returnError && <p className="form-error">{returnError}</p>}
                  <div className="modal-footer">
                    <button
                      className="btn-secondary"
                      onClick={() => { setShowReturnModal(false); setReturnRemarks(""); setReturnError(""); }}
                      disabled={returnLoading}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-return"
                      onClick={handleReturn}
                      disabled={returnLoading || !returnRemarks.trim()}
                    >
                      {returnLoading ? "Returning..." : "Return Proposal"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
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
          viewerRole="reviewer"
          documentStage={selectedProposal?.pipeline?.currentStage || null}
          authorScope="isg"
          visibleStages={["isg_endorsement", "isg_distribution"]}
          canPost={selectedProposal?.pipeline?.currentStage === "isg_endorsement"}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

export default ISGEndorsementPage;
