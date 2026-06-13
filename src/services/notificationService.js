import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  updateDoc,
  limit as queryLimit,
} from "firebase/firestore";
import { db } from "../config/firebase";
import {
  REPORT_STATUS,
  REPORT_TYPE_LABELS,
} from "../utils/reportConstants";

/**
 * Notification Service
 *
 * In-app notifications stored in the `notifications` collection. Each
 * notification targets a single user (`recipientId`); fan-out for org-wide
 * or admin-wide notifications writes one doc per recipient.
 *
 * For notifications flagged with `alsoEmail`, an email is also sent via the
 * Express backend (`/api/send-notification-email`).
 */

const API_BASE = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001") 
  : (import.meta.env.VITE_API_BASE_URL || "");

export const NOTIFICATION_TYPES = {
  REPORT_DUE_SOON: "report_due_soon",
  REPORT_OVERDUE: "report_overdue",
  REPORT_SUBMITTED: "report_submitted",
  REPORT_REVIEWED: "report_reviewed",
  REPORT_REVISION: "report_revision",
};

export const REMINDER_TIERS = {
  T_MINUS_3: "T-3",
  T_MINUS_1: "T-1",
  T_PLUS_1: "T+1",
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

const daysBetween = (a, b) => {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

/**
 * Fire an email through the Express backend. Non-blocking — errors are
 * logged but never thrown.
 */
const sendNotificationEmail = async ({ to, subject, message, link }) => {
  if (!to) return;
  try {
    await fetch(`${API_BASE}/api/send-notification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, message, link }),
    });
  } catch (err) {
    console.error("Email notification failed:", err);
  }
};

/**
 * Create a notification for a single recipient. Optionally fires an email.
 */
export const createNotification = async ({
  recipientId,
  recipientEmail = null,
  type,
  title,
  message,
  link = null,
  sourceCollection = null,
  sourceId = null,
  reminderTier = null,
  alsoEmail = false,
}) => {
  if (!recipientId) throw new Error("recipientId is required");
  if (!type) throw new Error("type is required");

  const ref = doc(collection(db, "notifications"));
  const data = {
    notificationId: ref.id,
    recipientId,
    type,
    title: title || "",
    message: message || "",
    link,
    sourceCollection,
    sourceId,
    reminderTier,
    isRead: false,
    createdAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(ref, data);
  await batch.commit();

  if (alsoEmail && recipientEmail) {
    sendNotificationEmail({
      to: recipientEmail,
      subject: title,
      message,
      link,
    });
  }

  return ref.id;
};

/**
 * Fan out a notification to all users in an organization.
 */
export const notifyOrganization = async (organizationId, payload) => {
  if (!organizationId) return;
  const usersSnap = await getDocs(
    query(collection(db, "users"), where("organizationId", "==", organizationId))
  );
  await Promise.all(
    usersSnap.docs.map((u) =>
      createNotification({
        recipientId: u.id,
        recipientEmail: u.data().email || null,
        ...payload,
      }).catch((err) =>
        console.error("notifyOrganization recipient failed:", err)
      )
    )
  );
};

/**
 * Fan out a notification to all admin users.
 *
 * Routed through the Express backend so callers that are NOT admins
 * (e.g. an org user submitting a report) can still trigger admin alerts —
 * Firestore rules forbid org users from enumerating the users collection,
 * but the backend uses the Admin SDK which bypasses rules.
 */
export const notifyAdmins = async (payload) => {
  try {
    await fetch(`${API_BASE}/api/notify-admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payload.type,
        title: payload.title,
        message: payload.message,
        link: payload.link || null,
        sourceCollection: payload.sourceCollection || null,
        sourceId: payload.sourceId || null,
      }),
    });
  } catch (err) {
    console.error("notifyAdmins backend call failed:", err);
  }
};

/**
 * Subscribe to a user's notifications in real time.
 * Returns an unsubscribe function.
 */
export const subscribeToNotifications = (userId, callback) => {
  if (!userId) return () => {};
  const q = query(
    collection(db, "notifications"),
    where("recipientId", "==", userId),
    orderBy("createdAt", "desc"),
    queryLimit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    (err) => {
      console.error("Notification subscription error:", err);
      callback([]);
    }
  );
};

export const markAsRead = async (notificationId) => {
  if (!notificationId) return;
  await updateDoc(doc(db, "notifications", notificationId), { isRead: true });
};

export const markAllAsRead = async (userId) => {
  if (!userId) return;
  const q = query(
    collection(db, "notifications"),
    where("recipientId", "==", userId),
    where("isRead", "==", false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
};

/**
 * For a given report, check whether a reminder of the given tier has
 * already been sent (to anyone). Idempotency guard.
 */
const reminderAlreadySent = async (reportId, tier) => {
  const q = query(
    collection(db, "notifications"),
    where("sourceCollection", "==", "reports"),
    where("sourceId", "==", reportId),
    where("reminderTier", "==", tier),
    queryLimit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
};

/**
 * Scan all non-terminal reports and emit deadline reminders for any tier
 * whose window the report is now in (and that hasn't been sent yet).
 *
 * Tiers: T-3 (3 days until due), T-1 (1 day until due), T+1 (overdue).
 * Idempotent — safe to call on every admin dashboard mount and every login.
 */
export const checkAndFireReportReminders = async () => {
  const now = new Date();
  const horizonDays = 4; // covers T-3 plus a small buffer
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + horizonDays);

  const q = query(
    collection(db, "reports"),
    where("status", "in", [
      REPORT_STATUS.PENDING,
      REPORT_STATUS.LATE,
      REPORT_STATUS.NEEDS_REVISION,
    ]),
    where("dueDate", "<=", Timestamp.fromDate(horizon))
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    console.error("Report reminder scan failed:", err);
    return 0;
  }

  let fired = 0;
  for (const d of snap.docs) {
    const report = { id: d.id, ...d.data() };
    const dueDate = toDate(report.dueDate);
    if (!dueDate) continue;
    const diff = daysBetween(now, dueDate);

    let tier = null;
    let title = "";
    if (diff <= -1) {
      tier = REMINDER_TIERS.T_PLUS_1;
      title = `Overdue: ${REPORT_TYPE_LABELS[report.reportType] || "Report"}`;
    } else if (diff === 0 || diff === 1) {
      tier = REMINDER_TIERS.T_MINUS_1;
      title = `Due tomorrow: ${REPORT_TYPE_LABELS[report.reportType] || "Report"}`;
    } else if (diff <= 3) {
      tier = REMINDER_TIERS.T_MINUS_3;
      title = `Due in 3 days: ${REPORT_TYPE_LABELS[report.reportType] || "Report"}`;
    } else {
      continue;
    }

    const already = await reminderAlreadySent(report.id, tier);
    if (already) continue;

    const message = `${REPORT_TYPE_LABELS[report.reportType] || "Report"} for "${
      report.proposalTitle || "your activity"
    }" is due ${dueDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}.`;

    await notifyOrganization(report.organizationId, {
      type:
        tier === REMINDER_TIERS.T_PLUS_1
          ? NOTIFICATION_TYPES.REPORT_OVERDUE
          : NOTIFICATION_TYPES.REPORT_DUE_SOON,
      title,
      message,
      link: "reports",
      sourceCollection: "reports",
      sourceId: report.id,
      reminderTier: tier,
      alsoEmail: true,
    });
    fired += 1;
  }
  return fired;
};

/**
 * Convenience: notify admins that an org submitted a report.
 */
export const notifyReportSubmitted = async ({
  reportId,
  reportType,
  proposalTitle,
  organizationName,
}) => {
  await notifyAdmins({
    type: NOTIFICATION_TYPES.REPORT_SUBMITTED,
    title: `New ${REPORT_TYPE_LABELS[reportType] || "report"} submitted`,
    message: `${organizationName || "An organization"} submitted a ${
      REPORT_TYPE_LABELS[reportType] || "report"
    } for "${proposalTitle || "an activity"}".`,
    link: "reports",
    sourceCollection: "reports",
    sourceId: reportId,
    alsoEmail: false,
  });
};

/**
 * Convenience: notify the org that their report was reviewed (approved or
 * sent back for revision).
 */
export const notifyReportReviewed = async ({
  reportId,
  reportType,
  proposalTitle,
  organizationId,
  decision,
  remarks,
}) => {
  const isApprove = decision === "approve";
  await notifyOrganization(organizationId, {
    type: isApprove
      ? NOTIFICATION_TYPES.REPORT_REVIEWED
      : NOTIFICATION_TYPES.REPORT_REVISION,
    title: isApprove
      ? `${REPORT_TYPE_LABELS[reportType] || "Report"} approved`
      : `${REPORT_TYPE_LABELS[reportType] || "Report"} needs revision`,
    message: isApprove
      ? `Your ${REPORT_TYPE_LABELS[reportType] || "report"} for "${
          proposalTitle || "your activity"
        }" was reviewed and approved.`
      : `Your ${REPORT_TYPE_LABELS[reportType] || "report"} for "${
          proposalTitle || "your activity"
        }" needs revision. ${remarks ? `Reviewer remarks: ${remarks}` : ""}`.trim(),
    link: "reports",
    sourceCollection: "reports",
    sourceId: reportId,
    alsoEmail: true,
  });
};

/**
 * Lookup a report (used by trigger sites that only have the reportId).
 */
export const getReportLite = async (reportId) => {
  const snap = await getDoc(doc(db, "reports", reportId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};
