import { useState, useEffect } from "react";
import { getReleasedOutgoingDocuments } from "../services/documentService";
import { formatDate } from "../utils/formatters";
import DocumentPreviewModal from "./documents/DocumentPreviewModal";
import "./MemorandumsSection.css";

const MemorandumsSection = ({ heading = "Memorandums" }) => {
  const [loading, setLoading] = useState(true);
  const [memorandums, setMemorandums] = useState([]);
  const [previewMemo, setPreviewMemo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const docs = await getReleasedOutgoingDocuments();
        if (cancelled) return;
        setMemorandums(docs.filter((d) => d.documentType === "Memorandum"));
      } catch (err) {
        console.error("Error loading memorandums:", err);
        if (!cancelled) setError("Failed to load memorandums.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="memorandums-section">
      <div className="memorandums-section-header">
        <h2 className="memorandums-section-title">{heading}</h2>
        <span className="memorandums-section-count">{memorandums.length}</span>
      </div>

      {loading ? (
        <div className="memorandums-loading">Loading…</div>
      ) : error ? (
        <div className="memorandums-error">{error}</div>
      ) : memorandums.length === 0 ? (
        <div className="memorandums-empty">
          <div className="memorandums-empty-icon">📄</div>
          <p className="memorandums-empty-message">No memorandums posted yet.</p>
        </div>
      ) : (
        <div className="memorandums-list">
          {memorandums.map((memo) => (
            <div
              key={memo.documentId}
              className="memorandum-card"
              onClick={() => memo.fileUrl && setPreviewMemo(memo)}
              role={memo.fileUrl ? "button" : undefined}
              tabIndex={memo.fileUrl ? 0 : undefined}
              onKeyDown={(e) => {
                if (memo.fileUrl && (e.key === "Enter" || e.key === " ")) {
                  setPreviewMemo(memo);
                }
              }}
            >
              <div className="memorandum-card-header">
                <div className="memorandum-type-badge">Memorandum</div>
                {memo.documentNumber && (
                  <span className="memorandum-number">{memo.documentNumber}</span>
                )}
              </div>
              <h3 className="memorandum-title">{memo.title}</h3>
              {memo.description && (
                <p className="memorandum-description">
                  {memo.description.length > 200
                    ? `${memo.description.substring(0, 200)}...`
                    : memo.description}
                </p>
              )}
              <div className="memorandum-card-footer">
                <span className="memorandum-date">
                  Released: {formatDate(memo.dateReleased || memo.dateSubmitted)}
                </span>
                {memo.fileUrl && (
                  <a
                    href={memo.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="memorandum-download-btn"
                    onClick={(e) => e.stopPropagation()}
                  >
                    📥 Download
                  </a>
                )}
              </div>
            </div>
          ))}
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
    </section>
  );
};

export default MemorandumsSection;
