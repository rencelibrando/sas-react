import { useState, useEffect, useRef } from "react";

function formatTimestamp(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString();
}

function ReplyComposer({ onSubmit, onCancel }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(text);
      setText("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="pdf-comment-reply-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        rows={2}
        disabled={submitting}
      />
      <div className="pdf-comment-reply-actions">
        <button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" disabled={submitting || !text.trim()}>
          {submitting ? "Posting…" : "Reply"}
        </button>
      </div>
    </form>
  );
}

export default function CommentThreadPanel({
  comments,
  pageNum,
  drafting,
  onCancelDraft,
  onSubmitDraft,
  onResolveToggle,
  onDeleteComment,
  onAddReply,
  onStartDrawing,
  onUploadRevision,
  drawingEnabled,
  activeCommentId,
  onSelectComment,
  currentUser,
  viewerRole,
  canPost = true,
  canReplyOn = null,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [draftText, setDraftText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const draftRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (drafting) {
      setDraftText("");
      draftRef.current?.focus();
    }
  }, [drafting]);

  useEffect(() => {
    if (activeCommentId && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeCommentId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draftText.trim()) return;
    setSubmitting(true);
    try {
      await onSubmitDraft?.(draftText);
      setDraftText("");
    } finally {
      setSubmitting(false);
    }
  };

  const sorted = [...(comments || [])].sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });

  const isOrgViewer = viewerRole === "org";

  // Selection is only applicable to unresolved reviewer comments (i.e. authored by the
  // other side). Use authorSide if present; fall back to "not me" for legacy data.
  const isSelectable = (c) => {
    if (!isOrgViewer || c.resolved) return false;
    if (c.authorSide) return c.authorSide === "reviewer";
    return c.authorUid !== currentUser?.uid;
  };

  const selectedComments = sorted.filter((c) => selectedIds.has(c.id));
  const selectableCount = sorted.filter(isSelectable).length;

  const handleResolveAndUpload = () => {
    if (selectedComments.length === 0) return;
    onUploadRevision?.(selectedComments);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleResolveClick = (e, c) => {
    e.stopPropagation();
    if (!c.resolved) {
      const ok = window.confirm(
        "Are you sure your concern doesn't need a revision?\n\n" +
        "Resolving without a revision marks this comment as addressed by the reply alone. " +
        "If you actually need a revised file, leave this comment unresolved instead."
      );
      if (!ok) return;
    }
    onResolveToggle?.(c);
  };

  return (
    <aside className="pdf-comment-panel">
      <div className="pdf-comment-panel-header">
        <h4>Comments</h4>
        {canPost && (
          <button
            type="button"
            className={`pdf-comment-add-btn${drawingEnabled ? " is-active" : ""}`}
            onClick={onStartDrawing}
            title="Drag a region on the PDF to anchor a new comment"
          >
            {drawingEnabled ? "Cancel" : "+ Add comment"}
          </button>
        )}
      </div>
      {!canPost && (
        <div className="pdf-comment-hint">
          This document is not at your office's stage. You can view the existing
          conversation but cannot post new comments right now.
        </div>
      )}

      {drawingEnabled && !drafting && (
        <div className="pdf-comment-hint">
          Drag a rectangle on the PDF to mark the area you're commenting on.
        </div>
      )}

      {drafting && (
        <form className="pdf-comment-draft-form" onSubmit={handleSubmit}>
          <div className="pdf-comment-draft-meta">
            New comment on page {drafting.page}
          </div>
          <textarea
            ref={draftRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Type your comment…"
            rows={3}
            disabled={submitting}
          />
          <div className="pdf-comment-draft-actions">
            <button type="button" onClick={onCancelDraft} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || !draftText.trim()}>
              {submitting ? "Posting…" : "Post"}
            </button>
          </div>
        </form>
      )}

      {isOrgViewer && selectableCount > 0 && (
        <div className="pdf-comment-bulk-bar">
          {selectedIds.size === 0 ? (
            <span className="pdf-comment-bulk-hint">
              Tick the comments you're addressing in the next revision.
            </span>
          ) : (
            <>
              <span>{selectedIds.size} selected</span>
              <button type="button" onClick={clearSelection}>Clear</button>
              <button
                type="button"
                className="pdf-comment-bulk-primary"
                onClick={handleResolveAndUpload}
              >
                Resolve &amp; Upload Revision
              </button>
            </>
          )}
        </div>
      )}

      <div className="pdf-comment-list">
        {sorted.length === 0 && !drafting && (
          <div className="pdf-comment-empty">
            No comments yet. Click "+ Add comment" then drag a region on the PDF.
          </div>
        )}

        {sorted.map((c) => {
          const isActive = c.id === activeCommentId;
          const isMine = currentUser?.uid && c.authorUid === currentUser.uid;
          const replies = c.replies || [];
          const orgHasReplied = replies.some((r) => r.authorSide === "org");
          const selectable = isSelectable(c);
          const isSelected = selectedIds.has(c.id);

          // Reviewer can resolve their own comment only after the org has replied.
          // Already-resolved comments can be reopened by the original commenter (any time).
          const canResolveNow =
            isMine && viewerRole === "reviewer" && !c.resolved && orgHasReplied;
          const canReopen =
            isMine && viewerRole === "reviewer" && c.resolved;

          // Reply authorship: prefer the stage-scoped predicate when provided
          // (used by ReviewPage and stage-aware portal contexts). Fall back to
          // the legacy "original commenter OR requesting org" rule.
          const canReply = canReplyOn
            ? canReplyOn(c)
            : (isMine || viewerRole === "org");

          return (
            <div
              key={c.id}
              ref={isActive ? activeRef : null}
              className={`pdf-comment-item${isActive ? " is-active" : ""}${c.resolved ? " is-resolved" : ""}${isSelected ? " is-selected" : ""}`}
              onClick={() => onSelectComment?.(c.id)}
            >
              <div className="pdf-comment-item-head">
                {selectable && (
                  <input
                    type="checkbox"
                    className="pdf-comment-select"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(c.id)}
                    title="Resolve via next revision"
                  />
                )}
                <span className="pdf-comment-author">{c.authorName}</span>
                {c.authorRole && (
                  <span className="pdf-comment-role">{c.authorRole}</span>
                )}
                <span className="pdf-comment-page">p.{c.page}</span>
              </div>
              <div className="pdf-comment-text">{c.text}</div>
              <div className="pdf-comment-time">{formatTimestamp(c.createdAt)}</div>

              {c.resolvedByRevision && (
                <div className="pdf-comment-revision-note">
                  Resolved by revision v{c.resolvedByRevision.version} ·{" "}
                  {c.resolvedByRevision.fileName}
                  {c.resolvedByRevision.reason ? ` — ${c.resolvedByRevision.reason}` : ""}
                </div>
              )}

              {replies.length > 0 && (
                <div className="pdf-comment-replies">
                  {replies.map((r, i) => (
                    <div key={i} className="pdf-comment-reply">
                      <div className="pdf-comment-reply-head">
                        <span className="pdf-comment-author">{r.authorName}</span>
                        {r.authorRole && (
                          <span className="pdf-comment-role">{r.authorRole}</span>
                        )}
                        <span className="pdf-comment-time">{formatTimestamp(r.createdAt)}</span>
                      </div>
                      <div className="pdf-comment-text">{r.text}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pdf-comment-item-actions">
                {canReply && replyingTo !== c.id && !c.resolved && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyingTo(c.id);
                    }}
                  >
                    Reply
                  </button>
                )}
                {canResolveNow && (
                  <button type="button" onClick={(e) => handleResolveClick(e, c)}>
                    Resolve
                  </button>
                )}
                {canReopen && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onResolveToggle?.(c); }}>
                    Reopen
                  </button>
                )}
                {isMine && (
                  <button
                    type="button"
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this comment? This cannot be undone.")) {
                        onDeleteComment?.(c);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>

              {replyingTo === c.id && (
                <ReplyComposer
                  onCancel={() => setReplyingTo(null)}
                  onSubmit={async (text) => {
                    await onAddReply?.(c, text);
                    setReplyingTo(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="pdf-comment-panel-footer">
        Page {pageNum} • {sorted.filter((c) => c.page === pageNum).length} on this page
      </div>
    </aside>
  );
}
