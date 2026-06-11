import { useState } from "react";
import { signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "../config/firebase";
import { getUserById, getUserByEmail } from "../services/userService";
import { sendOTP, verifyOTP } from "../services/otpService";
import { resetPasswordViaAPI } from "../services/emailService";
import { logAuthEvent } from "../services/authActivityLogService";
import { validatePasswordStrength } from "../utils/passwordValidation";
import earistLogo from "../assets/images/logos/earist-logo.png";
import sasBanner from "../assets/images/banners/sas-banner.png";
import "../styles/colors.css";
import "../styles/auth.css";

const AuthPage = () => {
  // Login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordOTP, setForgotPasswordOTP] = useState("");
  const [showForgotPasswordOTP, setShowForgotPasswordOTP] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(null);
  
  // Common state
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  const handleEmailLogin = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    setError("");
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      logAuthEvent({
        type: "login_success",
        email,
        userId: cred?.user?.uid || null,
        success: true,
        context: "email-password",
      });
    } catch (err) {
      console.error("Firebase Auth Error:", err);
      console.error("Error Code:", err.code);
      console.error("Error Message:", err.message);

      logAuthEvent({
        type: "login_failed",
        email,
        success: false,
        errorCode: err.code || null,
        context: "email-password",
      });

      let errorMessage = "Invalid email or password. Please check your credentials and try again.";

      if (err.code === "auth/invalid-credential") {
        errorMessage = "Invalid email or password. Please check your credentials and try again.";
      } else if (err.code === "auth/user-not-found") {
        errorMessage = "No account found with this email. Please register first.";
      } else if (err.code === "auth/wrong-password") {
        errorMessage = "Incorrect password. Please try again.";
      } else if (err.code === "auth/invalid-email") {
        errorMessage = "Invalid email address. Please check and try again.";
      } else if (err.code === "auth/user-disabled") {
        errorMessage = "This account has been disabled. Please contact support.";
      } else if (err.code === "auth/too-many-requests") {
        errorMessage = "Too many failed login attempts. Please try again later.";
      } else if (err.code === "auth/network-request-failed") {
        errorMessage = "Network error. Please check your internet connection and try again.";
      } else if (err.message) {
        errorMessage = `Authentication error: ${err.message}`;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Check if user exists in Firestore
      const userDoc = await getUserById(user.uid);

      if (!userDoc) {
        // User doesn't exist - sign them out and show error
        await signOut(auth);
        logAuthEvent({
          type: "google_login_failed",
          email: user?.email || null,
          userId: user?.uid || null,
          success: false,
          errorCode: "no-firestore-user",
          context: "google",
        });
        setError("No account found. Please contact SAS office for organization account creation.");
        setLoading(false);
        return;
      }

      logAuthEvent({
        type: "google_login_success",
        email: user?.email || null,
        userId: user?.uid || null,
        success: true,
        context: "google",
      });
      // User exists, proceed with login
      // Navigation will be handled by App.jsx
    } catch (err) {
      logAuthEvent({
        type: "google_login_failed",
        success: false,
        errorCode: err?.code || null,
        context: "google",
      });
      setError(err.message || "Failed to sign in with Google.");
      setLoading(false);
    }
  };

  // Forgot Password Handlers
  const handleForgotPasswordInit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate email format
      if (!forgotPasswordEmail || !forgotPasswordEmail.includes("@")) {
        setError("Please enter a valid email address.");
        setLoading(false);
        return;
      }

      // Check if user exists in Firestore
      const userDoc = await getUserByEmail(forgotPasswordEmail);
      if (!userDoc) {
        setError("No account found with this email. Please register first.");
        setLoading(false);
        return;
      }

      // Send OTP to email
      await sendOTP(forgotPasswordEmail);
      setShowForgotPasswordOTP(true);
      setError("");
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(err.message || "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordOTP = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const isValid = await verifyOTP(forgotPasswordEmail, forgotPasswordOTP);
      
      if (!isValid) {
        setError("Invalid OTP code. Please try again.");
        setLoading(false);
        return;
      }

      // OTP verified, show password reset form
      setShowForgotPasswordOTP(false);
      setOtpVerified(true);
      setError("");
    } catch (err) {
      console.error("OTP verification error:", err);
      setError(err.message || "Failed to verify OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordReset = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate passwords match
      if (newPassword !== confirmNewPassword) {
        setError("Passwords do not match.");
        setLoading(false);
        return;
      }

      // Validate password strength
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        setError(passwordValidation.errors.join(". "));
        setLoading(false);
        return;
      }

      try {
        await resetPasswordViaAPI(forgotPasswordEmail, newPassword);
        logAuthEvent({
          type: "password_reset_success",
          email: forgotPasswordEmail,
          success: true,
          context: "forgot-password",
        });
      } catch (resetErr) {
        logAuthEvent({
          type: "password_reset_failed",
          email: forgotPasswordEmail,
          success: false,
          errorCode: resetErr?.code || null,
          context: "forgot-password",
        });
        throw resetErr;
      }

      // Success - reset form and show success message
      setShowForgotPassword(false);
      setForgotPasswordEmail("");
      setForgotPasswordOTP("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowForgotPasswordOTP(false);
      setOtpVerified(false);
      setError("");
      alert("Password reset successfully! Please login with your new password.");
    } catch (err) {
      console.error("Password reset error:", err);
      setError(err.message || "Failed to reset password. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-background" style={{ backgroundImage: `url(${sasBanner})` }}></div>
      <div className="auth-overlay"></div>
      <div className="auth-content">
        <div className="auth-card show">
          {/* Login Form */}
          <div className="auth-form-wrapper">
            <div className="auth-logo">
              <img src={earistLogo} alt="EARIST Logo" />
            </div>

            <h1 className="auth-title">Student Affairs and Services Portal</h1>
            <p className="auth-subtitle">Eulogio "Amang" Rodriguez Institute of Science and Technology</p>

            <form onSubmit={handleEmailLogin} className="auth-form">
              <div className="form-group">
                <label htmlFor="email" className="form-label">Email</label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="password" className="form-label">Password</label>
                <div className="password-input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="form-input"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-options">
                <a 
                  href="#" 
                  className="forgot-password-link" 
                    onClick={(e) => { 
                    e.preventDefault(); 
                    setShowForgotPassword(true);
                    setForgotPasswordEmail("");
                    setForgotPasswordOTP("");
                    setNewPassword("");
                    setConfirmNewPassword("");
                    setShowForgotPasswordOTP(false);
                    setOtpVerified(false);
                    setError("");
                  }}
                >
                  Forgot Password?
                </a>
              </div>

              {error && <div className="error-message">{error}</div>}

              <button
                type="submit"
                className="auth-button"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Login"}
              </button>
            </form>

            <div className="divider">
              <span>OR</span>
            </div>

            <button
              onClick={handleGoogleLogin}
              className="google-button"
              disabled={loading}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Login with Google
            </button>

            <div className="auth-help">
              <p className="help-text">
                Need an account? Contact SAS office for organization account creation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="otp-modal-overlay">
          <div className="otp-modal">
            {!showForgotPasswordOTP && !otpVerified ? (
              <>
                <h2 className="otp-modal-title">Reset Password</h2>
                <p className="otp-modal-subtitle">
                  Enter your email address to receive an OTP code
                </p>
                <form onSubmit={handleForgotPasswordInit} className="auth-form">
                  <div className="form-group">
                    <label htmlFor="forgotPasswordEmail" className="form-label">Email</label>
                    <input
                      id="forgotPasswordEmail"
                      type="email"
                      className="form-input"
                      placeholder="Enter your email"
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      required
                      disabled={loading}
                    />
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button
                    type="submit"
                    className="auth-button"
                    disabled={loading}
                  >
                    {loading ? "Sending..." : "Send OTP"}
                  </button>

                  <button
                    type="button"
                    className="switch-link"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotPasswordEmail("");
                      setForgotPasswordOTP("");
                      setShowForgotPasswordOTP(false);
                      setOtpVerified(false);
                      setError("");
                    }}
                    style={{ marginTop: "1rem" }}
                  >
                    Cancel
                  </button>
                </form>
              </>
            ) : showForgotPasswordOTP && !otpVerified ? (
              <>
                <h2 className="otp-modal-title">Verify Your Email</h2>
                <p className="otp-modal-subtitle">
                  We've sent a 6-digit OTP code to <strong>{forgotPasswordEmail}</strong>
                </p>
                <form onSubmit={handleForgotPasswordOTP} className="auth-form">
                  <div className="form-group">
                    <label htmlFor="forgotPasswordOTP" className="form-label">Enter OTP Code</label>
                    <input
                      id="forgotPasswordOTP"
                      type="text"
                      className="form-input"
                      placeholder="000000"
                      value={forgotPasswordOTP}
                      onChange={(e) => setForgotPasswordOTP(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      maxLength={6}
                      disabled={loading}
                      style={{ textAlign: "center", fontSize: "1.5rem", letterSpacing: "0.5rem" }}
                    />
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button
                    type="submit"
                    className="auth-button"
                    disabled={loading || forgotPasswordOTP.length !== 6}
                  >
                    {loading ? "Verifying..." : "Verify OTP"}
                  </button>

                  <button
                    type="button"
                    className="switch-link"
                    onClick={() => {
                      setShowForgotPasswordOTP(false);
                      setForgotPasswordOTP("");
                      setOtpVerified(false);
                      setError("");
                    }}
                    style={{ marginTop: "1rem" }}
                  >
                    Back
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="otp-modal-title">Set New Password</h2>
                <p className="otp-modal-subtitle">
                  Create a strong password for your account
                </p>
                <form onSubmit={handleForgotPasswordReset} className="auth-form">
                  <div className="form-group">
                    <label htmlFor="newPassword" className="form-label">New Password</label>
                    <div className="password-input-wrapper">
                      <input
                        id="newPassword"
                        type={showNewPassword ? "text" : "password"}
                        className="form-input"
                        placeholder="Enter new password"
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          const validation = validatePasswordStrength(e.target.value);
                          setPasswordStrength(validation);
                        }}
                        required
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        disabled={loading}
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                      >
                        {showNewPassword ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                    {newPassword && passwordStrength && !passwordStrength.isValid && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--earist-maroon)" }}>
                        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                          {passwordStrength.errors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {newPassword && passwordStrength && passwordStrength.isValid && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "green" }}>
                        ✓ Password meets all requirements
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="confirmNewPassword" className="form-label">Confirm New Password</label>
                    <div className="password-input-wrapper">
                      <input
                        id="confirmNewPassword"
                        type={showConfirmNewPassword ? "text" : "password"}
                        className="form-input"
                        placeholder="Confirm new password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        required
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        disabled={loading}
                        aria-label={showConfirmNewPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmNewPassword ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button
                    type="submit"
                    className="auth-button"
                    disabled={loading || !passwordStrength?.isValid || newPassword !== confirmNewPassword}
                  >
                    {loading ? "Resetting..." : "Reset Password"}
                  </button>

                  <button
                    type="button"
                    className="switch-link"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotPasswordEmail("");
                      setForgotPasswordOTP("");
                      setNewPassword("");
                      setConfirmNewPassword("");
                      setShowForgotPasswordOTP(false);
                      setOtpVerified(false);
                      setError("");
                    }}
                    style={{ marginTop: "1rem" }}
                  >
                    Cancel
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPage;
