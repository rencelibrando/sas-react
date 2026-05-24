import { useState, useEffect, useMemo } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getDocumentStatusHistory } from "../services/documentService";
import {
  listRequestsForAdmin,
  getRequestById,
  approveRequest,
  returnRequestForRevision,
  rejectRequest,
  markReleased,
  markReturned,
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  EQUIPMENT_REQUEST_STATUS,
} from "../services/equipmentRequestService";
import {
  generateAndStoreEquipmentRequestPdf,
  getEquipmentRequestPdfUrl,
} from "../services/equipmentPdfService";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import {
  formatDate,
  formatDateTime,
  getStatusBadgeClass,
  getStatusLabel,
} from "../utils/formatters";
import "../styles/colors.css";
import "./AdminEquipmentRequests.css";

const TABS = [
  { id: "pending", label: "Pending", status: EQUIPMENT_REQUEST_STATUS.PENDING },
  { id: "approved", label: "Approved (Awaiting Pickup)", status: EQUIPMENT_REQUEST_STATUS.APPROVED },
  { id: "released", label: "Released (In Use)", status: EQUIPMENT_REQUEST_STATUS.RELEASED },
  { id: "returned", label: "Returned", status: EQUIPMENT_REQUEST_STATUS.RETURNED },
  { id: "revision", label: "Returned for Revision", status: EQUIPMENT_REQUEST_STATUS.RETURNED_FOR_REVISION },
  { id: "rejected", label: "Rejected", status: EQUIPMENT_REQUEST_STATUS.REJECTED },
];

const nowLocalInputValue = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const AdminEquipmentRequests = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [activeTab, setActiveTab] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Action modals
  const [modal, setModal] = useState(null); // "approve" | "return" | "reject" | "release" | "markReturned"
  const [modalForm, setModalForm] = useState({});
  const [modalError, setModalError] = useState("");
  const [modalBusy, setModalBusy] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
      } catch (err) {
        console.error("Error loading user:", err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listRequestsForAdmin()
      .then((docs) => {
        if (!cancelled) setRequests(docs);
      })
      .catch((err) => {
        console.error("Error loading admin requests:", err);
        if (!cancelled) setRequests([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const tabCounts = useMemo(() => {
    const counts = {};
    for (const t of TABS) counts[t.id] = 0;
    for (const r of requests) {
      const tab = TABS.find((t) => t.status === r.status);
      if (tab) counts[tab.id] += 1;
    }
    return counts;
  }, [requests]);

  const handleView = async (documentId) => {
    setLoadingDetail(true);
    try {
      const [req, hist] = await Promise.all([
        getRequestById(documentId),
        getDocumentStatusHistory(documentId),
      ]);
      setSelected(req);
      setHistory(hist);
    } catch (err) {
      console.error("Error loading detail:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshAfterAction = async () => {
    setRefreshKey((k) => k + 1);
    if (selected?.documentId) {
      const [req, hist] = await Promise.all([
        getRequestById(selected.documentId),
        getDocumentStatusHistory(selected.documentId),
      ]);
      setSelected(req);
      setHistory(hist);
    }
  };

  const openModal = (kind) => {
    setModalError("");
    if (kind === "approve") {
      setModalForm({
        items: selected?.items ? [...selected.items] : [],
        remarks: "",
      });
    } else if (kind === "release") {
      setModalForm({
        borrowerName: selected?.requesting?.name || "",
        dateBorrowed: nowLocalInputValue(),
      });
    } else if (kind === "markReturned") {
      setModalForm({
        officePersonnelName: userData?.fullName || "",
        dateReturned: nowLocalInputValue(),
        conditionUponReturn: "",
      });
    } else {
      setModalForm({ remarks: "" });
    }
    setModal(kind);
  };

  const closeModal = () => {
    if (modalBusy) return;
    setModal(null);
    setModalForm({});
    setModalError("");
  };

  const handleModalSubmit = async () => {
    if (!selected) return;
    const adminId = auth.currentUser?.uid;
    if (!adminId) return;
    setModalBusy(true);
    setModalError("");
    try {
      if (modal === "approve") {
        await approveRequest(selected.documentId, adminId, {
          items: modalForm.items,
          remarks: modalForm.remarks,
        });
        // Generate the PDF after approval — non-fatal if it fails.
        try {
          const refreshed = await getRequestById(selected.documentId);
          if (refreshed) {
            await generateAndStoreEquipmentRequestPdf(refreshed, adminId);
          }
        } catch (pdfErr) {
          console.error("PDF generation failed (non-fatal):", pdfErr);
        }
      } else if (modal === "return") {
        await returnRequestForRevision(selected.documentId, adminId, modalForm.remarks);
      } else if (modal === "reject") {
        await rejectRequest(selected.documentId, adminId, modalForm.remarks);
      } else if (modal === "release") {
        await markReleased(selected.documentId, adminId, {
          borrowerName: modalForm.borrowerName,
          dateBorrowed: modalForm.dateBorrowed,
        });
      } else if (modal === "markReturned") {
        await markReturned(selected.documentId, adminId, {
          officePersonnelName: modalForm.officePersonnelName,
          dateReturned: modalForm.dateReturned,
          conditionUponReturn: modalForm.conditionUponReturn,
        });
      }
      await refreshAfterAction();
      closeModal();
    } catch (err) {
      console.error("Action failed:", err);
      setModalError(err.message || "Action failed");
    } finally {
      setModalBusy(false);
    }
  };

  const updateApproveItem = (idx, patch) => {
    setModalForm((f) => {
      const items = Array.isArray(f.items) ? [...f.items] : [];
      items[idx] = { ...items[idx], ...patch };
      return { ...f, items };
    });
  };

  const removeApproveItem = (idx) => {
    setModalForm((f) => ({
      ...f,
      items: (f.items || []).filter((_, i) => i !== idx),
    }));
  };

  const filteredRequests = useMemo(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    if (!tab) return requests;
    return requests.filter((r) => r.status === tab.status);
  }, [requests, activeTab]);

  return (
    <AdminLayout userData={userData} currentPage="equipment-requests">
      <div className="admin-equipment-requests">
        <div className="aer-header">
          <div>
            <h1 className="aer-title">Equipment Requests</h1>
            <p className="aer-subtitle">Review and process equipment borrowing requests.</p>
          </div>
        </div>

        <div className="aer-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`aer-tab ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="aer-tab-label">{t.label}</span>
              {tabCounts[t.id] > 0 && (
                <span className="aer-tab-count">{tabCounts[t.id]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="aer-table-wrapper">
          {loading ? (
            <LoadingScreen compact={true} />
          ) : filteredRequests.length === 0 ? (
            <div className="aer-empty">
              <p>No requests in this tab.</p>
            </div>
          ) : (
            <table className="aer-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Requester</th>
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
                    <td className="aer-row-title">{r.title}</td>
                    <td>
                      <div>{r.submittedByName || r.requesting?.name || "—"}</div>
                      <div className="aer-row-sub">
                        {r.requesting?.collegeOrDepartment || ""}
                      </div>
                    </td>
                    <td>{formatDate(r.dateSubmitted)}</td>
                    <td>{formatDate(r.borrowing?.dateTimeBorrowed)}</td>
                    <td>{Array.isArray(r.items) ? r.items.length : 0}</td>
                    <td>
                      <span
                        className={`status-badge ${STATUS_BADGE_CLASS[r.status] || "status-badge-default"}`}
                      >
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td>
                      <button className="aer-view-btn" onClick={() => handleView(r.documentId)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="modal-overlay" onClick={() => setSelected(null)}>
            <div
              className="modal-content modal-content-large"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3>{selected.title}</h3>
                <button className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>
              <div className="modal-body">
                {loadingDetail ? (
                  <div className="loading-state">Loading…</div>
                ) : (
                  <AdminRequestDetail
                    request={selected}
                    history={history}
                    onAction={openModal}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {modal && (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="aer-action-modal" onClick={(e) => e.stopPropagation()}>
              <div className="aer-action-modal-header">
                <h3>{ACTION_TITLES[modal]}</h3>
                <button className="modal-close" onClick={closeModal}>×</button>
              </div>
              <div className="aer-action-modal-body">
                {modalError && <div className="aer-modal-error">{modalError}</div>}

                {modal === "approve" && (
                  <>
                    <p className="aer-modal-help">
                      Review and finalize the item list before approving. You can adjust quantity,
                      set the pre-borrowing condition, and remove items.
                    </p>
                    <table className="aer-items-edit-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Qty</th>
                          <th>Condition (before)</th>
                          <th>Remarks</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(modalForm.items || []).map((it, i) => (
                          <tr key={`${it.equipmentId}-${i}`}>
                            <td>{it.name}</td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={it.quantity}
                                onChange={(e) =>
                                  updateApproveItem(i, {
                                    quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={it.conditionBefore || ""}
                                onChange={(e) =>
                                  updateApproveItem(i, { conditionBefore: e.target.value })
                                }
                                maxLength={200}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={it.remarks || ""}
                                onChange={(e) =>
                                  updateApproveItem(i, { remarks: e.target.value })
                                }
                                maxLength={300}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="aer-modal-remove-btn"
                                onClick={() => removeApproveItem(i)}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <label className="aer-modal-field">
                      <span>Remarks (optional)</span>
                      <textarea
                        rows={2}
                        value={modalForm.remarks || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({ ...f, remarks: e.target.value }))
                        }
                        maxLength={1000}
                      />
                    </label>
                  </>
                )}

                {(modal === "return" || modal === "reject") && (
                  <label className="aer-modal-field">
                    <span>Reason *</span>
                    <textarea
                      rows={4}
                      value={modalForm.remarks || ""}
                      onChange={(e) =>
                        setModalForm((f) => ({ ...f, remarks: e.target.value }))
                      }
                      maxLength={1000}
                      placeholder={
                        modal === "return"
                          ? "What needs to change before resubmission?"
                          : "Why is this request being rejected?"
                      }
                    />
                  </label>
                )}

                {modal === "release" && (
                  <>
                    <label className="aer-modal-field">
                      <span>Borrower name (received by) *</span>
                      <input
                        type="text"
                        value={modalForm.borrowerName || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({ ...f, borrowerName: e.target.value }))
                        }
                        maxLength={200}
                      />
                    </label>
                    <label className="aer-modal-field">
                      <span>Date & time borrowed *</span>
                      <input
                        type="datetime-local"
                        value={modalForm.dateBorrowed || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({ ...f, dateBorrowed: e.target.value }))
                        }
                      />
                    </label>
                  </>
                )}

                {modal === "markReturned" && (
                  <>
                    <label className="aer-modal-field">
                      <span>Office personnel name (received by) *</span>
                      <input
                        type="text"
                        value={modalForm.officePersonnelName || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({ ...f, officePersonnelName: e.target.value }))
                        }
                        maxLength={200}
                      />
                    </label>
                    <label className="aer-modal-field">
                      <span>Date & time returned *</span>
                      <input
                        type="datetime-local"
                        value={modalForm.dateReturned || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({ ...f, dateReturned: e.target.value }))
                        }
                      />
                    </label>
                    <label className="aer-modal-field">
                      <span>Condition upon return</span>
                      <textarea
                        rows={3}
                        value={modalForm.conditionUponReturn || ""}
                        onChange={(e) =>
                          setModalForm((f) => ({
                            ...f,
                            conditionUponReturn: e.target.value,
                          }))
                        }
                        maxLength={1000}
                        placeholder="e.g., All items returned in good working condition. One mic cable frayed."
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="aer-action-modal-footer">
                <button
                  className="aer-btn-secondary"
                  onClick={closeModal}
                  disabled={modalBusy}
                >
                  Cancel
                </button>
                <button
                  className={`aer-btn-primary ${
                    modal === "reject" || modal === "return" ? "danger" : ""
                  }`}
                  onClick={handleModalSubmit}
                  disabled={modalBusy}
                >
                  {modalBusy ? "Saving…" : ACTION_CONFIRM[modal]}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

const ACTION_TITLES = {
  approve: "Approve Request",
  return: "Return for Revision",
  reject: "Reject Request",
  release: "Mark as Released (Pickup)",
  markReturned: "Mark as Returned",
};

const ACTION_CONFIRM = {
  approve: "Approve",
  return: "Return for Revision",
  reject: "Reject",
  release: "Confirm Release",
  markReturned: "Confirm Return",
};

const AdminRequestDetail = ({ request, history, onAction }) => {
  const status = request.status;

  const handleDownloadPdf = async () => {
    try {
      const url = await getEquipmentRequestPdfUrl(request);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        alert("PDF is not available yet — approve the request first.");
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
            className={`status-badge ${STATUS_BADGE_CLASS[status] || "status-badge-default"}`}
          >
            {STATUS_LABELS[status] || status}
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
        <div className="aer-detail-actions">
          {request.pdfPath && (
            <button className="aer-btn-secondary" onClick={handleDownloadPdf}>
              📄 Download Approved Form (PDF)
            </button>
          )}
          {status === EQUIPMENT_REQUEST_STATUS.PENDING && (
            <>
              <button className="aer-btn-primary" onClick={() => onAction("approve")}>
                Approve…
              </button>
              <button className="aer-btn-secondary" onClick={() => onAction("return")}>
                Return for Revision…
              </button>
              <button
                className="aer-btn-primary danger"
                onClick={() => onAction("reject")}
              >
                Reject…
              </button>
            </>
          )}
          {status === EQUIPMENT_REQUEST_STATUS.APPROVED && (
            <button className="aer-btn-primary" onClick={() => onAction("release")}>
              Mark as Released…
            </button>
          )}
          {status === EQUIPMENT_REQUEST_STATUS.RELEASED && (
            <button className="aer-btn-primary" onClick={() => onAction("markReturned")}>
              Mark as Returned…
            </button>
          )}
        </div>
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

export default AdminEquipmentRequests;
