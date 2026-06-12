import {
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { sendOTPEmail } from "./emailService";
import { logAuthEvent } from "./authActivityLogService";
import { apiJson } from "./apiClient";

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const storeOTP = async (email, otp, expiresInMinutes = 10) => {
  try {
    const otpRef = doc(db, "otps", email);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

    await setDoc(otpRef, {
      otp,
      email,
      createdAt: serverTimestamp(),
      expiresAt,
      verified: false,
    });
  } catch (error) {
    console.error("Error storing OTP:", error);
    throw error;
  }
};

// Verifies via the Express backend. The client cannot read /otps/{email}
// directly anymore — Firestore rules forbid it — so the server validates and
// consumes the OTP using the Admin SDK.
//
// `consume = false` validates the OTP without deleting it — used by the
// forgot-password step 1 so the OTP can be re-validated and consumed during
// the final /api/reset-password call.
export const verifyOTP = async (email, inputOTP, { consume = true } = {}) => {
  try {
    const res = await apiJson("/api/verify-otp", { email, otp: inputOTP, consume });
    const data = await res.json().catch(() => ({}));
    const ok = !!data.valid;
    logAuthEvent({
      type: ok ? "otp_verified" : "otp_failed",
      email,
      success: ok,
      errorCode: ok ? undefined : data.reason || "verify-failed",
    });
    return ok;
  } catch (error) {
    console.error("Error verifying OTP:", error);
    logAuthEvent({
      type: "otp_failed",
      email,
      success: false,
      errorCode: error?.code || "exception",
    });
    return false;
  }
};

export const sendOTP = async (email) => {
  try {
    const otp = generateOTP();
    await storeOTP(email, otp);
    await sendOTPEmail(email, otp);
    logAuthEvent({ type: "otp_sent", email, success: true });
    return otp;
  } catch (error) {
    console.error("Error sending OTP:", error);
    logAuthEvent({
      type: "otp_sent",
      email,
      success: false,
      errorCode: error?.code || "send-failed",
    });
    throw new Error("Failed to send OTP. Please try again.");
  }
};

export const cleanupExpiredOTPs = async () => {
  // No-op — server-side TTL cleanup recommended via a scheduled job if needed.
};
