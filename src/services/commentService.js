import {
  collection,
  doc,
  getDoc,
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
import {
  notifyAdmins,
  notifyOrganizationViaApi,
  NOTIFICATION_TYPES,
} from "./notificationService";

/**
 * Fire-and-forget notification fan-out after a portal-side comment or reply.
 * - Submitter author → notify SAS admins so they don't miss the org's reply.
 * - Reviewer author (SAS/ISG) → notify the requesting org via the backend so
 *   ISG (which can't enumerate users) still works.
 */
const notifyCommentParticipants = async ({
  documentId,
  authorSide,
  authorScope,
  authorName,
  text,
  isReply,
}) => {
  if (!documentId) return;
  try {
    const snap = await getDoc(doc(db, "documents", documentId));
    if (!snap.exists()) return;
    const data = snap.data();
    const trimmed = String(text || "").trim();
    const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    const title = data.title || documentId;

    if (authorSide === "org" || authorScope === "submitter") {
      const heading = isReply
        ? `Org reply on "${title}"`
        : `Org comment on "${title}"`;
      notifyAdmins({
        type: isReply
          ? NOTIFICATION_TYPES.PROPOSAL_COMMENT_REPLY
          : NOTIFICATION_TYPES.PROPOSAL_COMMENT,
        title: heading,
        message: `${authorName || "An organization member"} ${
          isReply ? "replied on a comment thread" : "left a comment"
        } for "${title}":\n\n${preview}`,
        link: "activity-proposals",
        sourceCollection: "documents",
        sourceId: documentId,
        alsoEmail: true,
      }).catch((err) =>
        console.warn("comment → notifyAdmins failed:", err?.message || err)
      );
      return;
    }

    if (!data.organizationId) return;
    const heading = isReply
      ? `New reply on "${title}"`
      : `New comment on "${title}"`;
    notifyOrganizationViaApi(data.organizationId, {
      type: isReply
        ? NOTIFICATION_TYPES.PROPOSAL_COMMENT_REPLY
        : NOTIFICATION_TYPES.PROPOSAL_COMMENT,
      title: heading,
      message: `${authorName || "A reviewing office"} ${
        isReply ? "replied on a comment thread" : "left a comment"
      } on your activity proposal:\n\n${preview}`,
      link: "activity-proposals",
      sourceCollection: "documents",
      sourceId: documentId,
      alsoEmail: true,
    }).catch((err) =>
      console.warn("comment → notifyOrganization failed:", err?.message || err)
    );
  } catch (err) {
    console.warn("notifyCommentParticipants failed:", err?.message || err);
  }
};

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
  const result = await addDoc(commentsRef(documentId), {
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
  notifyCommentParticipants({
    documentId,
    authorSide,
    authorScope,
    authorName,
    text,
    isReply: false,
  });
  return result;
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
  const result = await updateDoc(doc(db, "documents", documentId, "comments", commentId), {
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
  notifyCommentParticipants({
    documentId,
    authorSide,
    authorScope,
    authorName,
    text,
    isReply: true,
  });
  return result;
}
