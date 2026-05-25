import { useState, useEffect, useMemo, useCallback } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import {
  getReportsForOrg,
  submitReport,
  markOverduePendingReports,
} from "../services/reportService";
import {
  REPORT_TYPE_LABELS,
  REPORT_TYPE_DESCRIPTIONS,
  REPORT_STATUS,
  REPORT_STATUS_LABELS,
} from "../utils/reportConstants";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import "../styles/colors.css";
import "./ReportsPage.css";

const ALLOWED_EXT = ".pdf,.doc,.docx";

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
      return "report-badge report-badge--submitted";
    case REPORT_STATUS.LATE:
      return "report-badge report-badge--late";
    case REPORT_STATUS.REVIEWED:
      return "report-badge report-badge--reviewed";
    case REPORT_STATUS.NEEDS_REVISION:
      return "report-badge report-badge--revision";
    case REPORT_STATUS.PENDING:
    default:
      return "report-badge report-badge--pending";
  }
};

const ReportsPage = ({ orgType: orgTypeProp = null }) => {
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [error, setError] = useState("");

  const loadReports = useCallback(async (orgId) => {
    if (!orgId) return;
    try {
      await markOverduePendingReports(orgId);
    } catch (err) {
      console.error("Overdue scan failed:", err);
    }
    const list = await getReportsForOrg(orgId);
    setReports(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        if (cancelled || !userDoc) return;
        setUserData(userDoc);
        if (userDoc.organizationId) {
          const org = await getOrganizationById(userDoc.organizationId);
          if (cancelled) return;
          setOrganizationData(org);
          await loadReports(userDoc.organizationId);
        }
      } catch (err) {
        console.error("Error loading reports page:", err);
        setError("Failed to load reports.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadReports]);

  const grouped = useMemo(() => {
    const byProposal = new Map();
    for (const r of reports) {
      if (!byProposal.has(r.proposalId)) {
        byProposal.set(r.proposalId, {
          proposalId: r.proposalId,
          proposalTitle: r.proposalTitle || "(untitled proposal)",
          items: [],
        });
      }
      byProposal.get(r.proposalId).items.push(r);
    }
    return Array.from(byProposal.values());
  }, [reports]);

  const handleUpload = async (report, file) => {
    if (!file) return;
    setError("");
    setUploadingId(report.id);
    try {
      const user = auth.currentUser;
      await submitReport(report.id, file, user.uid);
      if (userData?.organizationId) {
        await loadReports(userData.organizationId);
      }
    } catch (err) {
      console.error("Report upload failed:", err);
      setError(err.message || "Failed to upload report.");
    } finally {
      setUploadingId(null);
    }
  };

  const organizationName = organizationData?.name || "Organization";
  const role = userData?.role || "";
  const userRole = userData?.userRole || "";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="reports-page">
      <Navbar
        organizationName={organizationName}
        role={role}
        userRole={userRole}
        userName={userName}
      />
      <DashboardLayout currentPage="reports" orgType={orgTypeProp}>
        <div className="reports-page-content">
          <div className="reports-page-header">
            <h1 className="reports-page-title">Reports</h1>
            <p className="reports-page-subtitle">
              Post-activity reports owed for your approved proposals. Submit
              before the due date to avoid being marked late.
            </p>
          </div>

          {error && <div className="reports-error">{error}</div>}

          {loading ? (
            <div className="reports-empty">Loading…</div>
          ) : grouped.length === 0 ? (
            <div className="reports-empty">
              No report obligations yet. Reports appear here once your activity
              proposal is fully approved and distributed.
            </div>
          ) : (
            <div className="reports-groups">
              {grouped.map((group) => (
                <section key={group.proposalId} className="reports-group">
                  <h2 className="reports-group-title">{group.proposalTitle}</h2>
                  <div className="reports-table">
                    <div className="reports-table-head">
                      <div>Report Type</div>
                      <div>Due</div>
                      <div>Status</div>
                      <div>File</div>
                      <div>Action</div>
                    </div>
                    {group.items.map((r) => {
                      const isUploading = uploadingId === r.id;
                      const isTerminal = r.status === REPORT_STATUS.REVIEWED;
                      const canUpload = !isTerminal && !isUploading;
                      return (
                        <div key={r.id} className="reports-table-row">
                          <div>
                            <div className="report-type-label">
                              {REPORT_TYPE_LABELS[r.reportType] || r.reportType}
                            </div>
                            <div className="report-type-desc">
                              {REPORT_TYPE_DESCRIPTIONS[r.reportType] || ""}
                            </div>
                          </div>
                          <div>{formatDate(r.dueDate)}</div>
                          <div>
                            <span className={statusBadgeClass(r.status)}>
                              {REPORT_STATUS_LABELS[r.status] || r.status}
                            </span>
                            {r.reviewRemarks && r.status === REPORT_STATUS.NEEDS_REVISION && (
                              <div className="report-remarks">
                                {r.reviewRemarks}
                              </div>
                            )}
                          </div>
                          <div>
                            {r.file?.fileUrl ? (
                              <a
                                className="report-file-link"
                                href={r.file.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {r.file.fileName}
                              </a>
                            ) : (
                              <span className="report-no-file">—</span>
                            )}
                          </div>
                          <div>
                            {canUpload ? (
                              <>
                                <input
                                  type="file"
                                  id={`report-upload-${r.id}`}
                                  className="file-input-hidden"
                                  accept={ALLOWED_EXT}
                                  onChange={(e) =>
                                    handleUpload(r, e.target.files[0])
                                  }
                                />
                                <label
                                  htmlFor={`report-upload-${r.id}`}
                                  className="report-upload-btn"
                                >
                                  {r.file?.fileUrl ? "Replace" : "Upload"}
                                </label>
                              </>
                            ) : isUploading ? (
                              <span className="report-uploading">Uploading…</span>
                            ) : (
                              <span className="report-no-file">Reviewed</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    </div>
  );
};

export default ReportsPage;
