import { useState, useEffect, useCallback, useMemo } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import {
  getReportsForAdmin,
  reviewReport,
  markOverduePendingReports,
} from "../services/reportService";
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS,
  REPORT_STATUS_LABELS,
} from "../utils/reportConstants";
import AdminLayout from "../components/admin/AdminLayout";
import "../styles/colors.css";
import "./AdminReports.css";

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

const formatDate = (value) => {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const statusBadgeClass = (status) => {
  switch (status) {
    case REPORT_STATUS.SUBMITTED:
      return "admin-report-badge admin-report-badge--submitted";
    case REPORT_STATUS.LATE:
      return "admin-report-badge admin-report-badge--late";
    case REPORT_STATUS.REVIEWED:
      return "admin-report-badge admin-report-badge--reviewed";
    case REPORT_STATUS.NEEDS_REVISION:
      return "admin-report-badge admin-report-badge--revision";
    case REPORT_STATUS.PENDING:
    default:
      return "admin-report-badge admin-report-badge--pending";
  }
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: REPORT_STATUS.SUBMITTED, label: "Submitted" },
  { id: REPORT_STATUS.LATE, label: "Late" },
  { id: REPORT_STATUS.PENDING, label: "Pending" },
  { id: REPORT_STATUS.NEEDS_REVISION, label: "Needs Revision" },
  { id: REPORT_STATUS.REVIEWED, label: "Reviewed" },
];

const AdminReports = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [reports, setReports] = useState([]);
  const [orgCache, setOrgCache] = useState({});
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeReport, setActiveReport] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      await markOverduePendingReports();
    } catch (err) {
      console.error("Overdue scan failed:", err);
    }
    const list = await getReportsForAdmin();
    setReports(list);

    const missingOrgIds = Array.from(
      new Set(list.map((r) => r.organizationId).filter(Boolean))
    ).filter((id) => !orgCache[id]);
    if (missingOrgIds.length > 0) {
      const entries = await Promise.all(
        missingOrgIds.map(async (id) => {
          try {
            const org = await getOrganizationById(id);
            return [id, org?.name || id];
          } catch {
            return [id, id];
          }
        })
      );
      setOrgCache((prev) => {
        const next = { ...prev };
        for (const [id, name] of entries) next[id] = name;
        return next;
      });
    }
  }, [orgCache]);

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
        await load();
      } catch (err) {
        console.error("Error fetching reports:", err);
        setError("Failed to load reports.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return reports;
    return reports.filter((r) => r.status === filter);
  }, [reports, filter]);

  const counts = useMemo(() => {
    const c = { all: reports.length };
    for (const f of FILTERS) {
      if (f.id === "all") continue;
      c[f.id] = reports.filter((r) => r.status === f.id).length;
    }
    return c;
  }, [reports]);

  const openReview = (report) => {
    setActiveReport(report);
    setRemarks(report.reviewRemarks || "");
    setError("");
    setSuccess("");
  };

  const closeReview = () => {
    setActiveReport(null);
    setRemarks("");
  };

  const submitReview = async (decision) => {
    if (!activeReport) return;
    setSubmitting(true);
    setError("");
    try {
      const user = auth.currentUser;
      await reviewReport(activeReport.id, user.uid, decision, remarks.trim());
      setSuccess(
        decision === "approve"
          ? "Report marked as reviewed."
          : "Report sent back for revision."
      );
      await load();
      closeReview();
    } catch (err) {
      console.error("Review failed:", err);
      setError(err.message || "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout currentPage="reports" userData={userData}>
      <div className="admin-reports">
        <div className="admin-reports-header">
          <h1 className="admin-reports-title">Reports</h1>
          <p className="admin-reports-subtitle">
            Post-activity reports submitted by organizations. Review and either
            mark as reviewed or send back for revision.
          </p>
        </div>

        {error && <div className="admin-reports-error">{error}</div>}
        {success && <div className="admin-reports-success">{success}</div>}

        {!loading && (
          <div className="admin-reports-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`admin-reports-filter ${
                  filter === f.id ? "admin-reports-filter--active" : ""
                }`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="admin-reports-filter-count">
                  {counts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="admin-reports-empty">Loading reports…</div>
        ) : filtered.length === 0 ? (
          <div className="admin-reports-empty">No reports in this view.</div>
        ) : (
          <div className="admin-reports-table">
            <div className="admin-reports-table-head">
              <div>Proposal</div>
              <div>Organization</div>
              <div>Type</div>
              <div>Due</div>
              <div>Submitted</div>
              <div>Status</div>
              <div>Action</div>
            </div>
            {filtered.map((r) => (
              <div key={r.id} className="admin-reports-table-row">
                <div className="admin-reports-cell-title">
                  {r.proposalTitle || "(untitled)"}
                </div>
                <div>{orgCache[r.organizationId] || r.organizationId}</div>
                <div>{REPORT_TYPE_LABELS[r.reportType] || r.reportType}</div>
                <div>{formatDate(r.dueDate)}</div>
                <div>{formatDate(r.submittedAt)}</div>
                <div>
                  <span className={statusBadgeClass(r.status)}>
                    {REPORT_STATUS_LABELS[r.status] || r.status}
                  </span>
                </div>
                <div>
                  <button
                    className="admin-reports-action-btn"
                    onClick={() => openReview(r)}
                    disabled={!r.file?.fileUrl}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeReport && (
          <div className="admin-reports-modal-backdrop" onClick={closeReview}>
            <div
              className="admin-reports-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="admin-reports-modal-header">
                <h2>Review Report</h2>
                <button
                  className="admin-reports-modal-close"
                  onClick={closeReview}
                >
                  ×
                </button>
              </div>
              <div className="admin-reports-modal-body">
                <div className="admin-reports-modal-meta">
                  <div>
                    <strong>Proposal:</strong>{" "}
                    {activeReport.proposalTitle || "(untitled)"}
                  </div>
                  <div>
                    <strong>Organization:</strong>{" "}
                    {orgCache[activeReport.organizationId] ||
                      activeReport.organizationId}
                  </div>
                  <div>
                    <strong>Type:</strong>{" "}
                    {REPORT_TYPE_LABELS[activeReport.reportType] ||
                      activeReport.reportType}
                  </div>
                  <div>
                    <strong>Due:</strong> {formatDate(activeReport.dueDate)}
                  </div>
                  <div>
                    <strong>Submitted:</strong>{" "}
                    {formatDate(activeReport.submittedAt)}
                  </div>
                  <div>
                    <strong>Status:</strong>{" "}
                    <span className={statusBadgeClass(activeReport.status)}>
                      {REPORT_STATUS_LABELS[activeReport.status] ||
                        activeReport.status}
                    </span>
                  </div>
                </div>
                {activeReport.file?.fileUrl && (
                  <div className="admin-reports-modal-file">
                    <a
                      href={activeReport.file.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {activeReport.file.fileName}
                    </a>
                  </div>
                )}
                <label className="admin-reports-modal-label" htmlFor="remarks">
                  Remarks {`(${
                    activeReport.status === REPORT_STATUS.NEEDS_REVISION
                      ? "required for revision"
                      : "optional"
                  })`}
                </label>
                <textarea
                  id="remarks"
                  className="admin-reports-modal-textarea"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder="Comments for the organization (visible to them)…"
                />
              </div>
              <div className="admin-reports-modal-actions">
                <button
                  className="admin-reports-btn admin-reports-btn--secondary"
                  onClick={closeReview}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  className="admin-reports-btn admin-reports-btn--revise"
                  onClick={() => submitReview("revise")}
                  disabled={submitting || !remarks.trim()}
                >
                  Request Revision
                </button>
                <button
                  className="admin-reports-btn admin-reports-btn--approve"
                  onClick={() => submitReview("approve")}
                  disabled={submitting}
                >
                  Mark as Reviewed
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminReports;
