import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import {
  getUserById,
  getAllOrgUsers,
  getAllAdminUsers,
  createUserDocument,
  createOrganizationAccount,
} from "../services/userService";
import { getAllOrganizations } from "../services/organizationService";
import { updateUserStatus } from "../services/adminService";
import { getAllOfficeProfiles, upsertOfficeProfile } from "../services/officeService";
import { logAuthEvent } from "../services/authActivityLogService";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import { generateSecurePassword } from "../utils/passwordGenerator";
import "../styles/colors.css";
import "./AdminAccountManagement.css";

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001") 
  : (import.meta.env.VITE_API_BASE_URL || "");

const INITIAL_CREATE_FORM = {
  accountCategory: "org", // "org" | "admin"
  orgType: "ISG",
  organizationId: "",
  fullName: "",
  email: "",
  password: "",
  position: "",
  sendEmail: true,
};

const OFFICE_CONFIGS = [
  {
    id: "vpaa",
    label: "VPAA",
    defaultRole: "Vice President for Academic Affairs",
    description: "Receives activity proposal review links",
  },
  {
    id: "op",
    label: "OP",
    defaultRole: "Office of the President",
    description: "Receives final approval review links",
  },
  {
    id: "fms",
    label: "FMS",
    defaultRole: "Financial Management Services",
    description: "Reviews ISG fund utilization after OP approval",
  },
  {
    id: "procurement",
    label: "Procurement",
    defaultRole: "Procurement Office",
    description: "Reviews ISG procurement after FMS clearance",
  },
];

const AdminAccountManagement = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Office profiles
  const [officeProfiles, setOfficeProfiles] = useState({});
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [editingOffice, setEditingOffice] = useState(null);
  const [officeForm, setOfficeForm] = useState({ name: "", email: "", role: "" });
  const [officeSaving, setOfficeSaving] = useState(false);
  const [officeError, setOfficeError] = useState("");

  // Create account modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(INITIAL_CREATE_FORM);
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  // Reset password modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const [userDoc, orgUsers, adminUsers, allOrgs, allOffices] = await Promise.all([
          getUserById(user.uid),
          getAllOrgUsers(),
          getAllAdminUsers(),
          getAllOrganizations(),
          getAllOfficeProfiles(),
        ]);

        if (userDoc) setUserData(userDoc);
        setAccounts([...adminUsers, ...orgUsers]);
        setOrganizations(allOrgs);

        const profileMap = {};
        allOffices.forEach((p) => { profileMap[p.officeId] = p; });
        setOfficeProfiles(profileMap);
      } catch (err) {
        console.error("Error fetching account data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const refreshAccounts = async () => {
    const [orgUsers, adminUsers] = await Promise.all([
      getAllOrgUsers(),
      getAllAdminUsers(),
    ]);
    setAccounts([...adminUsers, ...orgUsers]);
  };

  // ── Office profile handlers ──────────────────────────────────────────────

  const openOfficeModal = (officeCfg) => {
    const existing = officeProfiles[officeCfg.id];
    setEditingOffice(officeCfg);
    setOfficeForm({
      name: existing?.name || "",
      email: existing?.email || "",
      role: existing?.role || officeCfg.defaultRole,
    });
    setOfficeError("");
    setShowOfficeModal(true);
  };

  const handleSaveOffice = async () => {
    setOfficeError("");
    if (!officeForm.name.trim()) {
      setOfficeError("Full name is required.");
      return;
    }
    if (!officeForm.role.trim()) {
      setOfficeError("Role is required.");
      return;
    }
    if (!officeForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officeForm.email)) {
      setOfficeError("A valid contact email is required.");
      return;
    }

    setOfficeSaving(true);
    try {
      await upsertOfficeProfile(
        editingOffice.id,
        {
          name: officeForm.name.trim(),
          email: officeForm.email.trim(),
          role: officeForm.role.trim(),
        },
        auth.currentUser?.uid
      );

      setOfficeProfiles((prev) => ({
        ...prev,
        [editingOffice.id]: {
          ...prev[editingOffice.id],
          officeId: editingOffice.id,
          name: officeForm.name.trim(),
          email: officeForm.email.trim(),
          role: officeForm.role.trim(),
        },
      }));

      setSuccessMessage(`${editingOffice.label} profile saved successfully.`);
      setShowOfficeModal(false);
    } catch (err) {
      setOfficeError(err.message || "Failed to save office profile.");
    } finally {
      setOfficeSaving(false);
    }
  };

  // ── Account handlers ─────────────────────────────────────────────────────

  const filteredAccounts = accounts.filter((acc) => {
    const matchesType = filterType === "all" || acc.role === filterType;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      acc.fullName?.toLowerCase().includes(q) ||
      acc.email?.toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });

  const orgsForSelectedType = organizations.filter(
    (org) => org.type === createForm.orgType
  );

  const getOrgName = (account) => {
    if (account.role === "Admin") return account.userRole || "—";
    const org = organizations.find((o) => o.organizationId === account.organizationId);
    return org?.name || "—";
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "Never";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const openCreateModal = () => {
    setCreateForm({ ...INITIAL_CREATE_FORM, password: generateSecurePassword() });
    setShowCreatePassword(false);
    setError("");
    setShowCreateModal(true);
  };

  const openResetModal = (account) => {
    setSelectedAccount(account);
    setResetPassword(generateSecurePassword());
    setShowResetPassword(false);
    setError("");
    setShowResetModal(true);
  };

  const handleCategoryChange = (category) => {
    setCreateForm((prev) => ({
      ...INITIAL_CREATE_FORM,
      accountCategory: category,
      password: prev.password,
    }));
  };

  const handleOrgTypeChange = (type) => {
    setCreateForm((prev) => ({
      ...prev,
      orgType: type,
      organizationId: "",
      fullName: "",
      email: "",
    }));
  };

  const handleOrgSelect = (orgId) => {
    const org = organizations.find((o) => o.organizationId === orgId);
    setCreateForm((prev) => ({
      ...prev,
      organizationId: orgId,
      fullName: org?.name || prev.fullName,
      email: org?.email || prev.email,
    }));
  };

  const handleCreateAccount = async () => {
    setError("");
    const { accountCategory, email, password, fullName, organizationId, orgType, position } = createForm;

    if (!fullName.trim() || !email.trim() || !password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (accountCategory === "org" && !organizationId) {
      setError("Please select an organization.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const createRes = await fetch(`${API_BASE_URL}/api/create-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.error || "Failed to create account");

      if (accountCategory === "admin") {
        await createUserDocument(createData.uid, {
          fullName: fullName.trim(),
          email: email.trim(),
          role: "Admin",
          organizationId: "",
          userRole: position.trim() || "SAS Staff",
        });
      } else {
        await createOrganizationAccount(createData.uid, {
          email: email.trim(),
          role: orgType,
          organizationId,
          organizationName: fullName.trim(),
        });
      }

      if (createForm.sendEmail) {
        const displayName =
          accountCategory === "admin"
            ? `${fullName.trim()}${position.trim() ? ` — ${position.trim()}` : ""}`
            : fullName.trim();

        await fetch(`${API_BASE_URL}/api/send-credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email.trim(),
            email: email.trim(),
            password,
            organizationName: displayName,
          }),
        });
      }

      logAuthEvent({
        type: "account_created",
        email: email.trim(),
        userId: createData.uid,
        success: true,
        context: accountCategory === "admin" ? "admin-create-admin" : "admin-create-org",
      });

      setSuccessMessage(`Account created successfully for ${fullName.trim()}.`);
      setShowCreateModal(false);
      await refreshAccounts();
    } catch (err) {
      setError(err.message || "Failed to create account.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    setError("");
    if (!resetPassword || resetPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin-reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selectedAccount.email, newPassword: resetPassword }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to reset password");

      setSuccessMessage(`Password reset successfully for ${selectedAccount.fullName}.`);
      setShowResetModal(false);
    } catch (err) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (account) => {
    const newStatus = account.status === "active" ? "inactive" : "active";
    try {
      await updateUserStatus(account.userId, newStatus);
      setAccounts((prev) =>
        prev.map((a) => (a.userId === account.userId ? { ...a, status: newStatus } : a))
      );
      setSuccessMessage(
        `Account ${newStatus === "active" ? "activated" : "deactivated"} successfully.`
      );
    } catch {
      setError("Failed to update account status.");
    }
  };

  const isOwnAccount = (account) => account.userId === auth.currentUser?.uid;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AdminLayout userData={userData} currentPage="account-management">
      {loading ? (
        <LoadingScreen compact={true} />
      ) : (
        <div className="admin-account-management">
          <div className="acct-mgmt-header">
            <div>
              <h1 className="acct-mgmt-title">Account Management</h1>
              <p className="acct-mgmt-subtitle">
                Manage organization accounts, admin/staff accounts, and office review profiles
              </p>
            </div>
            <button className="acct-create-btn" onClick={openCreateModal}>
              + Create Account
            </button>
          </div>

          {successMessage && (
            <div className="acct-success-banner" onClick={() => setSuccessMessage("")}>
              {successMessage}&nbsp;&nbsp;×
            </div>
          )}

          {/* ── Office Profiles Section ── */}
          <section className="office-profiles-section">
            <h2 className="office-profiles-heading">Office Review Profiles</h2>
            <p className="office-profiles-subheading">
              Configure the email addresses that receive tokenized review links for activity proposals.
            </p>
            <div className="office-profiles-grid">
              {OFFICE_CONFIGS.map((cfg) => {
                const profile = officeProfiles[cfg.id];
                const isConfigured = !!profile?.email && !!profile?.name;
                const hasSignature = !!profile?.signatureUrl;
                return (
                  <div
                    key={cfg.id}
                    className={`office-profile-card ${isConfigured ? "configured" : "unconfigured"}`}
                  >
                    <div className="office-profile-badge">{cfg.label}</div>
                    <div className="office-profile-body">
                      <p className="office-profile-name">{profile?.name || `(no name set)`}</p>
                      <p className="office-profile-description">
                        {profile?.role || cfg.defaultRole}
                      </p>
                      {isConfigured ? (
                        <p className="office-profile-email">
                          <span className="office-email-icon">✉</span>
                          {profile.email}
                        </p>
                      ) : (
                        <p className="office-profile-unconfigured">Not yet configured</p>
                      )}
                      <p className="office-profile-description" style={{ marginTop: 8, fontSize: "0.8rem" }}>
                        E-signature: {hasSignature ? "✓ Uploaded by office" : "Not yet uploaded"}
                      </p>
                    </div>
                    <button
                      className="office-profile-edit-btn"
                      onClick={() => openOfficeModal(cfg)}
                    >
                      {isConfigured ? "Edit" : "Configure"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="acct-section-divider" />

          {/* ── Accounts Section ── */}
          <h2 className="acct-section-heading">Accounts</h2>

          <div className="acct-controls">
            <div className="acct-type-tabs">
              {["all", "Admin", "ISG", "CSG", "AO"].map((type) => (
                <button
                  key={type}
                  className={`acct-tab ${filterType === type ? "active" : ""}`}
                  onClick={() => setFilterType(type)}
                >
                  {type === "all" ? "All" : type}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="acct-search"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="acct-table-wrapper">
            {filteredAccounts.length === 0 ? (
              <div className="acct-empty">No accounts found.</div>
            ) : (
              <table className="acct-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Organization / Position</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account) => (
                    <tr
                      key={account.userId}
                      className={account.status !== "active" ? "row-inactive" : ""}
                    >
                      <td>
                        {account.fullName || "—"}
                        {isOwnAccount(account) && (
                          <span className="acct-you-badge"> (you)</span>
                        )}
                      </td>
                      <td className="acct-email-cell">{account.email}</td>
                      <td>
                        <span className={`acct-role-badge acct-role-${account.role?.toLowerCase()}`}>
                          {account.role}
                        </span>
                      </td>
                      <td>{getOrgName(account)}</td>
                      <td>
                        <span className={`acct-status-badge acct-status-${account.status}`}>
                          {account.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{formatDate(account.lastLogin)}</td>
                      <td className="acct-actions-cell">
                        <button
                          className="acct-action-btn acct-reset-btn"
                          onClick={() => openResetModal(account)}
                        >
                          Reset Password
                        </button>
                        <button
                          className={`acct-action-btn ${
                            account.status === "active"
                              ? "acct-deactivate-btn"
                              : "acct-activate-btn"
                          }`}
                          onClick={() => handleToggleStatus(account)}
                          disabled={isOwnAccount(account)}
                          title={isOwnAccount(account) ? "Cannot deactivate your own account" : ""}
                        >
                          {account.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Office Profile Edit Modal ── */}
          {showOfficeModal && editingOffice && (
            <div className="acct-modal-overlay" onMouseDown={() => setShowOfficeModal(false)}>
              <div className="acct-modal acct-modal-sm" onMouseDown={(e) => e.stopPropagation()}>
                <div className="acct-modal-header">
                  <h2>
                    {officeProfiles[editingOffice.id]?.email
                      ? `Edit ${editingOffice.label} Profile`
                      : `Configure ${editingOffice.label} Profile`}
                  </h2>
                  <button className="acct-modal-close" onClick={() => setShowOfficeModal(false)}>
                    ×
                  </button>
                </div>
                <div className="acct-modal-body">
                  {officeError && <div className="acct-form-error">{officeError}</div>}
                  <p className="office-modal-hint">
                    The full name and role below will appear on the e-signature stamp
                    placed on signed endorsement letters. Review links will be sent to
                    the contact email.
                  </p>
                  <div className="acct-form-group">
                    <label>Full Name *</label>
                    <input
                      type="text"
                      value={officeForm.name}
                      onChange={(e) => setOfficeForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Dr. Juan Dela Cruz"
                    />
                    <small>Appears on the signature stamp as the signatory name.</small>
                  </div>
                  <div className="acct-form-group">
                    <label>Role / Title *</label>
                    <input
                      type="text"
                      value={officeForm.role}
                      onChange={(e) => setOfficeForm((prev) => ({ ...prev, role: e.target.value }))}
                      placeholder={editingOffice.defaultRole}
                    />
                    <small>Appears under the name on the signature stamp.</small>
                  </div>
                  <div className="acct-form-group">
                    <label>Contact Email *</label>
                    <input
                      type="email"
                      value={officeForm.email}
                      onChange={(e) => setOfficeForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="office@earist.edu.ph"
                    />
                    <small>Tokenized review links will be sent to this address automatically.</small>
                  </div>
                  <p className="office-modal-hint" style={{ marginTop: 12, fontSize: "0.85rem" }}>
                    <strong>Note:</strong> The e-signature image is uploaded by the
                    office holder themselves on their first approval — admin cannot
                    set it from here.
                  </p>
                </div>
                <div className="acct-modal-footer">
                  <button className="acct-btn-secondary" onClick={() => setShowOfficeModal(false)}>
                    Cancel
                  </button>
                  <button className="acct-btn-primary" onClick={handleSaveOffice} disabled={officeSaving}>
                    {officeSaving ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Create Account Modal ── */}
          {showCreateModal && (
            <div className="acct-modal-overlay" onMouseDown={() => setShowCreateModal(false)}>
              <div className="acct-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="acct-modal-header">
                  <h2>Create New Account</h2>
                  <button className="acct-modal-close" onClick={() => setShowCreateModal(false)}>
                    ×
                  </button>
                </div>

                <div className="acct-modal-body">
                  {error && <div className="acct-form-error">{error}</div>}

                  {/* Category toggle */}
                  <div className="acct-form-group">
                    <label>Account Category *</label>
                    <div className="acct-category-toggle">
                      <button
                        type="button"
                        className={`acct-category-btn ${createForm.accountCategory === "org" ? "active" : ""}`}
                        onClick={() => handleCategoryChange("org")}
                      >
                        Organization Account
                      </button>
                      <button
                        type="button"
                        className={`acct-category-btn ${createForm.accountCategory === "admin" ? "active" : ""}`}
                        onClick={() => handleCategoryChange("admin")}
                      >
                        Admin / SAS Staff
                      </button>
                    </div>
                  </div>

                  {createForm.accountCategory === "org" ? (
                    <>
                      <div className="acct-form-group">
                        <label>Organization Type *</label>
                        <div className="acct-radio-group">
                          {["ISG", "CSG", "AO"].map((type) => (
                            <label key={type} className="acct-radio-label">
                              <input
                                type="radio"
                                name="orgType"
                                value={type}
                                checked={createForm.orgType === type}
                                onChange={() => handleOrgTypeChange(type)}
                              />
                              {type}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="acct-form-group">
                        <label>Organization *</label>
                        <select
                          value={createForm.organizationId}
                          onChange={(e) => handleOrgSelect(e.target.value)}
                        >
                          <option value="">Select organization...</option>
                          {orgsForSelectedType.map((org) => (
                            <option key={org.organizationId} value={org.organizationId}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="acct-form-group">
                        <label>Account Name *</label>
                        <input
                          type="text"
                          value={createForm.fullName}
                          onChange={(e) =>
                            setCreateForm((prev) => ({ ...prev, fullName: e.target.value }))
                          }
                          placeholder="e.g. ISG Main Account"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="acct-form-group">
                        <label>Full Name *</label>
                        <input
                          type="text"
                          value={createForm.fullName}
                          onChange={(e) =>
                            setCreateForm((prev) => ({ ...prev, fullName: e.target.value }))
                          }
                          placeholder="e.g. Juan dela Cruz"
                        />
                      </div>

                      <div className="acct-form-group">
                        <label>Position / Title</label>
                        <input
                          type="text"
                          value={createForm.position}
                          onChange={(e) =>
                            setCreateForm((prev) => ({ ...prev, position: e.target.value }))
                          }
                          placeholder="e.g. SAS Director, SAS Staff"
                        />
                        <small>Defaults to &quot;SAS Staff&quot; if left blank.</small>
                      </div>
                    </>
                  )}

                  <div className="acct-form-group">
                    <label>Email Address *</label>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={(e) =>
                        setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                      }
                      placeholder="account@email.com"
                    />
                  </div>

                  <div className="acct-form-group">
                    <label>Password *</label>
                    <div className="acct-password-row">
                      <input
                        type={showCreatePassword ? "text" : "password"}
                        value={createForm.password}
                        onChange={(e) =>
                          setCreateForm((prev) => ({ ...prev, password: e.target.value }))
                        }
                        placeholder="Minimum 8 characters"
                      />
                      <button
                        type="button"
                        className="acct-pw-toggle"
                        onClick={() => setShowCreatePassword(!showCreatePassword)}
                      >
                        {showCreatePassword ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        className="acct-pw-generate"
                        onClick={() =>
                          setCreateForm((prev) => ({ ...prev, password: generateSecurePassword() }))
                        }
                      >
                        Generate
                      </button>
                    </div>
                    <small>Minimum 8 characters required</small>
                  </div>

                  <div className="acct-form-group acct-checkbox-group">
                    <label className="acct-checkbox-label">
                      <input
                        type="checkbox"
                        checked={createForm.sendEmail}
                        onChange={(e) =>
                          setCreateForm((prev) => ({ ...prev, sendEmail: e.target.checked }))
                        }
                      />
                      Send login credentials to email address
                    </label>
                  </div>
                </div>

                <div className="acct-modal-footer">
                  <button className="acct-btn-secondary" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="acct-btn-primary"
                    onClick={handleCreateAccount}
                    disabled={submitting}
                  >
                    {submitting ? "Creating..." : "Create Account"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Reset Password Modal ── */}
          {showResetModal && selectedAccount && (
            <div className="acct-modal-overlay" onMouseDown={() => setShowResetModal(false)}>
              <div className="acct-modal acct-modal-sm" onMouseDown={(e) => e.stopPropagation()}>
                <div className="acct-modal-header">
                  <h2>Reset Password</h2>
                  <button className="acct-modal-close" onClick={() => setShowResetModal(false)}>
                    ×
                  </button>
                </div>
                <div className="acct-modal-body">
                  {error && <div className="acct-form-error">{error}</div>}
                  <p className="acct-reset-name">
                    <strong>{selectedAccount.fullName}</strong>
                  </p>
                  <p className="acct-reset-email">{selectedAccount.email}</p>
                  <div className="acct-form-group">
                    <label>New Password *</label>
                    <div className="acct-password-row">
                      <input
                        type={showResetPassword ? "text" : "password"}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="acct-pw-toggle"
                        onClick={() => setShowResetPassword(!showResetPassword)}
                      >
                        {showResetPassword ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        className="acct-pw-generate"
                        onClick={() => setResetPassword(generateSecurePassword())}
                      >
                        Generate
                      </button>
                    </div>
                    <small>Minimum 8 characters required</small>
                  </div>
                </div>
                <div className="acct-modal-footer">
                  <button className="acct-btn-secondary" onClick={() => setShowResetModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="acct-btn-primary"
                    onClick={handleResetPassword}
                    disabled={submitting}
                  >
                    {submitting ? "Resetting..." : "Reset Password"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminAccountManagement;
