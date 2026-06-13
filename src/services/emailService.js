import { apiJson } from "./apiClient.js";

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001") 
  : (import.meta.env.VITE_API_BASE_URL || "");

/**
 * Send OTP email via backend API
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<void>}
 */
export const sendOTPEmail = async (toEmail, otpCode) => {
  try {
    const response = await apiJson("/api/send-otp", {
      to: toEmail,
      otp: otpCode,
      subject: "EARIST SAS Portal - OTP Verification",
    });
    if (!response.ok) {
      throw new Error("Failed to send OTP email");
    }
    return await response.json();
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw new Error("Failed to send verification email. Please try again.");
  }
};

export const sendCredentialsEmail = async (toEmail, loginEmail, password, organizationName) => {
  try {
    const response = await apiJson(
      "/api/send-credentials",
      { to: toEmail, email: loginEmail, password, organizationName },
      { auth: true }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to send credentials email");
    }
    return await response.json();
  } catch (error) {
    console.error("Error sending credentials email:", error);
    throw new Error("Failed to send credentials email. Please try again.");
  }
};

export const sendAdditionalDocRequestEmail = async ({
  to,
  recipientName,
  documentTitle,
  requestLabel,
  requestDescription,
  portalUrl,
}) => {
  const response = await apiJson(
    "/api/send-additional-doc-request",
    { to, recipientName, documentTitle, requestLabel, requestDescription, portalUrl },
    { auth: true }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to send notification email");
  }
  return data;
};

export const sendReviewLinkEmail = async (toEmail, documentTitle, reviewUrl, officeName) => {
  const response = await apiJson(
    "/api/send-review-link",
    { to: toEmail, documentTitle, reviewUrl, officeName },
    { auth: true }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to send review link email");
  }
  return data;
};

export const resetPasswordViaAPI = async (email, newPassword, otp) => {
  const response = await apiJson("/api/reset-password", { email, newPassword, otp });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to reset password");
  }
  return data;
};
