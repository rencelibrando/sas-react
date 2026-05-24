/**
 * Email Service for OTP Verification
 * Uses a backend API endpoint to send emails via SMTP
 * 
 * Setup Required:
 * 1. Create a backend API endpoint at /api/send-otp
 * 2. Configure Gmail SMTP credentials
 * 3. Or use EmailJS service (see alternative below)
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

/**
 * Send OTP email via backend API
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<void>}
 */
export const sendOTPEmail = async (toEmail, otpCode) => {
  try {
    // Option 1: Use backend API (recommended for production)
    if (API_BASE_URL) {
      const response = await fetch(`${API_BASE_URL}/api/send-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: toEmail,
          otp: otpCode,
          subject: "EARIST SAS Portal - OTP Verification",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send OTP email");
      }

      return await response.json();
    }

    // Option 2: Development fallback - log OTP to console
    // In production, this should always use the API
    console.warn("API_BASE_URL not set. OTP for development:", otpCode);
    console.warn("Email would be sent to:", toEmail);
    
    // For development, you can manually check the console for OTP
    // In production, remove this and ensure API_BASE_URL is set
    
    return { success: true, message: "OTP logged to console (development mode)" };
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw new Error("Failed to send verification email. Please try again.");
  }
};

/**
 * Send organization account credentials via backend API
 * @param {string} toEmail - Recipient email address
 * @param {string} loginEmail - Login email for the account
 * @param {string} password - Generated password
 * @param {string} organizationName - Organization name
 * @returns {Promise<object>}
 */
export const sendCredentialsEmail = async (toEmail, loginEmail, password, organizationName) => {
  try {
    if (API_BASE_URL) {
      const response = await fetch(`${API_BASE_URL}/api/send-credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: toEmail,
          email: loginEmail,
          password: password,
          organizationName: organizationName,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to send credentials email");
      }

      return await response.json();
    }

    return { success: true, message: "Credentials logged to console (development mode)" };
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
  const response = await fetch(`${API_BASE_URL}/api/send-additional-doc-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      recipientName,
      documentTitle,
      requestLabel,
      requestDescription,
      portalUrl,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to send notification email");
  }
  return data;
};

export const sendReviewLinkEmail = async (toEmail, documentTitle, reviewUrl, officeName) => {
  const response = await fetch(`${API_BASE_URL}/api/send-review-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toEmail, documentTitle, reviewUrl, officeName }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to send review link email");
  }
  return data;
};

export const resetPasswordViaAPI = async (email, newPassword) => {
  const response = await fetch(`${API_BASE_URL}/api/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, newPassword, otpVerified: true }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to reset password");
  }
  return data;
};
