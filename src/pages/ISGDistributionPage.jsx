import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getAllOrganizations } from "../services/organizationService";
import {
  getProposalsAtStage,
  markAsDistributed,
  markProposalFileViewed,
} from "../services/documentService";
import { getUserById } from "../services/userService";
import { subscribeToCommentSummary } from "../services/commentService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal";
import { formatDate } from "../utils/formatters";
import { REQUIREMENT_LABELS } from "../utils/proposalConstants";
import "../styles/colors.css";
import "./ISGDistributionPage.css";

const ISGDistributionPage = () => {
  const [loading, setLoading] = useState(true);
  const [orgMap, setOrgMap] = useState({});
  const [proposals, setProposals] = useState([]);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [distributing, setDistributing] = useState(null);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const [userData, setUserData] = useState(null);
  const [commentSummary, setCommentSummary] = useState({ unresolvedReviewerTotal: 0, byRequirement: {} });
  const unresolvedReviewerCount = commentSummary.unresolvedReviewerTotal;

  useEffect(() => {
    if (!selectedProposal?.documentId) {
      setCommentSummary({ unresolvedReviewerTotal: 0, byRequirement: {} });
      return;
    }
    const unsub = subscribeToCommentSummary(selectedProposal.documentId, setCommentSummary);
    return () => unsub?.();
  }, [selectedProposal?.documentId]);

  const loadProposals = async () => {
    const docs = await getProposalsAtStage("isg_distribution");
    setProposals(docs);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const uid = auth.currentUser?.uid;
        const [allOrgs, docs, userDoc] = await Promise.all([
          getAllOrganizations(),
          getProposalsAtStage("isg_distribution"),
          uid ? getUserById(uid) : Promise.resolve(null),
        ]);
        const map = {};
        allOrgs.forEach((o) => { map[o.organizationId] = o.name; });
        setOrgMap(map);
        setProposals(docs);
        setUserData(userDoc);
      } catch (err) {
        console.error("Error loading distribution queue:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleMarkDistributed = async (documentId) => {
    setDistributing(documentId);
    setError("");
    try {
      await markAsDistributed(documentId, auth.currentUser.uid);
      setSelectedProposal(null);
      await loadProposals();
    } catch (err) {
      setError(err.message || "Failed to mark as distributed.");
    } finally {
      setDistributing(null);
    }
  };

  const getEndorsedAt = (proposal) => {
    const endorseStage = proposal.pipeline?.stages?.find(
      (s) => s.stage === "isg_endorsement" && s.action === "endorsed"
    );
    if (!endorseStage?.completedAt) return "—";
    const d = endorseStage.completedAt.toDate
      ? endorseStage.completedAt.toDate()
      : new Date(endorseStage.completedAt);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="home-container">
      <Navbar />
      <DashboardLayout currentPage="isg-distribution" orgType="ISG">
        <div className="isg-distribution-page">
          <div className="page-header">
            <h1 className="page-title">ISG Distribution</h1>
            <span className="queue-count">{proposals.length} endorsed</span>
          </div>

          <p className="page-description">
            These proposals have been endorsed by ISG. Mark each as distributed once the endorsement
            letter has been physically delivered to the relevant offices.
          </p>

          {error && <div className="alert-error">{error}</div>}

          {proposals.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <p className="empty-message">Nothing to distribute</p>
              <p className="empty-hint">Endorsed proposals awaiting distribution will appear here</p>
            </div>
          ) : (
            <div className="proposals-table-container">
              <table className="proposals-table">
                <thead>
                  <tr>
                    <th>Proposal Title</th>
                    <th>Organization</th>
                    <th>Endorsed On</th>
                    <th>Files</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((proposal) => (
                    <tr key={proposal.documentId}>
                      <td className="table-title">{proposal.title}</td>
                      <td>{orgMap[proposal.organizationId] || proposal.organizationId}</td>
                      <td>{getEndorsedAt(proposal)}</td>
                      <td>{proposal.files?.length || 0} file(s)</td>
                      <td className="actions-cell">
                        <button
                          className="btn-view"
                          onClick={() => setSelectedProposal(proposal)}
                        >
                          View
                        </button>
                        <button
                          className="btn-distribute"
                          onClick={() => handleMarkDistributed(proposal.documentId)}
                          disabled={distributing === proposal.documentId}
                        >
                          {distributing === proposal.documentId ? "Processing..." : "Mark as Distributed"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detail View Modal */}
          {selectedProposal && (
            <div className="modal-overlay" onClick={() => setSelectedProposal(null)}>
              <div
                className="modal-content modal-content-large"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h3>{selectedProposal.title}</h3>
                  <button className="modal-close" onClick={() => setSelectedProposal(null)}>×</button>
                </div>
                <div className="modal-body">
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
                    <div className="info-row">
                      <span className="info-label">Endorsed On:</span>
                      <span className="info-value">{getEndorsedAt(selectedProposal)}</span>
                    </div>
                    {selectedProposal.description && (
                      <div className="info-row-full">
                        <span className="info-label">Description:</span>
                        <p className="info-description">{selectedProposal.description}</p>
                      </div>
                    )}
                    {selectedProposal.files?.length > 0 && (
                      <div className="info-row-full">
                        <span className="info-label">Documents:</span>
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
                                        "isg_distribution"
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
                      Distribution is blocked until they're resolved.
                    </div>
                  )}

                  <div className="action-section">
                    <button
                      className="btn-distribute"
                      onClick={() => {
                        setSelectedProposal(null);
                        handleMarkDistributed(selectedProposal.documentId);
                      }}
                      disabled={distributing === selectedProposal.documentId || unresolvedReviewerCount > 0}
                      title={unresolvedReviewerCount > 0 ? "Resolve all reviewer comments first" : ""}
                    >
                      {distributing === selectedProposal.documentId
                        ? "Processing..."
                        : "Mark as Distributed"}
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
          canPost={selectedProposal?.pipeline?.currentStage === "isg_distribution"}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

export default ISGDistributionPage;
