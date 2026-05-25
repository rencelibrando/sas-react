import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import { getDocumentsByOrganization } from "../services/documentService";
import { listRequestsForOrganization } from "../services/equipmentRequestService";
import { getReportsForOrg } from "../services/reportService";
import { REPORT_TYPE_LABELS, REPORT_STATUS } from "../utils/reportConstants";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import MemorandumsSection from "../components/MemorandumsSection";
import Icon from "../components/Icon";
import { formatDate } from "../utils/formatters";
import "../styles/colors.css";
import "../styles/home.css";
import "./HomePage.css";

const toDate = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const navigate = (page) => {
  window.dispatchEvent(new CustomEvent("pageNavigate", { detail: page }));
};

const HomePage = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [reports, setReports] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        if (cancelled) return;
        if (!userDoc) return;
        setUserData(userDoc);

        const orgId = userDoc.organizationId;
        if (!orgId) {
          setLoading(false);
          return;
        }

        const [orgDoc, allDocs, eqReqs, orgReports] = await Promise.all([
          getOrganizationById(orgId),
          getDocumentsByOrganization(orgId).catch(() => []),
          listRequestsForOrganization(orgId).catch(() => []),
          getReportsForOrg(orgId).catch(() => []),
        ]);
        if (cancelled) return;

        if (orgDoc) setOrganizationData(orgDoc);

        const proposalDocs = (allDocs || []).filter(
          (d) => d.documentType === "activity_proposal"
        );
        setProposals(proposalDocs);
        setEquipmentRequests(eqReqs || []);
        setReports(orgReports || []);
      } catch (error) {
        console.error("Error loading dashboard:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const organizationName = organizationData?.name || "Organization";
  const role = userData?.role || "ISG";
  const userRole = userData?.userRole || "";
  const userName = userData?.fullName || auth.currentUser?.email || "User";
  const firstName = (userName.split(" ")[0] || userName).trim();

  // Derived counts
  const activeProposals = proposals.filter((p) =>
    ["pending", "under_review", "returned"].includes(p.status)
  ).length;
  const equipmentInFlight = equipmentRequests.filter((r) =>
    ["pending", "approved", "released", "returned_for_revision"].includes(r.status)
  ).length;
  const reportsDue = reports.filter(
    (r) =>
      r.status === REPORT_STATUS.PENDING ||
      r.status === REPORT_STATUS.LATE ||
      r.status === REPORT_STATUS.NEEDS_REVISION
  ).length;

  const startOfMonth = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })();

  const approvedThisMonth = proposals.filter((p) => {
    if (!["approved", "released"].includes(p.status)) return false;
    const d = toDate(p.lastUpdated || p.dateSubmitted);
    return d && d >= startOfMonth;
  }).length;

  // Action items — items the user should act on
  const actionItems = [];

  reports.forEach((r) => {
    if (r.status === REPORT_STATUS.LATE) {
      actionItems.push({
        key: `report-late-${r.reportId || r.id}`,
        urgency: "high",
        icon: "reports",
        title: `${REPORT_TYPE_LABELS[r.reportType] || "Report"} is overdue`,
        meta: r.dueDate ? `Due ${formatDate(toDate(r.dueDate))}` : "Overdue",
        page: "reports",
      });
    } else if (r.status === REPORT_STATUS.NEEDS_REVISION) {
      actionItems.push({
        key: `report-rev-${r.reportId || r.id}`,
        urgency: "high",
        icon: "reports",
        title: `${REPORT_TYPE_LABELS[r.reportType] || "Report"} needs revision`,
        meta: "Admin returned with remarks",
        page: "reports",
      });
    } else if (r.status === REPORT_STATUS.PENDING && r.dueDate) {
      const due = toDate(r.dueDate);
      if (due) {
        const daysLeft = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 3) {
          actionItems.push({
            key: `report-soon-${r.reportId || r.id}`,
            urgency: daysLeft <= 1 ? "high" : "medium",
            icon: "reports",
            title: `${REPORT_TYPE_LABELS[r.reportType] || "Report"} due soon`,
            meta: daysLeft <= 0 ? "Due today" : `In ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
            page: "reports",
          });
        }
      }
    }
  });

  proposals.forEach((p) => {
    if (p.status === "returned") {
      actionItems.push({
        key: `proposal-ret-${p.documentId}`,
        urgency: "high",
        icon: "activity-proposals",
        title: `Proposal needs revision`,
        meta: p.title || "Returned by reviewer",
        page: "activity-proposals",
      });
    }
  });

  equipmentRequests.forEach((r) => {
    if (r.status === "returned_for_revision") {
      actionItems.push({
        key: `eq-rev-${r.documentId || r.id}`,
        urgency: "high",
        icon: "equipment",
        title: "Equipment request needs revision",
        meta: r.purposeBrief || "Returned for revision",
        page: "equipment-borrowing",
      });
    } else if (r.status === "approved") {
      actionItems.push({
        key: `eq-pickup-${r.documentId || r.id}`,
        urgency: "medium",
        icon: "equipment",
        title: "Equipment ready for pickup",
        meta: r.purposeBrief || "Approved — awaiting release",
        page: "equipment-borrowing",
      });
    }
  });

  actionItems.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.urgency] - order[b.urgency];
  });
  const topActions = actionItems.slice(0, 4);

  // Recent activity (top 5 across all types, by date)
  const activityItems = [
    ...proposals.map((p) => ({
      key: `prop-${p.documentId}`,
      type: "Proposal",
      title: p.title || "Activity Proposal",
      status: p.status,
      date: toDate(p.lastUpdated || p.dateSubmitted),
      page: "activity-proposals",
    })),
    ...equipmentRequests.map((r) => ({
      key: `eq-${r.documentId || r.id}`,
      type: "Equipment",
      title: r.purposeBrief || "Equipment Request",
      status: r.status,
      date: toDate(r.lastUpdated || r.dateSubmitted),
      page: "equipment-borrowing",
    })),
    ...reports.map((r) => ({
      key: `rep-${r.reportId || r.id}`,
      type: "Report",
      title: REPORT_TYPE_LABELS[r.reportType] || "Report",
      status: r.status,
      date: toDate(r.lastUpdated || r.submittedAt || r.dueDate),
      page: "reports",
    })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  const statusLabel = (s) => {
    const map = {
      pending: "Pending",
      under_review: "Under Review",
      approved: "Approved",
      released: "Released",
      returned: "Returned",
      returned_for_revision: "Needs Revision",
      rejected: "Rejected",
      submitted: "Submitted",
      reviewed: "Reviewed",
      late: "Late",
      needs_revision: "Needs Revision",
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
    <div className="home-container">
      <Navbar
        organizationName={organizationName}
        role={role}
        userRole={userRole}
        userName={userName}
      />

      <DashboardLayout currentPage="dashboard">
        {loading ? (
          <LoadingScreen compact={true} />
        ) : (
          <div className="dashboard-v2">
            {/* Welcome banner — compact */}
            <section className="dash-welcome">
              <div className="dash-welcome-text">
                <h1 className="dash-welcome-title">Welcome back, {firstName}</h1>
                <div className="dash-welcome-sub">
                  Representing <strong>{organizationName}</strong>
                  {userRole && <> · <span>{userRole}</span></>}
                </div>
              </div>
              <div className="dash-welcome-date">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </section>

            {/* Stat tiles */}
            <section className="dash-stats">
              <button
                className="dash-stat dash-stat--proposals"
                onClick={() => navigate("activity-proposals")}
              >
                <div className="dash-stat-icon"><Icon name="activity-proposals" size={22} /></div>
                <div className="dash-stat-body">
                  <div className="dash-stat-value">{activeProposals}</div>
                  <div className="dash-stat-label">Active Proposals</div>
                </div>
              </button>

              <button
                className="dash-stat dash-stat--equipment"
                onClick={() => navigate("equipment-borrowing")}
              >
                <div className="dash-stat-icon"><Icon name="equipment" size={22} /></div>
                <div className="dash-stat-body">
                  <div className="dash-stat-value">{equipmentInFlight}</div>
                  <div className="dash-stat-label">Equipment In Flight</div>
                </div>
              </button>

              <button
                className="dash-stat dash-stat--reports"
                onClick={() => navigate("reports")}
              >
                <div className="dash-stat-icon"><Icon name="reports" size={22} /></div>
                <div className="dash-stat-body">
                  <div className="dash-stat-value">{reportsDue}</div>
                  <div className="dash-stat-label">Reports Due</div>
                </div>
              </button>

              <button
                className="dash-stat dash-stat--approved"
                onClick={() => navigate("activity-proposals")}
              >
                <div className="dash-stat-icon"><Icon name="analytics" size={22} /></div>
                <div className="dash-stat-body">
                  <div className="dash-stat-value">{approvedThisMonth}</div>
                  <div className="dash-stat-label">Approved This Month</div>
                </div>
              </button>
            </section>

            {/* Two-column: Action items + Recent activity */}
            <section className="dash-two-col">
              {/* Action items */}
              <div className="dash-card">
                <header className="dash-card-header">
                  <div className="dash-card-title-wrap">
                    <span className="dash-card-icon dash-card-icon--alert">!</span>
                    <h2 className="dash-card-title">Needs Your Attention</h2>
                  </div>
                  {topActions.length > 0 && (
                    <span className="dash-card-count">{topActions.length}</span>
                  )}
                </header>
                <div className="dash-card-body">
                  {topActions.length === 0 ? (
                    <div className="dash-empty">
                      <div className="dash-empty-check">✓</div>
                      <div className="dash-empty-text">You're all caught up.</div>
                      <div className="dash-empty-sub">No urgent items right now.</div>
                    </div>
                  ) : (
                    <ul className="dash-action-list">
                      {topActions.map((a) => (
                        <li
                          key={a.key}
                          className={`dash-action-item dash-action-item--${a.urgency}`}
                          onClick={() => navigate(a.page)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate(a.page)}
                        >
                          <div className="dash-action-icon">
                            <Icon name={a.icon} size={18} />
                          </div>
                          <div className="dash-action-text">
                            <div className="dash-action-title">{a.title}</div>
                            <div className="dash-action-meta">{a.meta}</div>
                          </div>
                          <Icon name="chevron-right" size={16} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Recent activity */}
              <div className="dash-card">
                <header className="dash-card-header">
                  <div className="dash-card-title-wrap">
                    <span className="dash-card-icon"><Icon name="analytics" size={16} /></span>
                    <h2 className="dash-card-title">Recent Activity</h2>
                  </div>
                </header>
                <div className="dash-card-body">
                  {activityItems.length === 0 ? (
                    <div className="dash-empty">
                      <div className="dash-empty-text">No recent activity yet.</div>
                      <div className="dash-empty-sub">Submit a proposal to get started.</div>
                    </div>
                  ) : (
                    <ul className="dash-activity-list">
                      {activityItems.map((it) => (
                        <li
                          key={it.key}
                          className="dash-activity-item"
                          onClick={() => navigate(it.page)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate(it.page)}
                        >
                          <div className="dash-activity-main">
                            <div className="dash-activity-title">{it.title}</div>
                            <div className="dash-activity-meta">
                              <span className="dash-activity-type">{it.type}</span>
                              <span className="dash-activity-dot">·</span>
                              <span>{formatDate(it.date)}</span>
                            </div>
                          </div>
                          <span className={`dash-status-pill dash-status-pill--${statusTone(it.status)}`}>
                            {statusLabel(it.status)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* Memorandums */}
            <section className="dash-memos">
              <MemorandumsSection heading="SAS Memorandums" />
            </section>
          </div>
        )}
      </DashboardLayout>
    </div>
  );
};

export default HomePage;
