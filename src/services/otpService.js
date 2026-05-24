import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../config/firebase";
import { sendOTPEmail } from "./emailService";
import { logAuthEvent } from "./authActivityLogService";

/**
 * Generate a 6-digit OTP code
 * @returns {string} 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Store OTP in Firestore with expiration
 * @param {string} email - User's email
 * @param {string} otp - OTP code
 * @param {number} expiresInMinutes - Expiration time in minutes (default: 10)
 * @returns {Promise<void>}
 */
const storeOTP = async (email, otp, expiresInMinutes = 10) => {
  try {
    const otpRef = doc(db, "otps", email);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

    await setDoc(otpRef, {
      otp: otp,
      email: email,
      createdAt: serverTimestamp(),
      expiresAt: expiresAt,
      verified: false
    });
  } catch (error) {
    console.error("Error storing OTP:", error);
    throw error;
  }
};

/**
 * Verify OTP code
 * @param {string} email - User's email
 * @param {string} inputOTP - OTP code entered by user
 * @returns {Promise<boolean>} True if OTP is valid
 */
export const verifyOTP = async (email, inputOTP) => {
  try {
    const otpRef = doc(db, "otps", email);
    const otpDoc = await getDoc(otpRef);

    if (!otpDoc.exists()) {
      return false;
    }

    const otpData = otpDoc.data();
    const now = new Date();
    const expiresAt = otpData.expiresAt?.toDate();

    // Check if OTP is expired
    if (expiresAt && now > expiresAt) {
      await deleteDoc(otpRef);
      logAuthEvent({
        type: "otp_failed",
        email,
        success: false,
        errorCode: "expired",
      });
      return false;
    }

    // Check if OTP matches
    if (otpData.otp === inputOTP && !otpData.verified) {
      // Mark as verified and delete
      await deleteDoc(otpRef);
      logAuthEvent({
        type: "otp_verified",
        email,
        success: true,
      });
      return true;
    }

    logAuthEvent({
      type: "otp_failed",
      email,
      success: false,
      errorCode: "mismatch",
    });
    return false;
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

/**
 * Send OTP to user's email
 * @param {string} email - User's email address
 * @returns {Promise<string>} The OTP code (for testing purposes)
 */
export const sendOTP = async (email) => {
  try {
    // Generate OTP
    const otp = generateOTP();

    // Store OTP in Firestore
    await storeOTP(email, otp);

    // Send OTP via email
    await sendOTPEmail(email, otp);

    logAuthEvent({ type: "otp_sent", email, success: true });

    // Return OTP for development/testing (remove in production)
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

/**
 * Clean up expired OTPs (can be called periodically)
 */
export const cleanupExpiredOTPs = async () => {
  // This would require a Cloud Function or scheduled job
  // For now, OTPs are checked on verification
};

