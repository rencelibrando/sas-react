import { useEffect, useRef, useState } from "react";
import sasLogo from "../assets/images/logos/sas-logo.png";
import LoadingScreen from "../components/LoadingScreen";
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal";
import { REQUIREMENT_LABELS } from "../utils/proposalConstants";
import "../styles/colors.css";
import "./ReviewPage.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const STAGE_TITLES = {
  vpaa_review: "VPAA Review",
  op_approval: "Office of the President Approval",
  fms_review: "Financial Management Services Review",
  procurement_review: "Procurement Office Review",
};

const STAGE_TO_SCOPE = {
  vpaa_review: "vpaa",
  op_approval: "op",
  fms_review: "fms",
  procurement_review: "procurement",
};

// Build a commentApi that polls the tokenized comment endpoints. Used by the
// DocumentPreviewModal so offices can comment without a portal account.
const buildTokenCommentApi = (token) => ({
  subscribe(requirementKey, onChange) {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const url = `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/comments?requirementKey=${encodeURIComponent(requirementKey)}`;
        const r = await fetch(url);
        const data = await r.json();
        if (cancelled) return;
        if (r.ok && data.success) onChange(data.comments || []);
      } catch (err) {
        if (!cancelled) console.error("token-comments poll error:", err);
      }
    };
    fetchOnce();
    const intervalId = setInterval(fetchOnce, 4000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  },
  async create({ requirementKey, page, bbox, text }) {
    const r = await fetch(`${API_BASE_URL}/api/review/${encodeURIComponent(token)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementKey, page, bbox, text }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data?.error || "Failed to create comment");
  },
  async addReply(commentId, { text }) {
    const r = await fetch(
      `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data?.error || "Failed to add reply");
  },
  async resolve(commentId, resolved) {
    const r = await fetch(
      `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      }
    );
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data?.error || "Failed to update comment");
  },
  async delete(commentId) {
    const r = await fetch(
      `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" }
    );
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data?.error || "Failed to delete comment");
  },
});

const formatPreviewTimestamp = (date) => {
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const ReviewPage = () => {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [review, setReview] = useState(null);

  const [decision, setDecision] = useState(null); // "approve" | "return"
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  // Signature preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [sigStatus, setSigStatus] = useState(null); // { hasSignature, signatureUrl, name, role }
  const [sigStatusLoading, setSigStatusLoading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);
  const [sigError, setSigError] = useState("");
  const [previewTimestamp, setPreviewTimestamp] = useState(null);
  const sigFileInputRef = useRef(null);
  const [unresolvedReviewerTotal, setUnresolvedReviewerTotal] = useState(0);
  const [summaryReady, setSummaryReady] = useState(false);

  // Poll the office's open-comment count so the Approve gate stays in sync
  // with comments resolved inside the PDF preview modal. Token endpoints are
  // already poll-based; reuse the same cadence.
  const refreshCommentSummary = async (t = token) => {
    if (!t) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/review/${encodeURIComponent(t)}/comment-summary`);
      const data = await r.json();
      if (r.ok && data.success) {
        setUnresolvedReviewerTotal(data.unresolvedReviewerTotal || 0);
        setSummaryReady(true);
        return;
      }
      // Endpoint missing (e.g. backend not yet restarted) — fail closed so the
      // gate can't be bypassed by an old server build.
      setSummaryReady(false);
    } catch (err) {
      console.warn("comment-summary fetch failed:", err);
      setSummaryReady(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);

    if (!t) {
      setLoadError("Missing review token in the link.");
      setLoading(false);
      return;
    }

    const fetchReview = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/review/${encodeURIComponent(t)}`);
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Backend returned an invalid response. Please try again later.");
        }
        if (!response.ok || !data.success) {
          throw new Error(data?.error || "Failed to load review.");
        }
        setReview(data.review);
        refreshCommentSummary(t);
      } catch (err) {
        setLoadError(err.message || "Failed to load review.");
      } finally {
        setLoading(false);
      }
    };

    fetchReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSignatureStatus = async () => {
    setSigStatusLoading(true);
    setSigError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/signature-status`
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || "Failed to load signature status.");
      }
      setSigStatus({
        hasSignature: !!data.hasSignature,
        signatureUrl: data.signatureUrl || null,
        name: data.name || "",
        role: data.role || "",
      });
    } catch (err) {
      setSigError(err.message || "Failed to load signature status.");
    } finally {
      setSigStatusLoading(false);
    }
  };

  const handleSignaturePicked = async (file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      setSigError("Only PNG or JPEG images are accepted.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSigError("Signature image must be 2MB or smaller.");
      return;
    }
    setSigUploading(true);
    setSigError("");
    try {
      const formData = new FormData();
      formData.append("signature", file);
      const response = await fetch(
        `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/signature`,
        { method: "POST", body: formData }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || "Failed to upload signature.");
      }
      setSigStatus((prev) => ({
        ...(prev || { name: "", role: "" }),
        hasSignature: true,
        signatureUrl: data.signatureUrl,
      }));
    } catch (err) {
      setSigError(err.message || "Failed to upload signature.");
    } finally {
      setSigUploading(false);
    }
  };

  const submitDecision = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/review/${encodeURIComponent(token)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: decision, remarks: remarks.trim() }),
        }
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Backend returned an invalid response. Please try again later.");
      }
      if (!response.ok || !data.success) {
        throw new Error(data?.error || "Failed to submit decision.");
      }
      setSubmitSuccess(
        decision === "approve"
          ? "Decision submitted: Approved. Your e-signature has been stamped on the endorsement letter."
          : "Decision submitted: Returned to the requesting organization."
      );
      setShowPreviewModal(false);
    } catch (err) {
      setSubmitError(err.message || "Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!decision) return;
    if (decision === "return" && !remarks.trim()) {
      setSubmitError("Please provide remarks before returning the proposal.");
      return;
    }
    if (decision === "approve") {
      if (!summaryReady) {
        setSubmitError(
          "Unable to verify open comments — the backend may not be running the latest build. Restart the server (npm run dev:all) and reload this page."
        );
        return;
      }
      if (unresolvedReviewerTotal > 0) {
        setSubmitError(
          `You still have ${unresolvedReviewerTotal} unresolved comment${unresolvedReviewerTotal === 1 ? "" : "s"} on this proposal. Resolve them or return the proposal for revision before approving.`
        );
        return;
      }
    }
    setSubmitError("");
    if (decision === "approve") {
      setPreviewTimestamp(new Date());
      setShowPreviewModal(true);
      await loadSignatureStatus();
      return;
    }
    await submitDecision();
  };

  const closePreviewModal = () => {
    if (submitting || sigUploading) return;
    setShowPreviewModal(false);
    setSigError("");
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="review-page">
      <header className="review-header">
        <div className="review-header-inner">
          <img src={sasLogo} alt="SAS Logo" className="review-logo" />
          <div>
            <h1 className="review-title">EARIST SAS Portal</h1>
            <p className="review-subtitle">Activity Proposal Review</p>
          </div>
        </div>
      </header>

      <main className="review-main">
        {loadError ? (
          <div className="review-error-card">
            <h2>Cannot open this review</h2>
            <p>{loadError}</p>
            <p className="review-error-hint">
              If you believe this link is valid, please contact the Student Affairs and Services
              office.
            </p>
          </div>
        ) : submitSuccess ? (
          <div className="review-success-card">
            <h2>Submitted</h2>
            <p>{submitSuccess}</p>
            <p className="review-success-hint">You may now close this tab.</p>
          </div>
        ) : (
          review && (
            <div className="review-card">
              <div className="review-card-header">
                <span className="review-stage-pill">
                  {STAGE_TITLES[review.stage] || review.stage}
                </span>
                <h2 className="review-doc-title">{review.title}</h2>
                {review.organizationName && (
                  <p className="review-doc-org">Submitted by {review.organizationName}</p>
                )}
              </div>

              {review.description && (
                <section className="review-section">
                  <h3 className="review-section-title">Description</h3>
                  <p className="review-description">{review.description}</p>
                </section>
              )}

              {review.proposalFlags && (
                <section className="review-section">
                  <h3 className="review-section-title">Event Type</h3>
                  <p>
                    {[
                      review.proposalFlags.hasSpeakers && "Has Speakers",
                      review.proposalFlags.collectsFees && "Collects Fees",
                    ]
                      .filter(Boolean)
                      .join(", ") || "Standard"}
                  </p>
                </section>
              )}

              {review.files?.length > 0 && (
                <section className="review-section">
                  <h3 className="review-section-title">Documents</h3>
                  <ul className="review-files-list">
                    {review.files.map((f, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="review-file-link"
                          onClick={() => setPreviewFile({
                            fileUrl: f.fileUrl,
                            fileName: f.fileName,
                            title: REQUIREMENT_LABELS[f.requirementKey] || f.fileName,
                            requirementKey: f.requirementKey,
                          })}
                        >
                          {REQUIREMENT_LABELS[f.requirementKey] || f.fileName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="review-decision-section">
                <h3 className="review-section-title">Your Decision</h3>
                <div className="review-decision-buttons">
                  <button
                    type="button"
                    className={`review-btn review-btn-approve ${decision === "approve" ? "is-selected" : ""}`}
                    onClick={() => { setDecision("approve"); setSubmitError(""); }}
                    disabled={submitting}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={`review-btn review-btn-return ${decision === "return" ? "is-selected" : ""}`}
                    onClick={() => { setDecision("return"); setSubmitError(""); }}
                    disabled={submitting}
                  >
                    Return for Revision
                  </button>
                </div>

                {decision && (
                  <div className="review-remarks-group">
                    <label className="review-remarks-label">
                      Remarks {decision === "return" ? "(required)" : "(optional)"}
                    </label>
                    <textarea
                      className="review-remarks-input"
                      rows={4}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder={
                        decision === "return"
                          ? "State the reason for returning this proposal..."
                          : "Optional notes for the SAS office..."
                      }
                      disabled={submitting}
                    />
                  </div>
                )}

                {decision === "approve" && unresolvedReviewerTotal > 0 && (
                  <p className="review-form-error">
                    ⚠ You still have {unresolvedReviewerTotal} unresolved
                    {unresolvedReviewerTotal === 1 ? " comment" : " comments"} on
                    this proposal. Resolve each one (open the affected file's
                    comments panel) or return the proposal for revision before
                    approving.
                  </p>
                )}

                {submitError && <p className="review-form-error">{submitError}</p>}

                {decision && (
                  <button
                    type="button"
                    className="review-btn review-btn-submit"
                    onClick={handleSubmit}
                    disabled={
                      submitting ||
                      (decision === "return" && !remarks.trim()) ||
                      (decision === "approve" &&
                        (!summaryReady || unresolvedReviewerTotal > 0))
                    }
                  >
                    {submitting
                      ? "Submitting..."
                      : decision === "approve"
                      ? "Continue to Signature Preview"
                      : "Submit Decision"}
                  </button>
                )}
              </section>
            </div>
          )
        )}
      </main>

      {showPreviewModal && (
        <div className="review-modal-overlay" onClick={closePreviewModal}>
          <div className="review-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="review-modal-header">
              <h2>Confirm Approval — Signature Preview</h2>
              <button
                type="button"
                className="review-modal-close"
                onClick={closePreviewModal}
                disabled={submitting || sigUploading}
              >
                ×
              </button>
            </div>

            <div className="review-modal-body">
              {sigStatusLoading ? (
                <p className="review-modal-info">Loading your signature on file...</p>
              ) : !sigStatus ? (
                <p className="review-form-error">{sigError || "Failed to load signature status."}</p>
              ) : !sigStatus.name || !sigStatus.role ? (
                <p className="review-form-error">
                  Your office profile is missing the full name or role. Please ask the SAS admin
                  to set them in Account Management before approving.
                </p>
              ) : !sigStatus.hasSignature ? (
                <>
                  <p className="review-modal-info">
                    No e-signature is on file for your office yet. Upload a PNG or JPEG image of
                    your signature to continue. It will be stored on the server and reused for
                    future approvals.
                  </p>
                  <button
                    type="button"
                    className="review-btn review-btn-approve"
                    onClick={() => sigFileInputRef.current?.click()}
                    disabled={sigUploading}
                  >
                    {sigUploading ? "Uploading..." : "Upload Signature Image"}
                  </button>
                  <input
                    ref={sigFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSignaturePicked(f);
                      e.target.value = "";
                    }}
                  />
                  {sigError && <p className="review-form-error">{sigError}</p>}
                </>
              ) : (
                <>
                  <p className="review-modal-info">
                    The block below will be stamped onto the SAS Endorsement Letter. Review it,
                    then confirm your approval.
                  </p>

                  <div className="signature-preview-block">
                    <p className="sig-preview-noted">Noted by:</p>
                    <img
                      src={sigStatus.signatureUrl}
                      alt="Your e-signature"
                      className="sig-preview-image"
                    />
                    <div className="sig-preview-line" />
                    <p className="sig-preview-name">{sigStatus.name}</p>
                    <p className="sig-preview-role">{sigStatus.role}</p>
                    <p className="sig-preview-disclaimer">
                      Electronically signed/approved on{" "}
                      {previewTimestamp ? formatPreviewTimestamp(previewTimestamp) : ""} via
                      secure review link
                    </p>
                  </div>

                  {sigError && <p className="review-form-error">{sigError}</p>}

                  <input
                    ref={sigFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSignaturePicked(f);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
            </div>

            <div className="review-modal-footer">
              <button
                type="button"
                className="review-btn review-btn-secondary"
                onClick={closePreviewModal}
                disabled={submitting || sigUploading}
              >
                Cancel
              </button>
              {sigStatus?.hasSignature && (
                <button
                  type="button"
                  className="review-btn review-btn-secondary"
                  onClick={() => sigFileInputRef.current?.click()}
                  disabled={submitting || sigUploading}
                >
                  {sigUploading ? "Uploading..." : "Replace Signature"}
                </button>
              )}
              <button
                type="button"
                className="review-btn review-btn-approve"
                onClick={submitDecision}
                disabled={
                  submitting ||
                  sigUploading ||
                  !sigStatus?.hasSignature ||
                  !sigStatus?.name ||
                  !sigStatus?.role
                }
              >
                {submitting ? "Submitting..." : "Confirm Approval"}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="review-footer">
        <p>© {new Date().getFullYear()} EARIST Student Affairs and Services</p>
      </footer>
      {previewFile && review && (
        <DocumentPreviewModal
          key={previewFile.fileUrl}
          fileUrl={previewFile.fileUrl}
          fileName={previewFile.fileName}
          title={previewFile.title}
          documentId={review.documentId}
          requirementKey={previewFile.requirementKey}
          documentStage={review.stage}
          authorScope={STAGE_TO_SCOPE[review.stage] || null}
          canPost={true}
          visibleStages={[review.stage]}
          currentUser={{
            name: previewFile.officeName || STAGE_TITLES[review.stage] || "Office",
            role: STAGE_TITLES[review.stage] || "",
          }}
          viewerRole="reviewer"
          commentApi={token ? buildTokenCommentApi(token) : null}
          onClose={() => {
            setPreviewFile(null);
            refreshCommentSummary();
          }}
        />
      )}
    </div>
  );
};

export default ReviewPage;
