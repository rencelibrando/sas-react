import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  limit as queryLimit,
} from "firebase/firestore";
import { db } from "../config/firebase";
import {
  createNotification,
  NOTIFICATION_TYPES,
} from "./notificationService";

const STAGE_LABELS = {
  vpaa_review: "VPAA",
  op_approval: "Office of the President",
  fms_review: "FMS",
  procurement_review: "Procurement",
};

const TOKEN_REMINDER_TIERS = {
  T_MINUS_2: "TOKEN_T-2",
  T_PLUS_0: "TOKEN_T+0",
};

const tierAlreadySent = async (tokenId, tier) => {
  const q = query(
    collection(db, "notifications"),
    where("sourceCollection", "==", "reviewTokens"),
    where("sourceId", "==", tokenId),
    where("reminderTier", "==", tier),
    queryLimit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

/**
 * Scan unconsumed review tokens, fire deadline warnings to all admins for any
 * token whose expiry falls within the warning window (T-2) or just expired
 * (T+0). Dedup is keyed by (tokenId, tier) via the notifications collection.
 *
 * Idempotent — safe to call on every admin login.
 *
 * Requires the caller to be an admin (Firestore rules gate `reviewTokens`
 * reads by isAdmin()). Non-fatal on permission errors.
 */
export const checkAndFireReviewTokenWarnings = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  // Look for tokens that expire within the next 2 days (T-2 window) AND
  // tokens that have already expired but not yet been "T+0"-notified.
  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "reviewTokens"),
        where("consumed", "==", false),
        where("expiresAt", "<=", Timestamp.fromDate(windowEnd))
      )
    );
  } catch (err) {
    console.error("Review-token warning scan failed:", err);
    return 0;
  }

  let fired = 0;

  // Fetch all admin recipient user docs once.
  let adminSnap;
  try {
    adminSnap = await getDocs(
      query(collection(db, "users"), where("role", "==", "Admin"))
    );
  } catch (err) {
    console.error("Admin lookup for token warnings failed:", err);
    return 0;
  }
  const admins = adminSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (admins.length === 0) return 0;

  for (const tokenDoc of snap.docs) {
    const token = { id: tokenDoc.id, ...tokenDoc.data() };
    const expiresAt = toDate(token.expiresAt);
    if (!expiresAt) continue;
    const msUntilExpiry = expiresAt.getTime() - now.getTime();

    let tier = null;
    let title = "";
    if (msUntilExpiry < 0) {
      tier = TOKEN_REMINDER_TIERS.T_PLUS_0;
      title = `Review link expired — ${STAGE_LABELS[token.stage] || token.stage}`;
    } else if (msUntilExpiry <= 2 * 24 * 60 * 60 * 1000) {
      tier = TOKEN_REMINDER_TIERS.T_MINUS_2;
      title = `Review link expiring soon — ${STAGE_LABELS[token.stage] || token.stage}`;
    } else {
      continue;
    }

    if (await tierAlreadySent(token.id, tier).catch(() => false)) continue;

    // Pull proposal title for nicer copy.
    let proposalTitle = "an activity proposal";
    try {
      const docSnap = await getDoc(doc(db, "documents", token.documentId));
      if (docSnap.exists()) {
        proposalTitle = docSnap.data().title || proposalTitle;
      }
    } catch {
      // Best-effort — fall back to generic copy.
    }

    const message =
      tier === TOKEN_REMINDER_TIERS.T_PLUS_0
        ? `The review link sent to ${STAGE_LABELS[token.stage] || token.stage} for "${proposalTitle}" has expired. Regenerate the link from the Activity Proposals page.`
        : `The review link sent to ${STAGE_LABELS[token.stage] || token.stage} for "${proposalTitle}" expires on ${expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}. Regenerate it if the office hasn't responded.`;

    for (const adminUser of admins) {
      try {
        await createNotification({
          recipientId: adminUser.id,
          recipientEmail: adminUser.email || null,
          type: NOTIFICATION_TYPES.REPORT_DUE_SOON,
          title,
          message,
          link: "activity-proposals",
          sourceCollection: "reviewTokens",
          sourceId: token.id,
          reminderTier: tier,
          alsoEmail: false,
        });
      } catch (err) {
        console.error("Token warning notification failed for admin:", adminUser.id, err);
      }
    }
    fired += 1;
  }

  return fired;
};
