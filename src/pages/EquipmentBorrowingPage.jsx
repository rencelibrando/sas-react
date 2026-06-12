import { useState, useEffect, useMemo } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import { getDocumentStatusHistory } from "../services/documentService";
import {
  listRequestsForOrganization,
  getRequestById,
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  EQUIPMENT_REQUEST_STATUS,
} from "../services/equipmentRequestService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import LoadingScreen from "../components/LoadingScreen";
import EquipmentRequestForm from "../components/equipment/EquipmentRequestForm";
import { getEquipmentRequestPdfUrl } from "../services/equipmentPdfService";
import {
  formatDate,
  formatDateTime,
  getStatusBadgeClass,
  getStatusLabel,
} from "../utils/formatters";
import "../styles/colors.css";
import "./EquipmentBorrowingPage.css";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: EQUIPMENT_REQUEST_STATUS.PENDING, label: "Pending" },
  { value: EQUIPMENT_REQUEST_STATUS.APPROVED, label: "Approved" },
  { value: EQUIPMENT_REQUEST_STATUS.RELEASED, label: "Released" },
  { value: EQUIPMENT_REQUEST_STATUS.RETURNED, label: "Returned" },
  { value: EQUIPMENT_REQUEST_STATUS.RETURNED_FOR_REVISION, label: "Returned for Revision" },
  { value: EQUIPMENT_REQUEST_STATUS.REJECTED, label: "Rejected" },
];

const EquipmentBorrowingPage = ({ orgType: orgTypeProp = null }) => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [requests, setRequests] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedHistory, setSelectedHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadRequests = async (orgId) => {
    if (!orgId) return;
    const docs = await listRequestsForOrganization(orgId);
    setRequests(docs);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
        if (userDoc?.organizationId) {
          const orgDoc = await getOrganizationById(userDoc.organizationId);
          setOrganizationData(orgDoc);
          await loadRequests(userDoc.organizationId);
        }
      } catch (err) {
        console.error("Error loading borrowing requests:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleSubmitSuccess = async () => {
    setShowForm(false);
    setEditing(null);
    if (userData?.organizationId) {
      await loadRequests(userData.organizationId);
    }
  };

  const handleView = async (documentId) => {
    setLoadingDetail(true);
    try {
      const [req, history] = await Promise.all([
        getRequestById(documentId),
        getDocumentStatusHistory(documentId),
      ]);
      setSelectedRequest(req);
      setSelectedHistory(history);
    } catch (err) {
      console.error("Error loading request detail:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleEdit = (request) => {
    setSelectedRequest(null);
    setEditing(request);
    setShowForm(true);
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (
          !r.title?.toLowerCase().includes(q) &&
          !r.description?.toLowerCase().includes(q) &&
          !r.borrowing?.locationOfUse?.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [requests, searchTerm, statusFilter]);

  const orgName = organizationData?.name || "Organization";
  const userRole = userData?.role || "";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="home-container">
      <Navbar organizationName={orgName} role={userRole} userName={userName} />

      <DashboardLayout
        currentPage="equipment-borrowing"
        orgType={orgTypeProp ?? organizationData?.type ?? null}
      >
        {loading ? (
          <LoadingScreen compact={true} />
        ) : (
          <div className="equipment-borrowing-page">
            {organizationData?.borrowingRestricted && (
              <div className="eb-restriction-banner">
                <strong>Borrowing Restricted:</strong> Your organization has been
                restricted from submitting new equipment borrowing requests due to
                repeated late returns. Please contact the SAS office to resolve this.
              </div>
            )}
            {!organizationData?.borrowingRestricted &&
              (organizationData?.lateReturnCount || 0) > 0 && (
                <div className="eb-late-warning">
                  Your organization has{" "}
                  <strong>{organizationData.lateReturnCount}</strong> late
                  return(s) on record. Reaching {3} will result in a borrowing
                  restriction.
                </div>
              )}
            <div className="page-header">
              <h1 className="page-title">Equipment Borrowing</h1>
              <button
                className="btn-primary"
                disabled={!!organizationData?.borrowingRestricted}
                onClick={() => {
                  if (organizationData?.borrowingRestricted) return;
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                + New Borrowing Request
              </button>
            </div>

            {requests.length > 0 && (
              <div className="filters-section">
                <div className="filters-row">
                  <div className="filter-group">
                    <label className="filter-label" htmlFor="eb-search">Search</label>
                    <input
                      id="eb-search"
                      type="text"
                      className="filter-input"
                      placeholder="Search by activity, purpose, or location..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="filter-group">
                    <label className="filter-label" htmlFor="eb-status">Status</label>
                    <select
                      id="eb-status"
                      className="filter-select"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      {STATUS_FILTER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(searchTerm || statusFilter !== "all") && (
                    <button
                      className="btn-clear-filters"
                      onClick={() => {
                        setSearchTerm("");
                        setStatusFilter("all");
                      }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            )}

            {requests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <p className="empty-message">No borrowing requests yet</p>
                <p className="empty-hint">
                  Submit your first request to borrow equipment or a venue.
                </p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p className="empty-message">No requests match your filters</p>
              </div>
            ) : (
              <div className="proposals-table-container">
                <table className="proposals-table">
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Date Submitted</th>
                      <th>Borrow Date</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((r) => (
                      <tr key={r.documentId}>
                        <td className="table-title">{r.title}</td>
                        <td>{formatDate(r.dateSubmitted)}</td>
                        <td>{formatDate(r.borrowing?.dateTimeBorrowed)}</td>
                        <td>{Array.isArray(r.items) ? r.items.length : 0}</td>
                        <td>
                          <span
                            className={`status-badge ${
                              STATUS_BADGE_CLASS[r.status] || "status-badge-default"
                            }`}
                          >
                            {STATUS_LABELS[r.status] || r.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn-view"
                            onClick={() => handleView(r.documentId)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showForm && (
              <div
                className="modal-overlay"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
              >
                <div
                  className="modal-content modal-content-large"
                  onClick={(e) => e.stopPropagation()}
                >
                  <EquipmentRequestForm
                    onSuccess={handleSubmitSuccess}
                    onCancel={() => {
                      setShowForm(false);
                      setEditing(null);
                    }}
                    existing={editing}
                  />
                </div>
              </div>
            )}

            {selectedRequest && (
              <div
                className="modal-overlay"
                onClick={() => setSelectedRequest(null)}
              >
                <div
                  className="modal-content modal-content-large"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="modal-header">
                    <h3>{selectedRequest.title}</h3>
                    <button
                      className="modal-close"
                      onClick={() => setSelectedRequest(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="modal-body">
                    {loadingDetail ? (
                      <div className="loading-state">Loading…</div>
                    ) : (
                      <RequestDetailBody
                        request={selectedRequest}
                        history={selectedHistory}
                        onEdit={handleEdit}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DashboardLayout>
    </div>
  );
};

const RequestDetailBody = ({ request, history, onEdit }) => {
  const canEdit = request.status === EQUIPMENT_REQUEST_STATUS.RETURNED_FOR_REVISION;

  const handleDownloadPdf = async () => {
    try {
      const url = await getEquipmentRequestPdfUrl(request);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        alert("PDF will be available after SAS approves your request.");
      }
    } catch (err) {
      console.error("Failed to open PDF:", err);
      alert("Could not open PDF: " + (err.message || "unknown error"));
    }
  };

  return (
    <div className="er-detail">
      <div className="er-detail-section">
        <div className="info-row">
          <span className="info-label">Status:</span>
          <span
            className={`status-badge ${
              STATUS_BADGE_CLASS[request.status] || "status-badge-default"
            }`}
          >
            {STATUS_LABELS[request.status] || request.status}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Submitted:</span>
          <span className="info-value">{formatDateTime(request.dateSubmitted)}</span>
        </div>
        {request.remarks && (
          <div className="info-row-full">
            <span className="info-label">Latest remarks:</span>
            <p className="info-remarks">{request.remarks}</p>
          </div>
        )}
        {(canEdit || request.pdfPath) && (
          <div className="er-detail-actions">
            {request.pdfPath && (
              <button className="er-btn-secondary" onClick={handleDownloadPdf}>
                📄 Download Approved Form (PDF)
              </button>
            )}
            {canEdit && (
              <button className="er-btn-primary" onClick={() => onEdit(request)}>
                Edit & Resubmit
              </button>
            )}
          </div>
        )}
      </div>

      <div className="er-detail-section">
        <h4 className="er-detail-heading">Section A — Requester</h4>
        <div className="er-detail-grid">
          <DetailField label="Name" value={request.requesting?.name} />
          <DetailField label="College/Department" value={request.requesting?.collegeOrDepartment} />
          <DetailField label="Designation" value={request.requesting?.designation} />
          <DetailField label="Email" value={request.requesting?.email} />
          <DetailField label="Contact" value={request.requesting?.contactNumber} />
          <DetailField label="Adviser" value={request.requesting?.adviser} />
        </div>
      </div>

      <div className="er-detail-section">
        <h4 className="er-detail-heading">Section B — Borrowing Details</h4>
        <div className="er-detail-grid">
          <DetailField label="Activity Title" value={request.borrowing?.activityTitle} />
          <DetailField label="Location of Use" value={request.borrowing?.locationOfUse} />
          <DetailField
            label="Activity Date From"
            value={formatDate(request.borrowing?.activityDateFrom)}
          />
          <DetailField
            label="Activity Date To"
            value={formatDate(request.borrowing?.activityDateTo)}
          />
          <DetailField
            label="Date & Time of Borrowing"
            value={formatDateTime(request.borrowing?.dateTimeBorrowed)}
          />
          <DetailField
            label="Expected Return"
            value={formatDateTime(request.borrowing?.expectedDateTimeReturn)}
          />
          <DetailField label="Purpose" value={request.borrowing?.purpose} fullWidth />
        </div>
      </div>

      <div className="er-detail-section">
        <h4 className="er-detail-heading">Section C — Items</h4>
        {Array.isArray(request.items) && request.items.length > 0 ? (
          <table className="er-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Condition</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((it, i) => (
                <tr key={`${it.equipmentId}-${i}`}>
                  <td>{it.name}</td>
                  <td>{it.quantity}</td>
                  <td>{it.conditionBefore || "—"}</td>
                  <td>{it.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="er-detail-empty">No items listed.</p>
        )}
      </div>

      {(request.officeUse?.dateBorrowed || request.officeUse?.dateReturned) && (
        <div className="er-detail-section">
          <h4 className="er-detail-heading">Section F — Office Use</h4>
          <div className="er-detail-grid">
            <DetailField
              label="Date Borrowed"
              value={formatDateTime(request.officeUse?.dateBorrowed)}
            />
            <DetailField
              label="Received by (Borrower)"
              value={request.officeUse?.receivedByBorrower?.name}
            />
            <DetailField
              label="Date Returned"
              value={formatDateTime(request.officeUse?.dateReturned)}
            />
            <DetailField
              label="Received by (Office)"
              value={request.officeUse?.receivedByOfficePersonnel?.name}
            />
            {request.officeUse?.conditionUponReturn && (
              <DetailField
                label="Condition Upon Return"
                value={request.officeUse.conditionUponReturn}
                fullWidth
              />
            )}
          </div>
        </div>
      )}

      <div className="er-detail-section">
        <h4 className="er-detail-heading">Activity Log</h4>
        {history.length === 0 ? (
          <p className="er-detail-empty">No activity yet.</p>
        ) : (
          <div className="history-timeline">
            {history.map((entry, i) => (
              <div key={entry.historyId || i} className="history-item">
                <div className="history-item-dot"></div>
                <div className="history-item-content">
                  <div className="history-item-header">
                    <span
                      className={`status-badge ${getStatusBadgeClass(entry.status)}`}
                    >
                      {getStatusLabel(entry.status)}
                    </span>
                    <span className="history-item-date">
                      {formatDateTime(entry.timestamp)}
                    </span>
                  </div>
                  {entry.remarks && (
                    <p className="history-item-remarks">{entry.remarks}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const DetailField = ({ label, value, fullWidth = false }) => (
  <div className={`er-detail-field${fullWidth ? " er-detail-field-full" : ""}`}>
    <span className="er-detail-label">{label}</span>
    <span className="er-detail-value">{value || "—"}</span>
  </div>
);

export default EquipmentBorrowingPage;
