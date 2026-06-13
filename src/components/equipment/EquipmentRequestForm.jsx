import { useState, useEffect, useMemo } from "react";
import { auth } from "../../config/firebase";
import { getUserById } from "../../services/userService";
import { getOrganizationById } from "../../services/organizationService";
import { getDocumentsByOrganization } from "../../services/documentService";
import {
  submitEquipmentRequest,
  resubmitRequest,
} from "../../services/equipmentRequestService";
import EquipmentItemPicker from "./EquipmentItemPicker";
import "../../styles/colors.css";
import "./EquipmentRequestForm.css";

const TERMS = [
  "The requester shall be responsible for the safekeeping and proper use of the borrowed items.",
  "Items must be returned in good condition by the agreed-upon return date and time.",
  "Any damage, loss, or malfunction shall be reported immediately and may be subject to replacement or repair costs.",
  "Borrowed items shall be used only for the stated purpose and within the approved venue.",
  "The requesting party agrees to comply with all institutional guidelines on equipment use.",
];

const toLocalInputValue = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const toDateInputValue = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const INITIAL_FORM = {
  requesting: {
    collegeOrDepartment: "",
    name: "",
    designation: "",
    contactNumber: "",
    email: "",
    adviser: "",
  },
  borrowing: {
    purpose: "",
    activityTitle: "",
    activityDateFrom: "",
    activityDateTo: "",
    locationOfUse: "",
    dateTimeBorrowed: "",
    expectedDateTimeReturn: "",
  },
  items: [],
  linkedProposalId: "",
  acknowledged: false,
};

/**
 * EquipmentRequestForm
 *
 * Props:
 *   - onSuccess: () => void
 *   - onCancel:  () => void
 *   - existing:  optional request to edit (for resubmit-after-revision flow)
 */
const EquipmentRequestForm = ({ onSuccess, onCancel, existing = null }) => {
  const [form, setForm] = useState(INITIAL_FORM);
  const [userData, setUserData] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [approvedProposals, setApprovedProposals] = useState([]);
  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isResubmit = Boolean(existing);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        if (cancelled) return;
        setUserData(userDoc);

        let orgDoc = null;
        if (userDoc?.organizationId) {
          orgDoc = await getOrganizationById(userDoc.organizationId);
          if (cancelled) return;
          setOrganization(orgDoc);

          // Approved activity proposals from the same org for optional linkage.
          try {
            const proposals = await getDocumentsByOrganization(
              userDoc.organizationId,
              {
                documentType: "activity_proposal",
                status: "approved",
              }
            );
            if (!cancelled) setApprovedProposals(proposals || []);
          } catch (err) {
            console.warn("Could not load approved proposals:", err);
          }
        }

        // Prefill from existing (resubmit) OR from user/org profile.
        if (existing) {
          setForm({
            requesting: {
              collegeOrDepartment: existing.requesting?.collegeOrDepartment || "",
              name: existing.requesting?.name || "",
              designation: existing.requesting?.designation || "",
              contactNumber: existing.requesting?.contactNumber || "",
              email: existing.requesting?.email || "",
              adviser: existing.requesting?.adviser || "",
            },
            borrowing: {
              purpose: existing.borrowing?.purpose || "",
              activityTitle: existing.borrowing?.activityTitle || "",
              activityDateFrom: toDateInputValue(existing.borrowing?.activityDateFrom),
              activityDateTo: toDateInputValue(existing.borrowing?.activityDateTo),
              locationOfUse: existing.borrowing?.locationOfUse || "",
              dateTimeBorrowed: toLocalInputValue(existing.borrowing?.dateTimeBorrowed),
              expectedDateTimeReturn: toLocalInputValue(
                existing.borrowing?.expectedDateTimeReturn
              ),
            },
            items: Array.isArray(existing.items) ? existing.items : [],
            linkedProposalId: existing.linkedProposalId || "",
            acknowledged: false,
          });
        } else if (userDoc) {
          setForm((prev) => ({
            ...prev,
            requesting: {
              ...prev.requesting,
              collegeOrDepartment: orgDoc?.name || "",
              name: userDoc.fullName || "",
              designation: userDoc.userRole || "",
              email: userDoc.email || "",
            },
          }));
        }
      } catch (err) {
        console.error("Error initializing form:", err);
      } finally {
        if (!cancelled) setLoadingPrefill(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [existing]);

  const proposalsById = useMemo(() => {
    const m = new Map();
    for (const p of approvedProposals) m.set(p.documentId, p);
    return m;
  }, [approvedProposals]);

  const setReq = (field, val) =>
    setForm((f) => ({ ...f, requesting: { ...f.requesting, [field]: val } }));
  const setBor = (field, val) =>
    setForm((f) => ({ ...f, borrowing: { ...f.borrowing, [field]: val } }));

  // Combine a date-only value (YYYY-MM-DD) with a time, preserving the
  // time-of-day the user may have already chosen on the datetime field.
  const combineDateWithTime = (dateStr, existingDateTime, defaultTime) => {
    if (!dateStr) return existingDateTime;
    const timePart =
      existingDateTime && existingDateTime.includes("T")
        ? existingDateTime.split("T")[1]
        : defaultTime;
    return `${dateStr}T${timePart}`;
  };

  // When both activity dates are present, mirror them onto the borrowing
  // schedule (from → borrow, to → return). Times default to 08:00 / 17:00 but
  // any time the user already set is kept.
  const handleActivityDate = (field, val) =>
    setForm((f) => {
      const borrowing = { ...f.borrowing, [field]: val };
      const from = field === "activityDateFrom" ? val : f.borrowing.activityDateFrom;
      const to = field === "activityDateTo" ? val : f.borrowing.activityDateTo;
      if (from && to) {
        borrowing.dateTimeBorrowed = combineDateWithTime(
          from,
          f.borrowing.dateTimeBorrowed,
          "08:00"
        );
        borrowing.expectedDateTimeReturn = combineDateWithTime(
          to,
          f.borrowing.expectedDateTimeReturn,
          "17:00"
        );
      }
      return { ...f, borrowing };
    });

  const handleProposalLink = (proposalId) => {
    setForm((f) => ({ ...f, linkedProposalId: proposalId }));
    if (!proposalId) return;
    const p = proposalsById.get(proposalId);
    if (!p) return;
    setForm((f) => ({
      ...f,
      borrowing: {
        ...f.borrowing,
        activityTitle: f.borrowing.activityTitle || p.title || "",
        purpose: f.borrowing.purpose || p.description || "",
      },
    }));
  };

  const validate = () => {
    if (!form.requesting.name.trim()) return "Requester name is required";
    if (!form.requesting.email.trim()) return "Requester email is required";
    if (!form.borrowing.activityTitle.trim()) return "Activity title is required";
    if (!form.borrowing.purpose.trim()) return "Purpose is required";
    if (!form.borrowing.locationOfUse.trim()) return "Location of use is required";
    if (!form.borrowing.dateTimeBorrowed) return "Date & time of borrowing is required";
    if (!form.borrowing.expectedDateTimeReturn) return "Expected return date & time is required";
    const borrowMs = new Date(form.borrowing.dateTimeBorrowed).getTime();
    const returnMs = new Date(form.borrowing.expectedDateTimeReturn).getTime();
    if (Number.isFinite(borrowMs) && Number.isFinite(returnMs) && returnMs <= borrowMs) {
      return "Expected return must be after the borrow time";
    }
    if (!Array.isArray(form.items) || form.items.length === 0) {
      return "Add at least one item to borrow";
    }
    if (!form.acknowledged) return "You must acknowledge the terms & conditions";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const user = auth.currentUser;
    if (!user || !userData?.organizationId) {
      setError("Session expired. Please refresh and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        requesting: form.requesting,
        borrowing: {
          ...form.borrowing,
          activityDateFrom: form.borrowing.activityDateFrom || null,
          activityDateTo: form.borrowing.activityDateTo || null,
        },
        items: form.items,
        linkedProposalId: form.linkedProposalId || null,
      };

      if (isResubmit) {
        await resubmitRequest(existing.documentId, user.uid, payload);
      } else {
        await submitEquipmentRequest({
          ...payload,
          userId: user.uid,
          organizationId: userData.organizationId,
          submitterRole: userData.role || null,
          submittedByName: userData.fullName || "",
        });
      }
      onSuccess?.();
    } catch (err) {
      console.error("Equipment request submission failed:", err);
      setError(err.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingPrefill) {
    return <div className="er-form-loading">Loading…</div>;
  }

  return (
    <form className="equipment-request-form" onSubmit={handleSubmit}>
      <div className="er-form-header">
        <h2 className="er-form-title">
          {isResubmit ? "Edit & Resubmit Borrowing Request" : "Equipment Borrowing Request"}
        </h2>
        {!isResubmit && (
          <p className="er-form-subtitle">
            Fill out the form below to request equipment or a venue.
          </p>
        )}
      </div>

      {error && <div className="er-form-error">{error}</div>}

      {existing?.remarks && existing.status === "returned_for_revision" && (
        <div className="er-form-revision-note">
          <strong>SAS feedback:</strong> {existing.remarks}
        </div>
      )}

      {/* Section A — Requesting Party Information */}
      <section className="er-section">
        <h3 className="er-section-title">Section A: Requesting Party Information</h3>
        <div className="er-form-grid">
          <div className="er-field">
            <label>College/Department/Office</label>
            <input
              type="text"
              value={form.requesting.collegeOrDepartment}
              onChange={(e) => setReq("collegeOrDepartment", e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="er-field">
            <label>Name *</label>
            <input
              type="text"
              value={form.requesting.name}
              onChange={(e) => setReq("name", e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="er-field">
            <label>Designation / Position</label>
            <input
              type="text"
              value={form.requesting.designation}
              onChange={(e) => setReq("designation", e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="er-field">
            <label>Contact Number</label>
            <input
              type="text"
              value={form.requesting.contactNumber}
              onChange={(e) => setReq("contactNumber", e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="er-field">
            <label>Email Address *</label>
            <input
              type="email"
              value={form.requesting.email}
              onChange={(e) => setReq("email", e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="er-field">
            <label>Adviser / Supervisor</label>
            <input
              type="text"
              value={form.requesting.adviser}
              onChange={(e) => setReq("adviser", e.target.value)}
              maxLength={200}
            />
          </div>
        </div>
      </section>

      {/* Optional linkage */}
      {approvedProposals.length > 0 && (
        <section className="er-section">
          <h3 className="er-section-title">Link to Activity Proposal (optional)</h3>
          <p className="er-section-help">
            Linking an approved activity proposal will pre-fill the activity title and purpose.
          </p>
          <select
            className="er-select"
            value={form.linkedProposalId}
            onChange={(e) => handleProposalLink(e.target.value)}
          >
            <option value="">— No linked proposal —</option>
            {approvedProposals.map((p) => (
              <option key={p.documentId} value={p.documentId}>
                {p.title}
              </option>
            ))}
          </select>
        </section>
      )}

      {/* Section B — Borrowing Details */}
      <section className="er-section">
        <h3 className="er-section-title">Section B: Borrowing Details</h3>
        <div className="er-form-grid">
          <div className="er-field er-field-full">
            <label>Activity Title *</label>
            <input
              type="text"
              value={form.borrowing.activityTitle}
              onChange={(e) => setBor("activityTitle", e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="er-field er-field-full">
            <label>Purpose *</label>
            <textarea
              rows={3}
              value={form.borrowing.purpose}
              onChange={(e) => setBor("purpose", e.target.value)}
              required
              maxLength={1000}
            />
          </div>
          <div className="er-field">
            <label>Activity Date — From</label>
            <input
              type="date"
              value={form.borrowing.activityDateFrom}
              onChange={(e) => handleActivityDate("activityDateFrom", e.target.value)}
            />
          </div>
          <div className="er-field">
            <label>Activity Date — To</label>
            <input
              type="date"
              value={form.borrowing.activityDateTo}
              onChange={(e) => handleActivityDate("activityDateTo", e.target.value)}
            />
          </div>
          <div className="er-field er-field-full">
            <label>Location of Use *</label>
            <input
              type="text"
              value={form.borrowing.locationOfUse}
              onChange={(e) => setBor("locationOfUse", e.target.value)}
              required
              maxLength={300}
            />
          </div>
          <div className="er-field">
            <label>Date & Time of Borrowing *</label>
            <input
              type="datetime-local"
              value={form.borrowing.dateTimeBorrowed}
              onChange={(e) => setBor("dateTimeBorrowed", e.target.value)}
              required
            />
          </div>
          <div className="er-field">
            <label>Expected Date & Time of Return *</label>
            <input
              type="datetime-local"
              value={form.borrowing.expectedDateTimeReturn}
              onChange={(e) => setBor("expectedDateTimeReturn", e.target.value)}
              required
            />
          </div>
        </div>
      </section>

      {/* Section C — Items */}
      <section className="er-section">
        <h3 className="er-section-title">Section C: Items to Borrow</h3>
        <p className="er-section-help">
          Pick from the active equipment catalog. SAS will finalize the
          authorized list during review.
        </p>
        <EquipmentItemPicker
          value={form.items}
          onChange={(items) => setForm((f) => ({ ...f, items }))}
        />
      </section>

      {/* Section D — Terms */}
      <section className="er-section">
        <h3 className="er-section-title">Section D: Terms & Conditions</h3>
        <ol className="er-terms-list">
          {TERMS.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
        <label className="er-acknowledge">
          <input
            type="checkbox"
            checked={form.acknowledged}
            onChange={(e) =>
              setForm((f) => ({ ...f, acknowledged: e.target.checked }))
            }
          />
          <span>
            I hereby acknowledge that I am responsible for the borrowed items
            and shall ensure their proper use and timely return in good
            condition. I agree to be held accountable for any loss or damage.
          </span>
        </label>
      </section>

      <div className="er-form-actions">
        <button
          type="button"
          className="er-btn-secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button type="submit" className="er-btn-primary" disabled={submitting}>
          {submitting
            ? "Submitting…"
            : isResubmit
              ? "Resubmit Request"
              : "Submit Request"}
        </button>
      </div>

      <div className="er-organization-note">
        Submitting as <strong>{organization?.name || "your organization"}</strong>
      </div>
    </form>
  );
};

export default EquipmentRequestForm;
