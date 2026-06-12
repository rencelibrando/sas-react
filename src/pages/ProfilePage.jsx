import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { signOut } from "firebase/auth";
import { getUserById, updateUserPassword, updateUserEmail, deleteUserAccount, updateNotificationPreferences } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import { logAuthEvent } from "../services/authActivityLogService";
import { sendOTP, verifyOTP } from "../services/otpService";
import {
  NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "../services/notificationService";
import { apiJson } from "../services/apiClient";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import Icon from "../components/Icon";
import { formatDateTime } from "../utils/formatters";
import "../styles/colors.css";
import "./ProfilePage.css";

const getInitials = (name = "") => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const ProfilePage = ({ orgType: orgTypeProp = null }) => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState("");

  const [prefs, setPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState("");

  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
        setEmailValue(user.email || "");
        setPrefs({
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...(userDoc?.notificationPreferences || {}),
        });

        if (userDoc?.organizationId) {
          const orgDoc = await getOrganizationById(userDoc.organizationId);
          setOrganizationData(orgDoc);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    setUpdatingPassword(true);

    try {
      if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
        throw new Error("All fields are required");
      }

      if (passwordData.newPassword.length < 6) {
        throw new Error("New password must be at least 6 characters");
      }

      if (passwordData.newPassword !== passwordData.confirmPassword) {
        throw new Error("New passwords do not match");
      }

      await updateUserPassword(passwordData.newPassword);

      setPasswordSuccess("Password updated successfully");
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      });
      setShowPasswordForm(false);
    } catch (error) {
      console.error("Error updating password:", error);
      setPasswordError(error.message || "Failed to update password. Please try again.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const cancelEmailEdit = () => {
    setIsEditingEmail(false);
    setEmailValue(auth.currentUser?.email || "");
    setEmailError("");
    setEmailSuccess("");
    setEmailOtpSent(false);
    setEmailOtpCode("");
  };

  // Step 1: ask for an OTP at the *new* address. Confirms the user controls
  // it before we change anything.
  const handleEmailRequestOTP = async (e) => {
    e.preventDefault();
    setEmailError("");
    setEmailSuccess("");
    setUpdatingEmail(true);
    try {
      if (!emailValue || !emailValue.includes("@")) {
        throw new Error("Please enter a valid email address");
      }
      if (emailValue.toLowerCase() === (auth.currentUser?.email || "").toLowerCase()) {
        throw new Error("That's already your current email.");
      }
      await sendOTP(emailValue);
      setEmailOtpSent(true);
      setEmailSuccess(`Verification code sent to ${emailValue}.`);
    } catch (error) {
      console.error("Email-change OTP request failed:", error);
      setEmailError(error.message || "Failed to send verification code.");
    } finally {
      setUpdatingEmail(false);
    }
  };

  // Step 2: verify the OTP and, if valid, switch Firebase Auth + Firestore
  // to the new address. Also notify the old address.
  const handleEmailConfirmOTP = async (e) => {
    e.preventDefault();
    setEmailError("");
    setEmailSuccess("");
    setUpdatingEmail(true);
    const previousEmail = auth.currentUser?.email || null;
    try {
      if (!emailOtpCode || emailOtpCode.length < 4) {
        throw new Error("Enter the 6-digit verification code.");
      }
      const ok = await verifyOTP(emailValue, emailOtpCode);
      if (!ok) throw new Error("Invalid or expired verification code.");

      await updateUserEmail(emailValue);

      // Best-effort: notify the old address. Don't fail the whole flow if the
      // notice can't be sent.
      if (previousEmail) {
        apiJson(
          "/api/send-notification-email",
          {
            to: previousEmail,
            subject: "Email address changed",
            message: `The email on your EARIST SAS Portal account was changed to ${emailValue}. If you didn't make this change, contact the SAS office immediately.`,
          },
          { auth: true }
        ).catch((err) => console.warn("Old-email notice failed:", err?.message || err));
      }

      setEmailSuccess("Email updated successfully.");
      setIsEditingEmail(false);
      setEmailOtpSent(false);
      setEmailOtpCode("");

      const user = auth.currentUser;
      if (user) {
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
      }
    } catch (error) {
      console.error("Error confirming email change:", error);
      setEmailError(error.message || "Failed to update email.");
    } finally {
      setUpdatingEmail(false);
    }
  };

  const togglePref = async (categoryId, channel) => {
    const next = {
      ...prefs,
      [categoryId]: {
        ...prefs[categoryId],
        [channel]: !prefs[categoryId]?.[channel],
      },
    };
    setPrefs(next);
    setPrefsSaving(true);
    setPrefsMessage("");
    try {
      await updateNotificationPreferences(next);
      setPrefsMessage("Preferences saved.");
    } catch (err) {
      console.error("Failed to save notification preferences:", err);
      setPrefsMessage("Save failed — try again.");
      setPrefs(prefs); // roll back the optimistic update
    } finally {
      setPrefsSaving(false);
      setTimeout(() => setPrefsMessage(""), 2500);
    }
  };

  const visibleCategories = Object.entries(NOTIFICATION_CATEGORIES).filter(
    ([, cat]) => cat.audience === "org"
  );

  const handleLogout = async () => {
    try {
      const current = auth.currentUser;
      await logAuthEvent({
        type: "logout",
        email: current?.email || null,
        userId: current?.uid || null,
        success: true,
        context: "profile-page",
      });
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
      alert("Failed to sign out. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError("");
    setDeletingAccount(true);

    try {
      const current = auth.currentUser;
      await deleteUserAccount();

      await logAuthEvent({
        type: "logout",
        email: current?.email || null,
        userId: current?.uid || null,
        success: true,
        context: "account-deletion",
      });

      await signOut(auth);
    } catch (error) {
      console.error("Error deleting account:", error);
      setDeleteError(error.message || "Failed to delete account. Please try again.");
      setDeletingAccount(false);
    }
  };

  if (loading) {
    return (
      <div className="home-container">
        <Navbar
          organizationName={organizationData?.name || "Organization"}
          role={userData?.role || "ISG"}
          userName={userData?.fullName || auth.currentUser?.email || "User"}
        />
        <DashboardLayout currentPage="profile" orgType={orgTypeProp ?? organizationData?.type ?? null}>
          <LoadingScreen compact={true} />
        </DashboardLayout>
      </div>
    );
  }

  const organizationName = organizationData?.name || "Organization";
  const userRole = userData?.role || "ISG";
  const userName = userData?.fullName || auth.currentUser?.email || "User";
  const status = (userData?.status || "active").toLowerCase();
  const initials = getInitials(userData?.fullName || auth.currentUser?.email);

  return (
    <div className="home-container">
      <Navbar
        organizationName={organizationName}
        role={userRole}
        userName={userName}
      />

      <DashboardLayout currentPage="profile" orgType={orgTypeProp ?? organizationData?.type ?? null}>
        <div className="profile-page">
          {/* Profile Header — avatar-led */}
          <div className="profile-header">
            <div className="profile-avatar" aria-hidden="true">
              <span className="profile-avatar-text">{initials}</span>
            </div>
            <div className="profile-header-info">
              <h1 className="profile-name">{userData?.fullName || "User"}</h1>
              <div className="profile-meta-row">
                <span className="profile-chip profile-chip--role">{userRole}</span>
                {userData?.userRole && (
                  <span className="profile-chip profile-chip--subrole">{userData.userRole}</span>
                )}
                <span className="profile-meta-org">
                  <Icon name="building" size={14} />
                  {organizationName}
                </span>
              </div>
            </div>
            <div className="profile-header-status">
              <span className={`profile-status-dot profile-status-dot--${status}`} />
              <span className="profile-status-label">{status === "active" ? "Active" : status}</span>
            </div>
          </div>

          {/* Two-column body */}
          <div className="profile-grid">
            {/* Left: Account Information */}
            <section className="profile-card">
              <header className="profile-card-header">
                <Icon name="profile" size={20} />
                <h2 className="profile-card-title">Account Information</h2>
              </header>
              <div className="profile-card-body">
                <div className="profile-info-list">
                  <div className="profile-info-row">
                    <div className="profile-info-label">Full Name</div>
                    <div className="profile-info-value">{userData?.fullName || "Not set"}</div>
                  </div>

                  <div className="profile-info-row">
                    <div className="profile-info-label">Email</div>
                    {!isEditingEmail ? (
                      <div className="profile-info-value profile-info-value--with-action">
                        <span>{emailValue || "Not set"}</span>
                        <button
                          className="profile-action-btn"
                          onClick={() => setIsEditingEmail(true)}
                          aria-label="Edit email"
                        >
                          <Icon name="edit" size={14} />
                          Edit
                        </button>
                      </div>
                    ) : (
                      <form
                        onSubmit={emailOtpSent ? handleEmailConfirmOTP : handleEmailRequestOTP}
                        className="inline-edit-form"
                      >
                        {emailError && <div className="form-error-small">{emailError}</div>}
                        {emailSuccess && <div className="form-success-small">{emailSuccess}</div>}
                        <div className="inline-edit-input-group">
                          <input
                            type="email"
                            className="form-input inline-edit-input"
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            disabled={emailOtpSent || updatingEmail}
                            required
                          />
                          {emailOtpSent && (
                            <input
                              type="text"
                              className="form-input inline-edit-input"
                              value={emailOtpCode}
                              onChange={(e) => setEmailOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="6-digit code"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              maxLength={6}
                              required
                            />
                          )}
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-link"
                              onClick={cancelEmailEdit}
                              disabled={updatingEmail}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="btn-primary-small"
                              disabled={updatingEmail}
                            >
                              {updatingEmail
                                ? (emailOtpSent ? "Verifying..." : "Sending...")
                                : (emailOtpSent ? "Confirm change" : "Send code")}
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="profile-info-row">
                    <div className="profile-info-label">Organization</div>
                    <div className="profile-info-value">{organizationName}</div>
                  </div>

                  <div className="profile-info-row">
                    <div className="profile-info-label">Position</div>
                    <div className="profile-info-value">{userData?.userRole || "Not set"}</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Right: Security */}
            <section className="profile-card">
              <header className="profile-card-header">
                <Icon name="lock" size={20} />
                <h2 className="profile-card-title">Security</h2>
              </header>
              <div className="profile-card-body">
                <div className="profile-info-list">
                  <div className="profile-info-row">
                    <div className="profile-info-label">Password</div>
                    <div className="profile-info-value profile-info-value--with-action">
                      <span className="profile-password-mask">••••••••••</span>
                      {!showPasswordForm && (
                        <button
                          className="profile-action-btn"
                          onClick={() => setShowPasswordForm(true)}
                        >
                          <Icon name="edit" size={14} />
                          Change
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="profile-info-row">
                    <div className="profile-info-label">Last Login</div>
                    <div className="profile-info-value">{formatDateTime(userData?.lastLogin) || "—"}</div>
                  </div>
                </div>

                {showPasswordForm && (
                  <div className="password-form-container">
                    <form className="password-form" onSubmit={handlePasswordChange}>
                      {passwordError && (
                        <div className="form-error">{passwordError}</div>
                      )}
                      {passwordSuccess && (
                        <div className="form-success">{passwordSuccess}</div>
                      )}

                      <div className="form-group">
                        <label htmlFor="currentPassword" className="form-label">
                          Current Password
                        </label>
                        <input
                          type="password"
                          id="currentPassword"
                          className="form-input"
                          value={passwordData.currentPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="newPassword" className="form-label">
                          New Password
                        </label>
                        <input
                          type="password"
                          id="newPassword"
                          className="form-input"
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          minLength={6}
                          required
                        />
                        <span className="form-hint">Must be at least 6 characters</span>
                      </div>

                      <div className="form-group">
                        <label htmlFor="confirmPassword" className="form-label">
                          Confirm New Password
                        </label>
                        <input
                          type="password"
                          id="confirmPassword"
                          className="form-input"
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          required
                        />
                      </div>

                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setShowPasswordForm(false);
                            setPasswordData({
                              currentPassword: "",
                              newPassword: "",
                              confirmPassword: ""
                            });
                            setPasswordError("");
                            setPasswordSuccess("");
                          }}
                          disabled={updatingPassword}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={updatingPassword}
                        >
                          {updatingPassword ? "Updating..." : "Update Password"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Account History strip */}
          <section className="profile-card profile-card--strip">
            <header className="profile-card-header">
              <Icon name="analytics" size={20} />
              <h2 className="profile-card-title">Account History</h2>
            </header>
            <div className="profile-history-grid">
              <div className="profile-history-item">
                <div className="profile-history-label">Date Created</div>
                <div className="profile-history-value">{formatDateTime(userData?.dateCreated) || "—"}</div>
              </div>
              <div className="profile-history-item">
                <div className="profile-history-label">Last Updated</div>
                <div className="profile-history-value">{formatDateTime(userData?.lastUpdated) || "—"}</div>
              </div>
              <div className="profile-history-item">
                <div className="profile-history-label">Last Login</div>
                <div className="profile-history-value">{formatDateTime(userData?.lastLogin) || "—"}</div>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section className="profile-card profile-card--strip">
            <header className="profile-card-header">
              <Icon name="bell" size={20} />
              <h2 className="profile-card-title">Notification preferences</h2>
            </header>
            <div className="profile-card-body">
              <table className="notif-prefs-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="notif-prefs-th">In-app</th>
                    <th className="notif-prefs-th">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCategories.map(([catId, cat]) => (
                    <tr key={catId}>
                      <td>
                        <div className="notif-prefs-label">{cat.label}</div>
                        <div className="notif-prefs-desc">{cat.description}</div>
                      </td>
                      <td className="notif-prefs-cell">
                        <input
                          type="checkbox"
                          checked={prefs[catId]?.inApp !== false}
                          onChange={() => togglePref(catId, "inApp")}
                          disabled={prefsSaving}
                          aria-label={`In-app: ${cat.label}`}
                        />
                      </td>
                      <td className="notif-prefs-cell">
                        <input
                          type="checkbox"
                          checked={prefs[catId]?.email !== false}
                          onChange={() => togglePref(catId, "email")}
                          disabled={prefsSaving}
                          aria-label={`Email: ${cat.label}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {prefsMessage && (
                <div className="notif-prefs-status">{prefsMessage}</div>
              )}
            </div>
          </section>

          {/* Danger Zone */}
          <section className={`profile-card profile-danger-zone ${showDangerZone ? "is-open" : ""}`}>
            <button
              type="button"
              className="profile-danger-toggle"
              onClick={() => setShowDangerZone(!showDangerZone)}
              aria-expanded={showDangerZone}
            >
              <div className="profile-danger-toggle-left">
                <span className="profile-danger-icon">!</span>
                <div>
                  <div className="profile-danger-title">Danger Zone</div>
                  <div className="profile-danger-subtitle">Sign out or permanently delete your account</div>
                </div>
              </div>
              <Icon name={showDangerZone ? "chevron-up" : "chevron-down"} size={18} />
            </button>

            {showDangerZone && (
              <div className="profile-danger-body">
                <div className="profile-danger-row">
                  <div className="profile-danger-row-text">
                    <div className="profile-danger-row-title">Log out</div>
                    <div className="profile-danger-row-desc">End your current session on this device.</div>
                  </div>
                  <button className="btn-secondary" onClick={handleLogout}>Log Out</button>
                </div>
                <div className="profile-danger-row">
                  <div className="profile-danger-row-text">
                    <div className="profile-danger-row-title">Delete account</div>
                    <div className="profile-danger-row-desc">Permanently remove your account and all associated data. This cannot be undone.</div>
                  </div>
                  <button
                    className="btn-danger"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Delete Account Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => !deletingAccount && setShowDeleteConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete Account</h3>
                {!deletingAccount && (
                  <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>×</button>
                )}
              </div>
              <div className="modal-body">
                {deleteError && (
                  <div className="form-error">{deleteError}</div>
                )}
                <p className="delete-warning">
                  Are you sure you want to delete your account? This action cannot be undone.
                </p>
                <p className="delete-details">
                  This will permanently delete:
                </p>
                <ul className="delete-list">
                  <li>Your account and all associated data</li>
                  <li>Your verification documents</li>
                  <li>All your activity history</li>
                </ul>
                <div className="modal-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteError("");
                    }}
                    disabled={deletingAccount}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-danger"
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                  >
                    {deletingAccount ? "Deleting..." : "Yes, Delete My Account"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
    </div>
  );
};

export default ProfilePage;
