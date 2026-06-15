import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  startAfter,
  limit as queryLimit,
  serverTimestamp,
  Timestamp,
  getDocs,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";

/**
 * Admin Activity Log
 *
 * Tracks admin mutations to user, org, equipment, memorandum, and proposal
 * pipeline state — anything visible to a reviewer answering "who did what,
 * when". Distinct from authActivityLog (auth events only) and
 * documentStatusHistory (proposal state machine).
 *
 * Writes are best-effort and never throw — a logging failure must not break
 * the underlying admin action.
 */

export const ADMIN_ACTION_TYPES = [
  // Organizations
  "org_created",
  "org_updated",
  "org_deleted",
  // Equipment
  "equipment_created",
  "equipment_updated",
  "equipment_deleted",
  // Users
  "user_role_changed",
  "user_status_changed",
  "user_deleted",
  // Memorandums / outgoing
  "memorandum_created",
  "memorandum_released",
  // Proposal pipeline (SAS-side actions)
  "proposal_forwarded_to_vpaa",
  "proposal_returned_from_sas",
  "proposal_released",
  "proposal_review_link_regenerated",
  "proposal_deleted",
  // Server-side endpoints
  "account_created_by_admin",
  "admin_password_reset",
];

const ADMIN_ACTION_TYPE_SET = new Set(ADMIN_ACTION_TYPES);

export const ADMIN_ACTION_LABELS = {
  org_created: "Organization created",
  org_updated: "Organization updated",
  org_deleted: "Organization deleted",
  equipment_created: "Equipment item created",
  equipment_updated: "Equipment item updated",
  equipment_deleted: "Equipment item deleted",
  user_role_changed: "User role changed",
  user_status_changed: "User status changed",
  user_deleted: "User account deleted",
  memorandum_created: "Memorandum created",
  memorandum_released: "Memorandum released",
  proposal_forwarded_to_vpaa: "Proposal forwarded to VPAA",
  proposal_returned_from_sas: "Proposal returned to organization",
  proposal_released: "Proposal released",
  proposal_review_link_regenerated: "Review link regenerated",
  proposal_deleted: "Proposal deleted",
  account_created_by_admin: "Account created (by admin)",
  admin_password_reset: "Password reset (by admin)",
};

/**
 * Record an admin action. Best-effort — does not throw on failure.
 *
 * @param {Object}   p
 * @param {string}   p.type             one of ADMIN_ACTION_TYPES
 * @param {string}   [p.targetCollection] e.g. "organizations", "users"
 * @param {string}   [p.targetId]       Firestore doc ID of the affected entity
 * @param {string}   [p.targetLabel]    human-readable label (org name, user email)
 * @param {Object}   [p.before]         optional pre-change snapshot
 * @param {Object}   [p.after]          optional post-change snapshot
 * @param {string}   [p.remarks]        optional free-text context
 */
export const logAdminAction = async ({
  type,
  targetCollection = null,
  targetId = null,
  targetLabel = null,
  before = null,
  after = null,
  remarks = null,
} = {}) => {
  try {
    if (!type || !ADMIN_ACTION_TYPE_SET.has(type)) {
      console.warn("logAdminAction: unknown action type", type);
      return;
    }
    const actor = auth.currentUser;
    if (!actor) {
      console.warn("logAdminAction: no authenticated user — skipping");
      return;
    }
    await addDoc(collection(db, "adminActivityLog"), {
      type,
      actorUid: actor.uid,
      actorEmail: actor.email || null,
      targetCollection,
      targetId,
      targetLabel,
      before,
      after,
      remarks,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.warn("logAdminAction failed:", error?.message || error);
  }
};

/**
 * Fetch a page of admin actions, newest first. Mirrors getAuthActivityLog's
 * shape so the admin UI can reuse the same list pattern.
 */
export const getAdminActivityLog = async ({
  from,
  to,
  cursor = null,
  pageSize = 50,
} = {}) => {
  if (!(from instanceof Date) || !(to instanceof Date)) {
    throw new Error("from/to must be Date instances");
  }
  const parts = [
    where("timestamp", ">=", Timestamp.fromDate(from)),
    where("timestamp", "<=", Timestamp.fromDate(to)),
    orderBy("timestamp", "desc"),
  ];
  if (cursor) parts.push(startAfter(cursor));
  parts.push(queryLimit(pageSize));

  const q = query(collection(db, "adminActivityLog"), ...parts);
  const snap = await getDocs(q);
  const entries = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      timestamp: data.timestamp?.toDate?.() || null,
    };
  });
  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { entries, lastDoc };
};
