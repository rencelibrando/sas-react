import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  increment,
  updateDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import {
  notifyOrganization,
  notifyAdmins,
  NOTIFICATION_TYPES,
} from "./notificationService";
import { adjustEquipmentQuantityOnHand } from "./equipmentService";
import { limit as queryLimit } from "firebase/firestore";

/**
 * Equipment Request Service
 *
 * Borrowing requests are stored alongside other documents in the `documents`
 * collection with `documentType: "equipment_request"`. This keeps status history,
 * file storage paths, and querying consistent with activity proposals.
 *
 * Lifecycle (status field):
 *   pending → approved → released → returned
 *   pending → returned_for_revision (requester resubmits → pending again)
 *   pending | approved → rejected
 *
 * Pipeline tracking lives on `pipeline.currentStage` and a `pipeline.stages[]`
 * array mirroring activity proposals, but with simpler stage keys:
 *   sas_review → approved → released → returned
 */

const COLLECTION = "documents";

// Number of late returns that triggers a borrowing restriction on the org.
const LATE_RETURN_THRESHOLD = 3;

const PIPELINE_STAGES = {
  SAS_REVIEW: "sas_review",
  PICKUP: "pickup",
  RETURN: "return",
  CLOSED: "closed",
};

const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  RELEASED: "released",
  RETURNED: "returned",
  RETURNED_FOR_REVISION: "returned_for_revision",
  REJECTED: "rejected",
};

const sanitizeText = (s, max = 500) => {
  const v = (s || "").toString().trim();
  return v.length > max ? v.slice(0, max) : v;
};

const sanitizeItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && it.equipmentId && Number(it.quantity) > 0)
    .map((it) => ({
      equipmentId: it.equipmentId,
      name: sanitizeText(it.name, 200),
      quantity: Math.floor(Number(it.quantity)),
      conditionBefore: sanitizeText(it.conditionBefore || "", 200),
      remarks: sanitizeText(it.remarks || "", 500),
    }));
};

const dateOrNull = (raw) => {
  if (!raw) return null;
  if (raw instanceof Timestamp) return raw;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
};

/**
 * Check availability of equipment items for a given date range.
 * Queries all APPROVED and RELEASED requests, finds those whose borrow periods
 * overlap with [dtFrom, dtTo], and sums committed quantities.
 * Returns an array of conflict objects for items that can't be satisfied.
 */
const checkEquipmentAvailability = async (items, dtFrom, dtTo) => {
  if (!items?.length || !dtFrom || !dtTo) return [];
  const fromMs = dtFrom.toMillis ? dtFrom.toMillis() : dtFrom.getTime();
  const toMs = dtTo.toMillis ? dtTo.toMillis() : dtTo.getTime();

  let allDocs = [];
  try {
    const [approvedSnap, releasedSnap] = await Promise.all([
      getDocs(query(collection(db, COLLECTION),
        where("documentType", "==", "equipment_request"),
        where("status", "==", STATUS.APPROVED)
      )),
      getDocs(query(collection(db, COLLECTION),
        where("documentType", "==", "equipment_request"),
        where("status", "==", STATUS.RELEASED)
      )),
    ]);
    allDocs = [...approvedSnap.docs, ...releasedSnap.docs];
  } catch (err) {
    console.warn("Availability check query failed (non-blocking):", err);
    return [];
  }

  // Sum committed quantities for overlapping requests
  const committed = {};
  for (const d of allDocs) {
    const data = d.data();
    const reqFromMs = data.borrowing?.dateTimeBorrowed?.toMillis?.() ?? 0;
    const reqToMs = data.borrowing?.expectedDateTimeReturn?.toMillis?.() ?? Infinity;
    if (reqFromMs < toMs && reqToMs > fromMs) {
      for (const item of (data.items || [])) {
        committed[item.equipmentId] = (committed[item.equipmentId] || 0) + (item.quantity || 0);
      }
    }
  }

  // Fetch each item's totalQuantity and check availability
  const conflicts = [];
  for (const item of items) {
    if (!item.equipmentId) continue;
    const equipSnap = await getDoc(doc(db, "equipment", item.equipmentId));
    if (!equipSnap.exists()) continue;
    const totalQty = equipSnap.data().totalQuantity || 0;
    const alreadyCommitted = committed[item.equipmentId] || 0;
    const available = totalQty - alreadyCommitted;
    if (item.quantity > available) {
      conflicts.push({
        name: item.name || equipSnap.data().name,
        requested: item.quantity,
        available: Math.max(0, available),
        alreadyCommitted,
      });
    }
  }
  return conflicts;
};

/**
 * Submit a new borrowing request.
 *
 * @param {Object} args
 * @param {Object} args.requesting           Section A fields
 * @param {Object} args.borrowing            Section B fields
 * @param {Array}  args.items                Section C wishlist
 * @param {string} [args.linkedProposalId]   Optional Activity Proposal link
 * @param {string} args.userId               Submitting user uid
 * @param {string} args.organizationId
 * @param {string} [args.submitterRole]
 * @param {string} [args.submittedByName]
 */
export const submitEquipmentRequest = async ({
  requesting,
  borrowing,
  items,
  linkedProposalId = null,
  userId,
  organizationId,
  submitterRole = null,
  submittedByName = "",
}) => {
  if (!userId) throw new Error("Not signed in");
  if (!organizationId) throw new Error("Organization not found");

  // Block restricted organizations from submitting new requests
  const orgSnap = await getDoc(doc(db, "organizations", organizationId));
  if (orgSnap.exists() && orgSnap.data().borrowingRestricted) {
    throw new Error(
      "Your organization is currently restricted from submitting new borrowing requests due to repeated late equipment returns. Please contact the SAS office."
    );
  }

  const safeItems = sanitizeItems(items);
  if (safeItems.length === 0) throw new Error("Select at least one item to borrow");

  if (!requesting?.name?.trim()) throw new Error("Requester name is required");
  if (!requesting?.email?.trim()) throw new Error("Requester email is required");
  if (!borrowing?.purpose?.trim()) throw new Error("Purpose is required");
  if (!borrowing?.activityTitle?.trim()) throw new Error("Activity title is required");
  if (!borrowing?.locationOfUse?.trim()) throw new Error("Location of use is required");

  const dtBorrowed = dateOrNull(borrowing?.dateTimeBorrowed);
  const dtReturn = dateOrNull(borrowing?.expectedDateTimeReturn);
  if (!dtBorrowed) throw new Error("Date & time of borrowing is required");
  if (!dtReturn) throw new Error("Expected return date & time is required");
  if (dtReturn.toMillis() <= dtBorrowed.toMillis()) {
    throw new Error("Expected return must be after borrow time");
  }

  const docRef = doc(collection(db, COLLECTION));
  const documentId = docRef.id;

  const batch = writeBatch(db);

  batch.set(docRef, {
    documentId,
    documentNumber: null,
    organizationId,
    submittedBy: userId,
    submittedByName: submittedByName || requesting.name.trim(),
    submitterRole: submitterRole || null,
    documentType: "equipment_request",
    direction: "incoming",
    title: borrowing.activityTitle.trim(),
    description: borrowing.purpose.trim(),

    requesting: {
      collegeOrDepartment: sanitizeText(requesting.collegeOrDepartment, 200),
      name: sanitizeText(requesting.name, 200),
      designation: sanitizeText(requesting.designation, 200),
      contactNumber: sanitizeText(requesting.contactNumber, 50),
      email: sanitizeText(requesting.email, 200),
      adviser: sanitizeText(requesting.adviser, 200),
    },
    borrowing: {
      purpose: sanitizeText(borrowing.purpose, 1000),
      activityTitle: sanitizeText(borrowing.activityTitle, 200),
      activityDateFrom: dateOrNull(borrowing.activityDateFrom),
      activityDateTo: dateOrNull(borrowing.activityDateTo),
      locationOfUse: sanitizeText(borrowing.locationOfUse, 300),
      dateTimeBorrowed: dtBorrowed,
      expectedDateTimeReturn: dtReturn,
    },
    items: safeItems,
    linkedProposalId: linkedProposalId || null,

    officeUse: {
      dateBorrowed: null,
      dateReturned: null,
      receivedByBorrower: null,
      receivedByOfficePersonnel: null,
      conditionUponReturn: "",
    },
    pdfPath: null,
    pdfFileName: null,

    status: STATUS.PENDING,
    remarks: "",
    pipeline: {
      currentStage: PIPELINE_STAGES.SAS_REVIEW,
      stages: [],
    },

    dateSubmitted: serverTimestamp(),
    dateReviewed: null,
    dateReleased: null,
    lastUpdated: serverTimestamp(),
    createdBy: userId,
    updatedBy: userId,
  });

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.PENDING,
    previousStatus: null,
    changedBy: userId,
    remarks: "Equipment borrowing request submitted",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  return { documentId, status: STATUS.PENDING };
};

/**
 * List a user's borrowing requests (org-scoped).
 */
export const listRequestsForOrganization = async (organizationId) => {
  if (!organizationId) return [];
  const q = query(
    collection(db, COLLECTION),
    where("organizationId", "==", organizationId),
    where("documentType", "==", "equipment_request"),
    orderBy("dateSubmitted", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ documentId: d.id, ...d.data() }));
};

/**
 * List all borrowing requests (admin), optionally filtered by status.
 */
export const listRequestsForAdmin = async ({ status = null } = {}) => {
  let q;
  if (status) {
    q = query(
      collection(db, COLLECTION),
      where("documentType", "==", "equipment_request"),
      where("status", "==", status),
      orderBy("dateSubmitted", "desc")
    );
  } else {
    q = query(
      collection(db, COLLECTION),
      where("documentType", "==", "equipment_request"),
      orderBy("dateSubmitted", "desc")
    );
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ documentId: d.id, ...d.data() }));
};

export const getRequestById = async (documentId) => {
  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.documentType !== "equipment_request") return null;
  return { documentId: snap.id, ...data };
};

const requireStatus = (data, expected, action) => {
  if (data.status !== expected) {
    throw new Error(
      `Cannot ${action} — request is "${data.status}", expected "${expected}"`
    );
  }
};

const appendStage = (data, entry) => {
  const stages = Array.isArray(data.pipeline?.stages) ? [...data.pipeline.stages] : [];
  stages.push(entry);
  return stages;
};

/**
 * Admin approves a pending request. The admin may optionally edit the items
 * list before approving (e.g. finalize quantity, set condition-before).
 * Runs a date-range overlap check and deducts quantityOnHand at approval.
 */
export const approveRequest = async (documentId, adminId, { items, remarks = "" } = {}) => {
  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  requireStatus(data, STATUS.PENDING, "approve");

  const finalItems = Array.isArray(items) ? sanitizeItems(items) : data.items;
  if (!finalItems?.length) throw new Error("No items to approve");

  // Date-range overlap check: ensure sufficient quantity is available for the borrow period
  const dtFrom = data.borrowing?.dateTimeBorrowed;
  const dtTo = data.borrowing?.expectedDateTimeReturn;
  if (dtFrom && dtTo) {
    const conflicts = await checkEquipmentAvailability(finalItems, dtFrom, dtTo);
    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) =>
          `${c.name}: need ${c.requested}, only ${c.available} available (${c.alreadyCommitted} already committed for overlapping dates)`
        )
        .join("; ");
      throw new Error(`Cannot approve — insufficient equipment for the requested dates: ${details}`);
    }
  }

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: PIPELINE_STAGES.SAS_REVIEW,
    action: "approved",
    completedAt: now,
    completedBy: adminId,
    remarks: sanitizeText(remarks, 1000),
  };

  const patch = {
    status: STATUS.APPROVED,
    items: finalItems,
    remarks: sanitizeText(remarks, 1000),
    "pipeline.currentStage": PIPELINE_STAGES.PICKUP,
    "pipeline.stages": appendStage(data, stageEntry),
    dateReviewed: serverTimestamp(),
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
    reservationDeducted: true,
  };

  const batch = writeBatch(db);
  batch.update(ref, patch);

  // Deduct reserved quantities from inventory at approval time
  for (const item of finalItems) {
    adjustEquipmentQuantityOnHand(batch, item.equipmentId, -Math.abs(item.quantity || 0), adminId);
  }

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.APPROVED,
    previousStatus: data.status,
    changedBy: adminId,
    remarks: remarks ? `Approved — ${remarks}` : "Approved",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  if (data.organizationId) {
    notifyOrganization(data.organizationId, {
      type: NOTIFICATION_TYPES.EQUIPMENT_REQUEST_APPROVED,
      title: `Equipment request approved: ${data.title || "Borrowing"}`,
      message: `Your equipment borrowing request for "${data.title || "your activity"}" has been approved. You may proceed with pickup at the SAS office.${
        remarks ? ` Admin remarks: ${remarks}` : ""
      }`,
      link: "equipment-borrowing",
      sourceCollection: COLLECTION,
      sourceId: documentId,
      alsoEmail: true,
    }).catch((err) =>
      console.warn("equipment approval notification failed:", err?.message || err)
    );
  }
};

/**
 * Admin returns a pending request to the requester for revision.
 */
export const returnRequestForRevision = async (documentId, adminId, remarks) => {
  const trimmed = sanitizeText(remarks, 1000);
  if (!trimmed) throw new Error("A reason is required when returning a request");

  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  requireStatus(data, STATUS.PENDING, "return for revision");

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: PIPELINE_STAGES.SAS_REVIEW,
    action: "returned",
    completedAt: now,
    completedBy: adminId,
    remarks: trimmed,
  };

  const batch = writeBatch(db);
  batch.update(ref, {
    status: STATUS.RETURNED_FOR_REVISION,
    remarks: trimmed,
    "pipeline.currentStage": null,
    "pipeline.stages": appendStage(data, stageEntry),
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.RETURNED_FOR_REVISION,
    previousStatus: data.status,
    changedBy: adminId,
    remarks: `Returned for revision — ${trimmed}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  if (data.organizationId) {
    notifyOrganization(data.organizationId, {
      type: NOTIFICATION_TYPES.EQUIPMENT_REQUEST_RETURNED,
      title: `Equipment request needs revision: ${data.title || "Borrowing"}`,
      message: `Your equipment borrowing request for "${data.title || "your activity"}" was returned for revision. Reviewer remarks: ${trimmed}`,
      link: "equipment-borrowing",
      sourceCollection: COLLECTION,
      sourceId: documentId,
      alsoEmail: true,
    }).catch((err) =>
      console.warn("equipment return notification failed:", err?.message || err)
    );
  }
};

/**
 * Admin rejects a request outright (cannot be resubmitted).
 */
export const rejectRequest = async (documentId, adminId, remarks) => {
  const trimmed = sanitizeText(remarks, 1000);
  if (!trimmed) throw new Error("A reason is required when rejecting a request");

  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  if (data.status === STATUS.RELEASED || data.status === STATUS.RETURNED) {
    throw new Error(`Cannot reject — request is already ${data.status}`);
  }

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: data.pipeline?.currentStage || PIPELINE_STAGES.SAS_REVIEW,
    action: "rejected",
    completedAt: now,
    completedBy: adminId,
    remarks: trimmed,
  };

  const batch = writeBatch(db);
  batch.update(ref, {
    status: STATUS.REJECTED,
    remarks: trimmed,
    "pipeline.currentStage": null,
    "pipeline.stages": appendStage(data, stageEntry),
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  // Restore reserved quantities if the request was already approved (quantities were deducted at approval)
  if (data.status === STATUS.APPROVED && Array.isArray(data.items)) {
    for (const item of data.items) {
      adjustEquipmentQuantityOnHand(batch, item.equipmentId, Math.abs(item.quantity || 0), adminId);
    }
  }

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.REJECTED,
    previousStatus: data.status,
    changedBy: adminId,
    remarks: `Rejected — ${trimmed}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  if (data.organizationId) {
    notifyOrganization(data.organizationId, {
      type: NOTIFICATION_TYPES.EQUIPMENT_REQUEST_REJECTED,
      title: `Equipment request rejected: ${data.title || "Borrowing"}`,
      message: `Your equipment borrowing request for "${data.title || "your activity"}" was rejected. Reason: ${trimmed}`,
      link: "equipment-borrowing",
      sourceCollection: COLLECTION,
      sourceId: documentId,
      alsoEmail: true,
    }).catch((err) =>
      console.warn("equipment rejection notification failed:", err?.message || err)
    );
  }
};

/**
 * Resubmit a returned-for-revision request after editing.
 * @param {Object} updates  Fields the requester may revise: requesting, borrowing, items.
 */
export const resubmitRequest = async (documentId, userId, updates = {}) => {
  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  requireStatus(data, STATUS.RETURNED_FOR_REVISION, "resubmit");
  if (data.submittedBy !== userId) {
    throw new Error("Only the original requester may resubmit this request");
  }

  const patch = {
    status: STATUS.PENDING,
    "pipeline.currentStage": PIPELINE_STAGES.SAS_REVIEW,
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  };

  if (updates.requesting) {
    patch.requesting = {
      collegeOrDepartment: sanitizeText(updates.requesting.collegeOrDepartment, 200),
      name: sanitizeText(updates.requesting.name, 200),
      designation: sanitizeText(updates.requesting.designation, 200),
      contactNumber: sanitizeText(updates.requesting.contactNumber, 50),
      email: sanitizeText(updates.requesting.email, 200),
      adviser: sanitizeText(updates.requesting.adviser, 200),
    };
  }
  if (updates.borrowing) {
    patch.borrowing = {
      purpose: sanitizeText(updates.borrowing.purpose, 1000),
      activityTitle: sanitizeText(updates.borrowing.activityTitle, 200),
      activityDateFrom: dateOrNull(updates.borrowing.activityDateFrom),
      activityDateTo: dateOrNull(updates.borrowing.activityDateTo),
      locationOfUse: sanitizeText(updates.borrowing.locationOfUse, 300),
      dateTimeBorrowed: dateOrNull(updates.borrowing.dateTimeBorrowed),
      expectedDateTimeReturn: dateOrNull(updates.borrowing.expectedDateTimeReturn),
    };
    if (patch.borrowing.activityTitle) patch.title = patch.borrowing.activityTitle;
    if (patch.borrowing.purpose) patch.description = patch.borrowing.purpose;
  }
  if (Array.isArray(updates.items)) {
    patch.items = sanitizeItems(updates.items);
    if (patch.items.length === 0) throw new Error("Select at least one item to borrow");
  }

  const batch = writeBatch(db);
  batch.update(ref, patch);

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.PENDING,
    previousStatus: data.status,
    changedBy: userId,
    remarks: "Resubmitted after revision",
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * Admin records physical pickup — captures Section F top half.
 */
export const markReleased = async (
  documentId,
  adminId,
  { borrowerName, dateBorrowed }
) => {
  const name = sanitizeText(borrowerName, 200);
  if (!name) throw new Error("Borrower name is required");
  const ts = dateOrNull(dateBorrowed) || Timestamp.fromDate(new Date());

  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  requireStatus(data, STATUS.APPROVED, "release");

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: PIPELINE_STAGES.PICKUP,
    action: "released",
    completedAt: now,
    completedBy: adminId,
  };

  const batch = writeBatch(db);
  batch.update(ref, {
    status: STATUS.RELEASED,
    "officeUse.dateBorrowed": ts,
    "officeUse.receivedByBorrower": { name, signedAt: ts },
    "pipeline.currentStage": PIPELINE_STAGES.RETURN,
    "pipeline.stages": appendStage(data, stageEntry),
    dateReleased: serverTimestamp(),
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  // Quantity was already deducted at approval — no inventory change needed here.

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.RELEASED,
    previousStatus: data.status,
    changedBy: adminId,
    remarks: `Released to ${name} for pickup`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * Admin records physical return — captures Section F bottom half.
 */
export const markReturned = async (
  documentId,
  adminId,
  { officePersonnelName, dateReturned, conditionUponReturn = "" }
) => {
  const name = sanitizeText(officePersonnelName, 200);
  if (!name) throw new Error("Office personnel name is required");
  const ts = dateOrNull(dateReturned) || Timestamp.fromDate(new Date());
  const condition = sanitizeText(conditionUponReturn, 1000);

  const ref = doc(db, COLLECTION, documentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Request not found");
  const data = snap.data();
  requireStatus(data, STATUS.RELEASED, "mark returned");

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: PIPELINE_STAGES.RETURN,
    action: "returned",
    completedAt: now,
    completedBy: adminId,
    remarks: condition,
  };

  // Damage / loss heuristic
  const damaged = /\b(damag|broken|missing|lost|defect|not\s+working|unusable|destroy)/i.test(
    condition
  );

  // Late return detection: compare actual return time vs expected
  const expectedReturn = data.borrowing?.expectedDateTimeReturn?.toDate?.();
  const returnedAtMs = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
  let lateReturn = false;
  let lateDaysOverdue = 0;
  if (expectedReturn) {
    const diffMs = returnedAtMs - expectedReturn.getTime();
    if (diffMs > 0) {
      lateReturn = true;
      lateDaysOverdue = Math.ceil(diffMs / 86400000);
    }
  }

  const batch = writeBatch(db);
  batch.update(ref, {
    status: STATUS.RETURNED,
    "officeUse.dateReturned": ts,
    "officeUse.receivedByOfficePersonnel": { name, signedAt: ts },
    "officeUse.conditionUponReturn": condition,
    damageReported: damaged,
    lateReturn,
    lateDaysOverdue: lateReturn ? lateDaysOverdue : 0,
    "pipeline.currentStage": PIPELINE_STAGES.CLOSED,
    "pipeline.stages": appendStage(data, stageEntry),
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  // Restore reserved quantities back to inventory
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      adjustEquipmentQuantityOnHand(batch, item.equipmentId, Math.abs(item.quantity || 0), adminId);
    }
  }

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: STATUS.RETURNED,
    previousStatus: data.status,
    changedBy: adminId,
    remarks: lateReturn
      ? `Returned by ${name} — ${lateDaysOverdue} day(s) late${condition ? ` — ${condition}` : ""}`
      : condition
        ? `Returned by ${name} — ${condition}`
        : `Returned by ${name}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  if (damaged) {
    notifyAdmins({
      type: NOTIFICATION_TYPES.EQUIPMENT_DAMAGE_REPORTED,
      title: `Equipment damage reported`,
      message: `${data.title || "Equipment borrowing"} — ${condition}`,
      link: "equipment-requests",
      sourceCollection: COLLECTION,
      sourceId: documentId,
      alsoEmail: true,
    }).catch((err) =>
      console.warn("notifyAdmins (damage) failed:", err?.message || err)
    );
  }

  // Late return: update org penalty counter and notify
  if (lateReturn && data.organizationId) {
    try {
      const orgRef = doc(db, "organizations", data.organizationId);
      await updateDoc(orgRef, {
        lateReturnCount: increment(1),
        lastUpdated: serverTimestamp(),
      });
      const orgSnap = await getDoc(orgRef);
      const newCount = orgSnap.exists() ? (orgSnap.data().lateReturnCount || 0) : 0;

      const orgName = orgSnap.exists() ? (orgSnap.data().name || data.organizationId) : data.organizationId;

      notifyAdmins({
        type: NOTIFICATION_TYPES.EQUIPMENT_RETURN_LATE,
        title: `Late equipment return — ${orgName}`,
        message: `${data.submittedByName || data.requesting?.name || orgName} returned "${data.title || "equipment"}" ${lateDaysOverdue} day(s) late. This org has ${newCount} late return(s) on record.`,
        link: "equipment-requests",
        sourceCollection: COLLECTION,
        sourceId: documentId,
        alsoEmail: true,
      }).catch(() => {});

      if (newCount >= LATE_RETURN_THRESHOLD && !orgSnap.data()?.borrowingRestricted) {
        await updateDoc(orgRef, {
          borrowingRestricted: true,
          borrowingRestrictedAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        });
        notifyOrganization(data.organizationId, {
          type: NOTIFICATION_TYPES.ORG_BORROWING_RESTRICTED,
          title: "Equipment borrowing restricted",
          message: `Your organization has been restricted from submitting new equipment borrowing requests after ${newCount} late returns. Please contact the SAS office to resolve this.`,
          link: "equipment-borrowing",
          sourceCollection: COLLECTION,
          sourceId: documentId,
          alsoEmail: true,
        }).catch(() => {});
        notifyAdmins({
          type: NOTIFICATION_TYPES.EQUIPMENT_RETURN_LATE,
          title: `Borrowing restriction applied — ${orgName}`,
          message: `${orgName} has been restricted from new equipment borrowing requests after reaching ${newCount} late returns.`,
          link: "equipment-requests",
          sourceCollection: COLLECTION,
          sourceId: documentId,
          alsoEmail: false,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("Failed to update org late return penalty (non-fatal):", err);
    }
  }
};

// ── Return-deadline reminder scheduler ─────────────────────────────────────
// Same dedup pattern as report reminders: notifications carry sourceId =
// request docId and reminderTier = T-1 | T+0 | T+3. Idempotent: safe to call
// on every admin login.

const RETURN_REMINDER_TIERS = {
  T_MINUS_1: "EQ_T-1",
  T_PLUS_0: "EQ_T+0",
  T_PLUS_3: "EQ_T+3",
};

const reminderAlreadySent = async (requestId, tier) => {
  const snap = await getDocs(
    query(
      collection(db, "notifications"),
      where("sourceCollection", "==", COLLECTION),
      where("sourceId", "==", requestId),
      where("reminderTier", "==", tier),
      queryLimit(1)
    )
  );
  return !snap.empty;
};

const daysBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 86400000);

export const checkAndFireEquipmentReturnReminders = async () => {
  const now = new Date();
  // Cover everything from "due 1 day from now" through "overdue by 3+ days".
  const horizon = new Date(now.getTime() + 1 * 86400000);

  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("documentType", "==", "equipment_request"),
        where("status", "==", STATUS.RELEASED),
        where("borrowing.expectedDateTimeReturn", "<=", Timestamp.fromDate(horizon))
      )
    );
  } catch (err) {
    console.error("Equipment return reminder scan failed:", err);
    return 0;
  }

  let fired = 0;
  for (const d of snap.docs) {
    const req = { id: d.id, ...d.data() };
    if (req.officeUse?.dateReturned) continue;

    const expected = req.borrowing?.expectedDateTimeReturn?.toDate?.();
    if (!expected) continue;
    const diff = daysBetween(now, expected);

    let tier = null;
    let title = "";
    let isOverdue = false;
    if (diff <= -3) {
      tier = RETURN_REMINDER_TIERS.T_PLUS_3;
      title = "Equipment return overdue by 3+ days";
      isOverdue = true;
    } else if (diff <= 0) {
      tier = RETURN_REMINDER_TIERS.T_PLUS_0;
      title = "Equipment return overdue";
      isOverdue = true;
    } else if (diff === 1) {
      tier = RETURN_REMINDER_TIERS.T_MINUS_1;
      title = "Equipment due to be returned tomorrow";
    } else {
      continue;
    }

    if (await reminderAlreadySent(req.id, tier).catch(() => false)) continue;

    const dateStr = expected.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const itemSummary = (req.items || [])
      .slice(0, 3)
      .map((it) => `${it.quantity}× ${it.name}`)
      .join(", ");
    const message = `${itemSummary || "Borrowed equipment"} (${req.title || "request"}) ${
      isOverdue ? "was due" : "is due"
    } on ${dateStr}. Please return promptly.`;

    if (req.organizationId) {
      notifyOrganization(req.organizationId, {
        type: isOverdue
          ? NOTIFICATION_TYPES.EQUIPMENT_RETURN_OVERDUE
          : NOTIFICATION_TYPES.EQUIPMENT_RETURN_DUE_SOON,
        title,
        message,
        link: "equipment-borrowing",
        sourceCollection: COLLECTION,
        sourceId: req.id,
        reminderTier: tier,
        alsoEmail: true,
      }).catch((err) =>
        console.warn("equipment reminder (org) failed:", err?.message || err)
      );
    }
    fired += 1;
  }
  return fired;
};

/**
 * One-time migration: deduct quantityOnHand for APPROVED requests that were
 * approved before the "deduct at approval" model was introduced.
 * Idempotent — skips docs already marked reservationDeducted.
 */
export const migrateApprovedReservations = async (adminId) => {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION),
      where("documentType", "==", "equipment_request"),
      where("status", "==", STATUS.APPROVED)
    )
  );
  if (snap.empty) return 0;

  const batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.reservationDeducted === true) continue;
    for (const item of (data.items || [])) {
      adjustEquipmentQuantityOnHand(batch, item.equipmentId, -Math.abs(item.quantity || 0), adminId || "system");
    }
    batch.update(d.ref, { reservationDeducted: true });
    count++;
  }
  if (count > 0) await batch.commit();
  return count;
};

/**
 * Persist the generated PDF path on the document.
 */
export const setRequestPdf = async (documentId, { pdfPath, pdfFileName }) => {
  if (!pdfPath || !pdfFileName) throw new Error("pdfPath and pdfFileName required");
  const ref = doc(db, COLLECTION, documentId);
  const batch = writeBatch(db);
  batch.update(ref, {
    pdfPath,
    pdfFileName,
    lastUpdated: serverTimestamp(),
  });
  await batch.commit();
};

export const EQUIPMENT_REQUEST_STATUS = STATUS;
export const EQUIPMENT_REQUEST_PIPELINE_STAGES = PIPELINE_STAGES;

export const STATUS_LABELS = {
  [STATUS.PENDING]: "Pending Review",
  [STATUS.APPROVED]: "Approved — For Delivery",
  [STATUS.RELEASED]: "Released — In Use",
  [STATUS.RETURNED]: "Returned — Closed",
  [STATUS.RETURNED_FOR_REVISION]: "Returned for Revision",
  [STATUS.REJECTED]: "Rejected",
};

export const STATUS_BADGE_CLASS = {
  [STATUS.PENDING]: "status-badge-pending",
  [STATUS.APPROVED]: "status-badge-approved",
  [STATUS.RELEASED]: "status-badge-review",
  [STATUS.RETURNED]: "status-badge-approved",
  [STATUS.RETURNED_FOR_REVISION]: "status-badge-returned",
  [STATUS.REJECTED]: "status-badge-returned",
};
