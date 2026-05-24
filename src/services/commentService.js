import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../config/firebase";

function commentsRef(documentId) {
  return collection(db, "documents", documentId, "comments");
}

/**
 * Subscribe to a per-document comment summary used for both the pipeline gate and
 * per-file indicators in the proposal detail view.
 *
 * Returns an object: { unresolvedReviewerTotal, byRequirement: { [key]: { total, unresolved, unresolvedReviewer } } }
 *
 * One listener covers the whole subcollection for a given document — caller buckets
 * by `requirementKey`, so individual file badges don't each need their own listener.
 */
export function subscribeToCommentSummary(documentId, callback) {
  if (!documentId) {
    callback({ unresolvedReviewerTotal: 0, byRequirement: {} });
    return () => {};
  }
  const q = collection(db, "documents", documentId, "comments");
  return onSnapshot(
    q,
    (snap) => {
      const byRequirement = {};
      let unresolvedReviewerTotal = 0;
      snap.docs.forEach((d) => {
        const c = d.data() || {};
        const key = c.requirementKey || "__unknown__";
        if (!byRequirement[key]) {
          byRequirement[key] = { total: 0, unresolved: 0, unresolvedReviewer: 0 };
        }
        byRequirement[key].total += 1;
        if (!c.resolved) {
          byRequirement[key].unresolved += 1;
          // Legacy comments (no authorSide) treated as reviewer-side — same convention
          // as subscribeToUnresolvedReviewerComments below.
          if (c.authorSide !== "org") {
            byRequirement[key].unresolvedReviewer += 1;
            unresolvedReviewerTotal += 1;
          }
        }
      });
      callback({ unresolvedReviewerTotal, byRequirement });
    },
    (err) => {
      console.error("comment-summary subscription error:", err);
      callback({ unresolvedReviewerTotal: 0, byRequirement: {} });
    }
  );
}

export function subscribeToUnresolvedReviewerComments(documentId, callback) {
  if (!documentId) {
    callback([]);
    return () => {};
  }
  const q = query(commentsRef(documentId), where("resolved", "==", false));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // authorSide may be missing on legacy data — treat unknown as reviewer-side
        // (safer: blocks stage advance until someone manually resolves the legacy comment).
        .filter((c) => c.authorSide !== "org");
      callback(items);
    },
    (err) => {
      console.error("unresolved-comments subscription error:", err);
      callback([]);
    }
  );
}

export function subscribeToComments(documentId, requirementKey, callback, options = {}) {
  if (!documentId || !requirementKey) {
    callback([]);
    return () => {};
  }
  const q = query(
    commentsRef(documentId),
    where("requirementKey", "==", requirementKey),
    orderBy("createdAt", "asc")
  );
  // visibleStages: null/undefined → see everything; array → only comments whose
  // `stage` field is in the list (legacy comments without `stage` are treated as
  // visible to everyone for backward compatibility).
  const visibleStages = options.visibleStages || null;
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => {
          if (!visibleStages) return true;
          if (!c.stage) return true;
          return visibleStages.includes(c.stage);
        });
      callback(items);
    },
    (err) => {
      console.error("comments subscription error:", err);
      callback([]);
    }
  );
}

export async function createComment({
  documentId,
  requirementKey,
  page,
  bbox,
  text,
  authorUid,
  authorName,
  authorRole,
  authorSide,
  authorScope,
  stage,
}) {
  if (!documentId || !requirementKey) throw new Error("documentId and requirementKey required");
  if (!text?.trim()) throw new Error("Comment text is required");
  return addDoc(commentsRef(documentId), {
    requirementKey,
    page,
    bbox,
    text: text.trim(),
    authorUid,
    authorName: authorName || "Unknown",
    authorRole: authorRole || "",
    authorSide: authorSide || "reviewer",
    authorScope: authorScope || null,
    stage: stage || null,
    createdAt: serverTimestamp(),
    resolved: false,
  });
}

export async function resolveComment(documentId, commentId, resolved = true) {
  return updateDoc(doc(db, "documents", documentId, "comments", commentId), {
    resolved,
  });
}

export async function deleteComment(documentId, commentId) {
  return deleteDoc(doc(db, "documents", documentId, "comments", commentId));
}

export async function bulkResolveByRevision(documentId, commentIds, revisionInfo) {
  if (!documentId || !commentIds?.length) return;
  const batch = writeBatch(db);
  for (const commentId of commentIds) {
    const ref = doc(db, "documents", documentId, "comments", commentId);
    batch.update(ref, {
      resolved: true,
      resolvedByRevision: {
        version: revisionInfo.version,
        fileName: revisionInfo.fileName,
        fileUrl: revisionInfo.fileUrl,
        reason: revisionInfo.reason || "",
        resolvedAt: Timestamp.now(),
        resolvedBy: revisionInfo.resolvedBy,
      },
    });
  }
  await batch.commit();
}

export async function addReply({
  documentId,
  commentId,
  text,
  authorUid,
  authorName,
  authorRole,
  authorSide,
  authorScope,
}) {
  if (!documentId || !commentId) throw new Error("documentId and commentId required");
  if (!text?.trim()) throw new Error("Reply text is required");
  // arrayUnion + serverTimestamp() can't be combined (Firestore rejects sentinels in arrays).
  // Use a client Timestamp instead — accuracy within a few seconds is fine for a comment reply.
  return updateDoc(doc(db, "documents", documentId, "comments", commentId), {
    replies: arrayUnion({
      text: text.trim(),
      authorUid,
      authorName: authorName || "User",
      authorRole: authorRole || "",
      authorSide: authorSide || "reviewer",
      authorScope: authorScope || null,
      createdAt: Timestamp.now(),
    }),
  });
}
