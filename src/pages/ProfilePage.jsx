import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { signOut } from "firebase/auth";
import { getUserById, updateUserPassword, updateUserEmail, deleteUserAccount } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import { logAuthEvent } from "../services/authActivityLogService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import { formatDateTime } from "../utils/formatters";
import "../styles/colors.css";
import "./ProfilePage.css";

const ProfilePage = () => {
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
  
  // Email editing state
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState(false);
  
  // Account actions state
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
      
      // Refresh user data
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
      const current = auth.currentUser;
      await logAuthEvent({
        type: "logout",
        email: current?.email || null,
        userId: current?.uid || null,
        success: true,
        context: "profile-page",
      });
      await signOut(auth);
      // User will be redirected by auth state change
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
      // Delete user account
      await deleteUserAccount();

      await logAuthEvent({
        type: "logout",
        email: current?.email || null,
        userId: current?.uid || null,
        success: true,
        context: "account-deletion",
      });

      // Sign out after deletion
      await signOut(auth);
      // User will be redirected by auth state change
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
        <DashboardLayout currentPage="profile" orgType={organizationData?.type || null}>
          <LoadingScreen compact={true} />
        </DashboardLayout>
      </div>
    );
  }

  const organizationName = organizationData?.name || "Organization";
  const userRole = userData?.role || "ISG";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="home-container">
      <Navbar
        organizationName={organizationName}
        role={userRole}
        userName={userName}
      />
      
      <DashboardLayout currentPage="profile" orgType={organizationData?.type || null}>
        <div className="profile-page">
          {/* Profile Header */}
          <div className="profile-header">
            <div className="profile-header-content">
              <div>
                <h1 className="profile-name">{userData?.fullName || "User"}</h1>
                <p className="profile-role">{userRole} - {userData?.userRole || "Member"}</p>
              </div>
            </div>
          </div>

          <div className="profile-content">
            {/* Account Information Section */}
            <div className="profile-section">
              <h2 className="section-title">Account Information</h2>
              <div className="profile-info-grid">
                <div className="info-item">
                  <label className="info-label">Full Name</label>
                  <div className="info-value">{userData?.fullName || "Not set"}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">Email</label>
                  {!isEditingEmail ? (
                    <div className="info-value-with-action">
                      <div className="info-value">{emailValue || "Not set"}</div>
                      <button
                        className="btn-link"
                        onClick={() => setIsEditingEmail(true)}
                      >
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
                <div className="info-item">
                  <label className="info-label">Organization</label>
                  <div className="info-value">{organizationName}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">User Role</label>
                  <div className="info-value">{userData?.userRole || "Not set"}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">Status</label>
                  <div className="info-value">{userData?.status || "active"}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">Password</label>
                  <div className="info-value-with-action">
                    <div className="info-value">••••••••</div>
                    {!showPasswordForm && (
                      <button
                        className="btn-link"
                        onClick={() => setShowPasswordForm(true)}
                      >
                        Change Password
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Password Change Form */}
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

            {/* Account History Section */}
            <div className="profile-section">
              <h2 className="section-title">Account History</h2>
              <div className="profile-info-grid">
                <div className="info-item">
                  <label className="info-label">Date Created</label>
                  <div className="info-value">{formatDateTime(userData?.dateCreated)}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">Last Updated</label>
                  <div className="info-value">{formatDateTime(userData?.lastUpdated)}</div>
                </div>
                <div className="info-item">
                  <label className="info-label">Last Login</label>
                  <div className="info-value">{formatDateTime(userData?.lastLogin)}</div>
                </div>
              </div>
            </div>

            {/* Account Actions */}
            <div className="account-actions">
              <button
                className="btn-secondary"
                onClick={handleLogout}
              >
                Log Out
              </button>
              <button
                className="btn-danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete Account
              </button>
            </div>
          </div>
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
