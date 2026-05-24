import { useState, useEffect, useCallback } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getAuthActivityLog } from "../services/authActivityLogService";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import { formatDateTime } from "../utils/formatters";
import "../styles/colors.css";
import "./AdminActivityProposals.css";
import "./AdminActivityLog.css";

const PAGE_SIZE = 50;

const EVENT_LABEL = {
  login_success: "Login",
  login_failed: "Login failed",
  logout: "Logout",
  google_login_success: "Google login",
  google_login_failed: "Google login failed",
  otp_sent: "OTP sent",
  otp_verified: "OTP verified",
  otp_failed: "OTP failed",
  password_reset_success: "Password reset",
  password_reset_failed: "Password reset failed",
  account_created: "Account created",
};

const TYPE_GROUPS = [
  {
    id: "login",
    label: "Login",
    types: ["login_success", "login_failed", "google_login_success", "google_login_failed"],
  },
  { id: "logout", label: "Logout", types: ["logout"] },
  { id: "otp", label: "OTP", types: ["otp_sent", "otp_verified", "otp_failed"] },
  {
    id: "password_reset",
    label: "Password reset",
    types: ["password_reset_success", "password_reset_failed"],
  },
  { id: "account_created", label: "Account created", types: ["account_created"] },
];

const toLocalISODate = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

const startOfDay = (yyyyMmDd) => {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const endOfDay = (yyyyMmDd) => {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

const AdminActivityLog = () => {
  const [userData, setUserData] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);

  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 6);
  const [dateFrom, setDateFrom] = useState(toLocalISODate(sevenDaysAgo));
  const [dateTo, setDateTo] = useState(toLocalISODate(today));

  const [selectedGroups, setSelectedGroups] = useState(
    () => new Set(TYPE_GROUPS.map((g) => g.id))
  );

  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        const user = auth.currentUser;
        if (user) {
          const doc = await getUserById(user.uid);
          setUserData(doc);
        }
      } catch (err) {
        console.error("Failed to load admin user:", err);
      } finally {
        setBootLoading(false);
      }
    };
    init();
  }, []);

  const fetchPage = useCallback(
    async ({ reset = false } = {}) => {
      setLoadingPage(true);
      setError("");
      try {
        const { entries: page, lastDoc } = await getAuthActivityLog({
          from: startOfDay(dateFrom),
          to: endOfDay(dateTo),
          cursor: reset ? null : cursor,
          pageSize: PAGE_SIZE,
        });
        setEntries((prev) => (reset ? page : [...prev, ...page]));
        setCursor(lastDoc);
        setHasMore(page.length === PAGE_SIZE);
      } catch (err) {
        setError(err?.message || "Failed to load activity log");
      } finally {
        setLoadingPage(false);
      }
    },
    [dateFrom, dateTo, cursor]
  );

  useEffect(() => {
    fetchPage({ reset: true });
    // Re-fetch whenever the date range changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const toggleGroup = (id) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeTypes = new Set(
    TYPE_GROUPS.filter((g) => selectedGroups.has(g.id)).flatMap((g) => g.types)
  );

  const visibleEntries = entries.filter((e) => activeTypes.has(e.type));

  const resetFilters = () => {
    setSelectedGroups(new Set(TYPE_GROUPS.map((g) => g.id)));
    const t = new Date();
    const start = new Date();
    start.setDate(t.getDate() - 6);
    setDateFrom(toLocalISODate(start));
    setDateTo(toLocalISODate(t));
  };

  if (bootLoading) {
    return (
      <AdminLayout userData={userData} currentPage="activity-log">
        <LoadingScreen compact />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout userData={userData} currentPage="activity-log">
      <div className="admin-activity-log">
        <div className="admin-proposals-header">
          <h1 className="admin-proposals-title">Activity Log</h1>
          <p className="admin-activity-log-subtitle">
            Authentication events — logins, logouts, OTPs, password resets, and account creations.
          </p>
        </div>

        <div className="admin-proposals-filters">
          <div className="filters-row">
            <div className="filter-group filter-group-date">
              <label className="filter-label">Date From</label>
              <input
                type="date"
                className="filter-input"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="filter-group filter-group-date">
              <label className="filter-label">Date To</label>
              <input
                type="date"
                className="filter-input"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="filter-group activity-log-types">
              <label className="filter-label">Event types</label>
              <div className="activity-log-chips">
                {TYPE_GROUPS.map((g) => {
                  const active = selectedGroups.has(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`activity-log-chip ${active ? "active" : ""}`}
                      onClick={() => toggleGroup(g.id)}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="filters-actions">
            <button className="filter-clear-button" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        {error && (
          <div className="admin-proposals-alert admin-proposals-alert-error">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}

        <div className="admin-proposals-list">
          {visibleEntries.length === 0 && !loadingPage ? (
            <div className="admin-proposals-empty">
              <p>No activity in this range.</p>
            </div>
          ) : (
            <table className="proposals-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.timestamp ? formatDateTime(entry.timestamp) : "—"}</td>
                    <td>{EVENT_LABEL[entry.type] || entry.type}</td>
                    <td>{entry.email || "—"}</td>
                    <td>
                      <span
                        className={`activity-log-status ${
                          entry.success ? "success" : "failure"
                        }`}
                      >
                        {entry.success ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="activity-log-details">
                      {entry.errorCode || entry.context || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="activity-log-footer">
          {loadingPage && <span className="activity-log-loading">Loading…</span>}
          {!loadingPage && hasMore && (
            <button
              className="activity-log-load-more"
              onClick={() => fetchPage({ reset: false })}
            >
              Load more
            </button>
          )}
          {!loadingPage && !hasMore && entries.length > 0 && (
            <span className="activity-log-end">End of results.</span>
          )}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminActivityLog;
