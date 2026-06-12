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
  getDocs
} from "firebase/firestore";
import { db } from "../config/firebase";
import { apiJson } from "./apiClient";

/**
 * Auth Activity Log Service
 *
 * Tracks authentication-related events (logins, logouts, OTPs, password resets,
 * account creation) so admins can audit who accessed the system and when.
 *
 * Writes are best-effort and never throw — a logging failure must not break
 * an auth flow. Reads throw on error and are intended for the admin page.
 */

export const AUTH_EVENT_TYPES = [
  "login_success",
  "login_failed",
  "login_blocked",
  "logout",
  "google_login_success",
  "google_login_failed",
  "otp_sent",
  "otp_verified",
  "otp_failed",
  "password_reset_success",
  "password_reset_failed",
  "account_created"
];

/**
 * Record an auth event. Swallows errors so auth flows never break on logging failures.
 */
export const logAuthEvent = async ({
  type,
  email = null,
  userId = null,
  success = true,
  errorCode = null,
  context = null
} = {}) => {
  try {
    if (!type) return;
    const entry = {
      type,
      email: email || null,
      userId: userId || null,
      success: Boolean(success),
      errorCode: errorCode || null,
      context: context || null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent || null : null,
      timestamp: serverTimestamp()
    };
    await addDoc(collection(db, "authActivityLog"), entry);
  } catch (error) {
    // Intentionally do not rethrow — logging is best-effort.
    console.warn("logAuthEvent failed:", error?.message || error);
  }
};

/**
 * Fetch a page of auth activity entries within a date range, newest first.
 *
 * @param {Object} options
 * @param {Date}   options.from   - Inclusive lower bound on timestamp.
 * @param {Date}   options.to     - Inclusive upper bound on timestamp.
 * @param {Object} [options.cursor] - Firestore DocumentSnapshot to paginate from.
 * @param {number} [options.pageSize=50]
 * @returns {Promise<{ entries: Array, lastDoc: Object|null }>}
 */
export const getAuthActivityLog = async ({ from, to, cursor = null, pageSize = 50 } = {}) => {
  try {
    if (!(from instanceof Date) || !(to instanceof Date)) {
      throw new Error("from/to must be Date instances");
    }

    const parts = [
      where("timestamp", ">=", Timestamp.fromDate(from)),
      where("timestamp", "<=", Timestamp.fromDate(to)),
      orderBy("timestamp", "desc")
    ];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(queryLimit(pageSize));

    const q = query(collection(db, "authActivityLog"), ...parts);
    const snap = await getDocs(q);

    const entries = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        timestamp: data.timestamp?.toDate?.() || null
      };
    });

    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return { entries, lastDoc };
  } catch (error) {
    console.error("Error fetching auth activity log:", error);
    throw error;
  }
};

/**
 * Pre-login lockout check. Runs server-side via /api/check-lockout since
 * unauthenticated clients can't read authActivityLog (admin-only).
 *
 * Returns `{ locked, retryAfterMs, failedCount, threshold, windowMs }`.
 * Fails open: if the endpoint errors, returns `{ locked: false }`.
 */
export const checkAccountLockout = async (email) => {
  try {
    const res = await apiJson("/api/check-lockout", { email });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { locked: false };
    return data;
  } catch (err) {
    console.warn("checkAccountLockout failed (fail-open):", err?.message || err);
    return { locked: false };
  }
};
