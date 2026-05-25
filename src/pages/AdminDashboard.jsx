import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById, getAllOrgUsers } from "../services/userService";
import { searchDocuments } from "../services/documentService";
import { listRequestsForAdmin } from "../services/equipmentRequestService";
import { getReportsForAdmin } from "../services/reportService";
import { REPORT_TYPE_LABELS, REPORT_STATUS } from "../utils/reportConstants";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import Icon from "../components/Icon";
import { formatDate } from "../utils/formatters";
import "../styles/colors.css";
import "./AdminDashboard.css";

const toDate = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const navigate = (page) => {
  window.dispatchEvent(new CustomEvent("adminNavigate", { detail: page }));
};

const timeAgo = (date) => {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
};

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [reports, setReports] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getUserById(user.uid);
        if (userDoc) {
          setUserData(userDoc);
          if (userDoc.role !== "Admin") return;
          if (userDoc.status !== "active") {
            setLoading(false);
            return;
          }
        }

        const [allDocs, eqReqs, allReports, users] = await Promise.all([
          searchDocuments({}).catch(() => []),
          listRequestsForAdmin({}).catch(() => []),
          getReportsForAdmin({}).catch(() => []),
          getAllOrgUsers().catch(() => []),
        ]);

        setProposals(
          (allDocs || []).filter((d) => d.documentType === "activity_proposal")
        );
        setEquipmentRequests(eqReqs || []);
        setReports(allReports || []);
        setOrgUsers(users || []);
      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (userData && userData.status !== "active") {
    return (
      <div className="admin-dashboard-blocked">
        <div className="blocked-message">
          <h2>Access Blocked</h2>
          <p>Your administrator account is inactive. Please contact system administrator.</p>
        </div>
      </div>
    );
  }

  if (userData && userData.role !== "Admin") {
    return (
      <div className="admin-dashboard-blocked">
        <div className="blocked-message">
          <h2>Access Denied</h2>
          <p>You do not have permission to access the admin dashboard.</p>
        </div>
      </div>
    );
  }

  // Stats
  const pendingProposals = proposals.filter((p) =>
    ["pending", "under_review"].includes(p.status)
  ).length;

  const pendingEquipment = equipmentRequests.filter((r) =>
    ["pending"].includes(r.status)
  ).length;

  const pendingReports = reports.filter((r) =>
    [REPORT_STATUS.SUBMITTED].includes(r.status)
  ).length;

  const lateReports = reports.filter(
    (r) => r.status === REPORT_STATUS.LATE
  ).length;

  const activeAccounts = orgUsers.filter(
    (u) => (u.status || "active") === "active"
  ).length;

  const startOf24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const submissionsToday = [...proposals, ...equipmentRequests].filter((d) => {
    const dt = toDate(d.dateSubmitted);
    return dt && dt >= startOf24hAgo;
  }).length;

  // Needs Attention — anything pending submitted >24h ago, or late reports
  const attentionItems = [];

  proposals.forEach((p) => {
    if (!["pending", "under_review"].includes(p.status)) return;
    const dt = toDate(p.dateSubmitted);
    if (!dt) return;
    const hours = (Date.now() - dt.getTime()) / (1000 * 60 * 60);
    if (hours >= 24) {
      attentionItems.push({
        key: `prop-${p.documentId}`,
        icon: "activity-proposals",
        title: p.title || "Activity Proposal",
        meta: `${p.organizationName || "Org"} · waiting ${Math.floor(hours / 24)}d`,
        hours,
        page: "activity-proposals",
      });
    }
  });

  equipmentRequests.forEach((r) => {
    if (r.status !== "pending") return;
    const dt = toDate(r.dateSubmitted);
    if (!dt) return;
    const hours = (Date.now() - dt.getTime()) / (1000 * 60 * 60);
    if (hours >= 24) {
      attentionItems.push({
        key: `eq-${r.documentId || r.id}`,
        icon: "equipment",
        title: r.purposeBrief || "Equipment Request",
        meta: `${r.organizationName || "Org"} · waiting ${Math.floor(hours / 24)}d`,
        hours,
        page: "equipment-requests",
      });
    }
  });

  reports.forEach((r) => {
    if (r.status === REPORT_STATUS.LATE) {
      attentionItems.push({
        key: `rep-${r.reportId || r.id}`,
        icon: "reports",
        title: `${REPORT_TYPE_LABELS[r.reportType] || "Report"} late`,
        meta: `${r.organizationName || "Org"} · past due`,
        hours: 999,
        page: "reports",
      });
    }
  });

  attentionItems.sort((a, b) => b.hours - a.hours);
  const topAttention = attentionItems.slice(0, 5);

  // Recent activity feed — latest events across system
  const activity = [
    ...proposals.map((p) => ({
      key: `pa-${p.documentId}`,
      type: "Proposal",
      title: p.title || "Activity Proposal",
      org: p.organizationName,
      status: p.status,
      date: toDate(p.lastUpdated || p.dateSubmitted),
      page: "activity-proposals",
    })),
    ...equipmentRequests.map((r) => ({
      key: `ea-${r.documentId || r.id}`,
      type: "Equipment",
      title: r.purposeBrief || "Equipment Request",
      org: r.organizationName,
      status: r.status,
      date: toDate(r.lastUpdated || r.dateSubmitted),
      page: "equipment-requests",
    })),
    ...reports.map((r) => ({
      key: `ra-${r.reportId || r.id}`,
      type: "Report",
      title: REPORT_TYPE_LABELS[r.reportType] || "Report",
      org: r.organizationName,
      status: r.status,
      date: toDate(r.lastUpdated || r.submittedAt),
      page: "reports",
    })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6);

  const statusLabel = (s) => {
    const map = {
      pending: "Pending",
      under_review: "Reviewing",
      approved: "Approved",
      released: "Released",
      returned: "Returned",
      returned_for_revision: "Returned",
      rejected: "Rejected",
      submitted: "Submitted",
      reviewed: "Reviewed",
      late: "Late",
      needs_revision: "Revisions",
    };
    return map[s] || s;
  };

  const statusTone = (s) => {
    if (["approved", "released", "reviewed", "submitted"].includes(s)) return "success";
    if (["pending", "under_review"].includes(s)) return "info";
    if (["returned", "returned_for_revision", "needs_revision", "late"].includes(s)) return "warning";
    if (s === "rejected") return "danger";
    return "neutral";
  };

  return (
    <AdminLayout userData={userData} currentPage="dashboard">
      {loading ? (
        <LoadingScreen compact={true} />
      ) : (
        <div className="admin-dashboard">
          {/* Header */}
          <section className="admin-dash-welcome">
            <div>
              <h1 className="admin-dash-title">Admin Dashboard</h1>
              <p className="admin-dash-subtitle">
                System overview · {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="admin-dash-quick-pills">
              <button
                className="admin-quick-pill"
                onClick={() => navigate("activity-proposals")}
              >
                <Icon name="activity-proposals" size={16} />
                Review Proposals
              </button>
              <button
                className="admin-quick-pill"
                onClick={() => navigate("memorandums")}
              >
                <Icon name="documents" size={16} />
                Memorandums
              </button>
              <button
                className="admin-quick-pill"
                onClick={() => navigate("account-management")}
              >
                <Icon name="profile" size={16} />
                Accounts
              </button>
            </div>
          </section>

          {/* Stat tiles */}
          <section className="admin-dash-stats">
            <button
              className="admin-dash-stat admin-dash-stat--proposals"
              onClick={() => navigate("activity-proposals")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="activity-proposals" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{pendingProposals}</div>
                <div className="admin-dash-stat-label">Pending Proposals</div>
              </div>
            </button>

            <button
              className="admin-dash-stat admin-dash-stat--equipment"
              onClick={() => navigate("equipment-requests")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="equipment" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{pendingEquipment}</div>
                <div className="admin-dash-stat-label">Pending Equipment</div>
              </div>
            </button>

            <button
              className="admin-dash-stat admin-dash-stat--reports"
              onClick={() => navigate("reports")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="reports" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{pendingReports}</div>
                <div className="admin-dash-stat-label">Reports to Review</div>
              </div>
            </button>

            <button
              className="admin-dash-stat admin-dash-stat--late"
              onClick={() => navigate("reports")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="reports" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{lateReports}</div>
                <div className="admin-dash-stat-label">Late Reports</div>
              </div>
            </button>

            <button
              className="admin-dash-stat admin-dash-stat--accounts"
              onClick={() => navigate("account-management")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="profile" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{activeAccounts}</div>
                <div className="admin-dash-stat-label">Active Accounts</div>
              </div>
            </button>

            <button
              className="admin-dash-stat admin-dash-stat--today"
              onClick={() => navigate("activity-proposals")}
            >
              <div className="admin-dash-stat-icon">
                <Icon name="analytics" size={22} />
              </div>
              <div className="admin-dash-stat-body">
                <div className="admin-dash-stat-value">{submissionsToday}</div>
                <div className="admin-dash-stat-label">Submissions (24h)</div>
              </div>
            </button>
          </section>

          {/* Two columns */}
          <section className="admin-dash-two-col">
            {/* Needs Attention */}
            <div className="admin-dash-card">
              <header className="admin-dash-card-header">
                <div className="admin-dash-card-title-wrap">
                  <span className="admin-dash-card-icon admin-dash-card-icon--alert">!</span>
                  <h2 className="admin-dash-card-title">Needs Attention</h2>
                  <span className="admin-dash-card-sub">Pending &gt; 24 hours</span>
                </div>
                {topAttention.length > 0 && (
                  <span className="admin-dash-card-count">{topAttention.length}</span>
                )}
              </header>
              <div className="admin-dash-card-body">
                {topAttention.length === 0 ? (
                  <div className="admin-dash-empty">
                    <div className="admin-dash-empty-check">✓</div>
                    <div className="admin-dash-empty-text">Nothing waiting too long.</div>
                    <div className="admin-dash-empty-sub">All pending items are recent.</div>
                  </div>
                ) : (
                  <ul className="admin-dash-action-list">
                    {topAttention.map((a) => (
                      <li
                        key={a.key}
                        className="admin-dash-action-item"
                        onClick={() => navigate(a.page)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate(a.page)}
                      >
                        <div className="admin-dash-action-icon">
                          <Icon name={a.icon} size={18} />
                        </div>
                        <div className="admin-dash-action-text">
                          <div className="admin-dash-action-title">{a.title}</div>
                          <div className="admin-dash-action-meta">{a.meta}</div>
                        </div>
                        <Icon name="chevron-right" size={16} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="admin-dash-card">
              <header className="admin-dash-card-header">
                <div className="admin-dash-card-title-wrap">
                  <span className="admin-dash-card-icon">
                    <Icon name="analytics" size={16} />
                  </span>
                  <h2 className="admin-dash-card-title">Recent Activity</h2>
                </div>
              </header>
              <div className="admin-dash-card-body">
                {activity.length === 0 ? (
                  <div className="admin-dash-empty">
                    <div className="admin-dash-empty-text">No recent activity.</div>
                  </div>
                ) : (
                  <ul className="admin-dash-activity-list">
                    {activity.map((it) => (
                      <li
                        key={it.key}
                        className="admin-dash-activity-item"
                        onClick={() => navigate(it.page)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate(it.page)}
                      >
                        <div className="admin-dash-activity-main">
                          <div className="admin-dash-activity-title">{it.title}</div>
                          <div className="admin-dash-activity-meta">
                            <span className="admin-dash-activity-type">{it.type}</span>
                            <span className="admin-dash-activity-dot">·</span>
                            <span>{it.org || "—"}</span>
                            <span className="admin-dash-activity-dot">·</span>
                            <span>{timeAgo(it.date)}</span>
                          </div>
                        </div>
                        <span className={`admin-dash-status-pill admin-dash-status-pill--${statusTone(it.status)}`}>
                          {statusLabel(it.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminDashboard;
