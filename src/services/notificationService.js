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
import { apiJson } from "./apiClient.js";
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

export const NOTIFICATION_TYPES = {
  REPORT_DUE_SOON: "report_due_soon",
  REPORT_OVERDUE: "report_overdue",
  REPORT_SUBMITTED: "report_submitted",
  REPORT_REVIEWED: "report_reviewed",
  REPORT_REVISION: "report_revision",
  EQUIPMENT_RETURN_DUE_SOON: "equipment_return_due_soon",
  EQUIPMENT_RETURN_OVERDUE: "equipment_return_overdue",
  EQUIPMENT_DAMAGE_REPORTED: "equipment_damage_reported",
  PROPOSAL_STAGE_ADVANCED: "proposal_stage_advanced",
  PROPOSAL_RETURNED: "proposal_returned",
  PROPOSAL_APPROVED: "proposal_approved",
  PROPOSAL_COMMENT: "proposal_comment",
  PROPOSAL_COMMENT_REPLY: "proposal_comment_reply",
  EQUIPMENT_REQUEST_APPROVED: "equipment_request_approved",
  EQUIPMENT_REQUEST_RETURNED: "equipment_request_returned",
  EQUIPMENT_REQUEST_REJECTED: "equipment_request_rejected",
  EQUIPMENT_RETURN_LATE: "equipment_return_late",
  ORG_BORROWING_RESTRICTED: "org_borrowing_restricted",
};

// User-meaningful groupings used by the notification preferences UI. Each
// notification type maps to a single category; the user toggles per-category,
// not per-type.
export const NOTIFICATION_CATEGORIES = {
  report_deadlines: {
    label: "Report deadlines",
    description: "Reminders before and after a report is due.",
    audience: "org",
    types: [NOTIFICATION_TYPES.REPORT_DUE_SOON, NOTIFICATION_TYPES.REPORT_OVERDUE],
  },
  report_status: {
    label: "Report status updates",
    description: "When the SAS office reviews a report you submitted.",
    audience: "org",
    types: [NOTIFICATION_TYPES.REPORT_REVIEWED, NOTIFICATION_TYPES.REPORT_REVISION],
  },
  equipment_reminders: {
    label: "Equipment return reminders",
    description: "Reminders to return borrowed equipment on time.",
    audience: "org",
    types: [
      NOTIFICATION_TYPES.EQUIPMENT_RETURN_DUE_SOON,
      NOTIFICATION_TYPES.EQUIPMENT_RETURN_OVERDUE,
    ],
  },
  proposal_updates: {
    label: "Activity proposal updates",
    description:
      "Stage advances, returns for revision, and final approval of your proposals.",
    audience: "org",
    types: [
      NOTIFICATION_TYPES.PROPOSAL_STAGE_ADVANCED,
      NOTIFICATION_TYPES.PROPOSAL_RETURNED,
      NOTIFICATION_TYPES.PROPOSAL_APPROVED,
    ],
  },
  equipment_status: {
    label: "Equipment request status",
    description:
      "Approval, revision, rejection, or borrowing restriction of your equipment requests.",
    audience: "org",
    types: [
      NOTIFICATION_TYPES.EQUIPMENT_REQUEST_APPROVED,
      NOTIFICATION_TYPES.EQUIPMENT_REQUEST_RETURNED,
      NOTIFICATION_TYPES.EQUIPMENT_REQUEST_REJECTED,
      NOTIFICATION_TYPES.ORG_BORROWING_RESTRICTED,
    ],
  },
  proposal_comments: {
    label: "Proposal comments",
    description:
      "New comments or replies from reviewing offices on your activity proposals.",
    audience: "org",
    types: [
      NOTIFICATION_TYPES.PROPOSAL_COMMENT,
      NOTIFICATION_TYPES.PROPOSAL_COMMENT_REPLY,
    ],
  },
  admin_alerts: {
    label: "Admin alerts",
    description: "When organizations submit reports, or equipment is damaged or returned late.",
    audience: "admin",
    types: [
      NOTIFICATION_TYPES.REPORT_SUBMITTED,
      NOTIFICATION_TYPES.EQUIPMENT_DAMAGE_REPORTED,
      NOTIFICATION_TYPES.EQUIPMENT_RETURN_LATE,
    ],
  },
};

const TYPE_TO_CATEGORY = Object.entries(NOTIFICATION_CATEGORIES).reduce(
  (acc, [catId, cat]) => {
    cat.types.forEach((t) => {
      acc[t] = catId;
    });
    return acc;
  },
  {}
);

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.keys(
  NOTIFICATION_CATEGORIES
).reduce((acc, catId) => {
  acc[catId] = { inApp: true, email: true };
  return acc;
}, {});

const getRecipientPrefs = async (recipientId) => {
  try {
    const snap = await getDoc(doc(db, "users", recipientId));
    if (!snap.exists()) return null;
    return snap.data().notificationPreferences || null;
  } catch (err) {
    console.warn("getRecipientPrefs failed:", err?.message || err);
    return null;
  }
};

// Resolve effective preference for a type+channel. Defaults to ON when the
// user doc has no prefs set yet (back-compat for accounts created before
// this feature).
const effectivePref = (prefs, category, channel) => {
  if (!category) return true;
  const cat = prefs?.[category];
  if (!cat) return DEFAULT_NOTIFICATION_PREFERENCES[category]?.[channel] ?? true;
  return cat[channel] !== false;
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
    await apiJson(
      "/api/send-notification-email",
      { to, subject, message, link },
      { auth: true }
    );
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
  overridePreferences = false,
}) => {
  if (!recipientId) throw new Error("recipientId is required");
  if (!type) throw new Error("type is required");

  // Honor recipient preferences unless explicitly overridden (reserved for
  // future security/critical messages — currently nothing sets it).
  const category = TYPE_TO_CATEGORY[type] || null;
  const prefs = overridePreferences ? null : await getRecipientPrefs(recipientId);
  const inAppAllowed = overridePreferences || effectivePref(prefs, category, "inApp");
  const emailAllowed = overridePreferences || effectivePref(prefs, category, "email");

  if (!inAppAllowed && !(alsoEmail && emailAllowed)) {
    // User muted both channels for this category — nothing to do.
    return null;
  }

  let id = null;
  if (inAppAllowed) {
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
    id = ref.id;
  }

  if (alsoEmail && emailAllowed && recipientEmail) {
    sendNotificationEmail({
      to: recipientEmail,
      subject: title,
      message,
      link,
    });
  }

  return id;
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
 * Fan out a notification to all members of an organization, routed through
 * the Express backend. Use this from non-admin signed-in clients (ISG, org
 * users) who cannot enumerate the users collection — the backend uses the
 * Admin SDK to bypass Firestore rules.
 *
 * Admins should prefer the direct `notifyOrganization` helper, which avoids
 * the extra network hop.
 */
export const notifyOrganizationViaApi = async (organizationId, payload) => {
  if (!organizationId || !payload?.type || !payload?.title) return;
  try {
    await apiJson(
      "/api/notify-organization",
      {
        organizationId,
        type: payload.type,
        category: TYPE_TO_CATEGORY[payload.type] || null,
        title: payload.title,
        message: payload.message,
        link: payload.link || null,
        sourceCollection: payload.sourceCollection || null,
        sourceId: payload.sourceId || null,
        alsoEmail: !!payload.alsoEmail,
      },
      { auth: true }
    );
  } catch (err) {
    console.error("notifyOrganizationViaApi backend call failed:", err);
  }
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
    await apiJson(
      "/api/notify-admins",
      {
        type: payload.type,
        category: TYPE_TO_CATEGORY[payload.type] || null,
        title: payload.title,
        message: payload.message,
        link: payload.link || null,
        sourceCollection: payload.sourceCollection || null,
        sourceId: payload.sourceId || null,
        alsoEmail: !!payload.alsoEmail,
      },
      { auth: true }
    );
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
