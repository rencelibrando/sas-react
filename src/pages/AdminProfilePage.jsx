import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { signOut } from "firebase/auth";
import { getUserById, updateUserPassword, updateUserEmail, deleteUserAccount } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import AdminLayout from "../components/admin/AdminLayout";
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

const AdminProfilePage = () => {
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
        if (!userDoc || userDoc.role !== "Admin") {
          console.error("User is not an admin");
          return;
        }

        setUserData(userDoc);
        setEmailValue(user.email || "");

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

  const handleEmailUpdate = async (e) => {
    e.preventDefault();
    setEmailError("");
    setEmailSuccess("");
    setUpdatingEmail(true);

    try {
      if (!emailValue || !emailValue.includes("@")) {
        throw new Error("Please enter a valid email address");
      }

      await updateUserEmail(emailValue);
      setEmailSuccess("Email updated successfully");
      setIsEditingEmail(false);

      const user = auth.currentUser;
      if (user) {
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
      }
    } catch (error) {
      console.error("Error updating email:", error);
      setEmailError(error.message || "Failed to update email. Please try again.");
    } finally {
      setUpdatingEmail(false);
    }
  };

  const handleLogout = async () => {
    try {
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
      await deleteUserAccount();
      await signOut(auth);
    } catch (error) {
      console.error("Error deleting account:", error);
      setDeleteError(error.message || "Failed to delete account. Please try again.");
      setDeletingAccount(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout userData={userData} currentPage="profile">
        <LoadingScreen compact={true} />
      </AdminLayout>
    );
  }

  const organizationName = organizationData?.name || "System";
  const userRole = userData?.userRole || "Administrator";
  const status = (userData?.status || "active").toLowerCase();
  const initials = getInitials(userData?.fullName || auth.currentUser?.email || "Admin");

  return (
    <AdminLayout userData={userData} currentPage="profile">
      <div className="profile-page">
        {/* Profile Header */}
        <div className="profile-header">
          <div className="profile-avatar profile-avatar--admin" aria-hidden="true">
            <span className="profile-avatar-text">{initials}</span>
          </div>
          <div className="profile-header-info">
            <h1 className="profile-name">{userData?.fullName || "Administrator"}</h1>
            <div className="profile-meta-row">
              <span className="profile-chip profile-chip--role">Admin</span>
              <span className="profile-chip profile-chip--subrole">{userRole}</span>
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
                    <form onSubmit={handleEmailUpdate} className="inline-edit-form">
                      {emailError && <div className="form-error-small">{emailError}</div>}
                      {emailSuccess && <div className="form-success-small">{emailSuccess}</div>}
                      <div className="inline-edit-input-group">
                        <input
                          type="email"
                          className="form-input inline-edit-input"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          required
                        />
                        <div className="inline-edit-actions">
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setIsEditingEmail(false);
                              setEmailValue(auth.currentUser?.email || "");
                              setEmailError("");
                              setEmailSuccess("");
                            }}
                            disabled={updatingEmail}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn-primary-small"
                            disabled={updatingEmail}
                          >
                            {updatingEmail ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>

                <div className="profile-info-row">
                  <div className="profile-info-label">Role</div>
                  <div className="profile-info-value">Admin</div>
                </div>

                <div className="profile-info-row">
                  <div className="profile-info-label">Position</div>
                  <div className="profile-info-value">{userRole}</div>
                </div>

                <div className="profile-info-row">
                  <div className="profile-info-label">Organization</div>
                  <div className="profile-info-value">{organizationName}</div>
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
                  <div className="profile-info-label">Account Verification</div>
                  <div className="profile-info-value profile-info-value--with-action">
                    <span>System-verified administrator</span>
                    <span className="profile-verified-badge">
                      <span className="profile-verified-check">✓</span>
                      Verified
                    </span>
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
                  <div className="profile-danger-row-desc">Permanently remove your administrator account and all access. This cannot be undone.</div>
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
                <li>All your activity history</li>
                <li>Your administrator access</li>
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
    </AdminLayout>
  );
};

export default AdminProfilePage;
