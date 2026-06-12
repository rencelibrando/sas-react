import { useEffect, useState, useMemo } from "react";
import PdfViewer from "./PdfViewer";
import PdfCommentLayer from "./PdfCommentLayer";
import CommentThreadPanel from "./CommentThreadPanel";
import RevisionUploadModal from "./RevisionUploadModal";
import {
  subscribeToComments,
  createComment,
  resolveComment,
  deleteComment,
  addReply,
} from "../../services/commentService";
import { uploadRevision } from "../../services/documentService";
import { canReplyOnComment } from "../../utils/commentScope";
import "./DocumentPreviewModal.css";

const PDF_EXT = ["pdf"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif"];

function detectKind(fileName, fileUrl) {
  const source = (fileName || fileUrl || "").toLowerCase();
  const match = source.match(/\.([a-z0-9]+)(?:\?|#|$)/);
  const ext = match ? match[1] : "";
  if (PDF_EXT.includes(ext)) return "pdf";
  if (IMAGE_EXT.includes(ext)) return "image";
  return "other";
}

export default function DocumentPreviewModal({
  fileUrl,
  fileName,
  title,
  onClose,
  // Optional commenting context — only PDFs with all four are commentable
  documentId,
  requirementKey,
  currentUser,
  viewerRole, // "reviewer" | "org"
  fileVersion,
  previousVersion,
  onRevisionUploaded,
  // Stage-scoped commenting — when provided, comments are tagged with `stage`
  // and visibility/post permissions are gated by scope.
  documentStage = null,    // pipeline.currentStage of the parent doc
  authorScope = null,      // submitter | sas | isg | vpaa | op | fms | procurement
  visibleStages = null,    // array of stages this viewer may see; null = all
  canPost = true,          // whether this viewer may author new comments now
  // Optional commentApi for token-bound contexts (e.g. ReviewPage). Shape:
  //   { subscribe(requirementKey, onChange) -> unsubscribe,
  //     create(payload), addReply(commentId, payload),
  //     resolve(commentId, resolved), delete(commentId) }
  commentApi = null,
}) {
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [draftBox, setDraftBox] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [revisionDraft, setRevisionDraft] = useState(null); // selected comments awaiting upload

  const kind = fileUrl ? detectKind(fileName, fileUrl) : "other";
  const commentingEnabled =
    kind === "pdf" && !!documentId && !!requirementKey && (!!commentApi || !!currentUser?.uid);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!commentingEnabled) return;
    if (commentApi?.subscribe) {
      return commentApi.subscribe(requirementKey, (items) => {
        const filtered = visibleStages
          ? items.filter((c) => !c.stage || visibleStages.includes(c.stage))
          : items;
        setComments(filtered);
      });
    }
    const unsub = subscribeToComments(documentId, requirementKey, setComments, {
      visibleStages,
    });
    return () => unsub?.();
  }, [commentingEnabled, commentApi, documentId, requirementKey, visibleStages]);

  const canReplyOn = useMemo(() => {
    return (c) => canReplyOnComment(authorScope, c?.stage, documentStage);
  }, [authorScope, documentStage]);

  if (!fileUrl) return null;

  const displayTitle = title || fileName || "Document";

  const handleCreateBox = (box) => {
    setDraftBox(box);
    setDrawingEnabled(false);
  };

  const handleSubmitDraft = async (text) => {
    if (!draftBox) return;
    const payload = {
      page: draftBox.page,
      bbox: { x: draftBox.x, y: draftBox.y, w: draftBox.w, h: draftBox.h },
      text,
      authorName: currentUser?.name || currentUser?.displayName || "User",
      authorRole: currentUser?.role || "",
      authorSide: viewerRole || "reviewer",
      authorScope: authorScope || null,
      stage: documentStage || null,
    };
    if (commentApi?.create) {
      await commentApi.create({ requirementKey, ...payload });
    } else {
      await createComment({
        documentId,
        requirementKey,
        ...payload,
        authorUid: currentUser.uid,
      });
    }
    setDraftBox(null);
  };

  const handleResolveToggle = async (c) => {
    if (commentApi?.resolve) {
      await commentApi.resolve(c.id, !c.resolved);
    } else {
      await resolveComment(documentId, c.id, !c.resolved);
    }
  };

  const handleDeleteComment = async (c) => {
    if (commentApi?.delete) {
      await commentApi.delete(c.id);
    } else {
      await deleteComment(documentId, c.id);
    }
    if (activeCommentId === c.id) setActiveCommentId(null);
  };

  const handleAddReply = async (c, text) => {
    const payload = {
      text,
      authorName: currentUser?.name || currentUser?.displayName || "User",
      authorRole: currentUser?.role || "",
      authorSide: viewerRole || "reviewer",
      authorScope: authorScope || null,
    };
    if (commentApi?.addReply) {
      await commentApi.addReply(c.id, payload);
    } else {
      await addReply({
        documentId,
        commentId: c.id,
        ...payload,
        authorUid: currentUser.uid,
      });
    }
  };

  const handleStartRevision = (selectedComments) => {
    setRevisionDraft(selectedComments);
  };

  const handleSubmitRevision = async ({ file, reason }) => {
    await uploadRevision({
      documentId,
      requirementKey,
      file,
      reason,
      commentIds: revisionDraft.map((c) => c.id),
      userId: currentUser.uid,
    });
    setRevisionDraft(null);
    onRevisionUploaded?.();
    onClose?.();
  };

  return (
    <div className="modal-overlay doc-preview-overlay" onClick={onClose}>
      <div
        className={`modal-content doc-preview-content${commentingEnabled ? " has-comments" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header doc-preview-header">
          <h3 title={displayTitle}>
            {displayTitle}
            {fileVersion && fileVersion > 1 && (
              <span className="doc-preview-version-badge" title="This file has been revised">
                Revised v{fileVersion}
              </span>
            )}
          </h3>
          <div className="doc-preview-header-actions">
            {previousVersion?.fileUrl && (
              <a
                href={previousVersion.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="doc-preview-popout"
                title="Open the previous version in a new tab"
              >
                ↺ View previous (v{previousVersion.version || 1})
              </a>
            )}
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="doc-preview-popout"
              title="Open in new tab"
            >
              ↗ Open in new tab
            </a>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close preview"
            >
              ×
            </button>
          </div>
        </div>

        <div className="doc-preview-body">
          {kind === "pdf" && (
            <PdfViewer
              key={fileUrl}
              fileUrl={fileUrl}
              onPageChange={setCurrentPage}
              renderOverlay={
                commentingEnabled
                  ? ({ pageNum, pageWidth, pageHeight }) => (
                      <PdfCommentLayer
                        pageNum={pageNum}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                        comments={comments}
                        activeCommentId={activeCommentId}
                        onSelectComment={setActiveCommentId}
                        drawingEnabled={drawingEnabled && !draftBox}
                        onCreateBox={handleCreateBox}
                      />
                    )
                  : undefined
              }
            />
          )}

          {kind === "image" && (
            <div className="doc-preview-image-wrap">
              <img
                src={fileUrl}
                alt={displayTitle}
                className="doc-preview-image"
              />
            </div>
          )}

          {kind === "other" && (
            <div className="doc-preview-fallback">
              <p>
                In-browser preview isn't available for this file type
                {fileName ? ` (${fileName})` : ""}.
              </p>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="doc-preview-fallback-btn"
              >
                Open in new tab
              </a>
            </div>
          )}
        </div>

        {commentingEnabled && (
          <CommentThreadPanel
            comments={comments}
            pageNum={currentPage}
            drafting={draftBox}
            onCancelDraft={() => setDraftBox(null)}
            onSubmitDraft={handleSubmitDraft}
            onResolveToggle={handleResolveToggle}
            onDeleteComment={handleDeleteComment}
            onAddReply={handleAddReply}
            onUploadRevision={handleStartRevision}
            onStartDrawing={() => {
              setDraftBox(null);
              setDrawingEnabled((d) => !d);
            }}
            drawingEnabled={drawingEnabled}
            activeCommentId={activeCommentId}
            onSelectComment={setActiveCommentId}
            currentUser={currentUser}
            viewerRole={viewerRole}
            canPost={canPost}
            canReplyOn={canReplyOn}
            authorScope={authorScope}
            documentStage={documentStage}
          />
        )}
      </div>

      {revisionDraft && (
        <RevisionUploadModal
          currentFileName={fileName || "current file"}
          selectedComments={revisionDraft}
          onCancel={() => setRevisionDraft(null)}
          onSubmit={handleSubmitRevision}
        />
      )}
    </div>
  );
}
