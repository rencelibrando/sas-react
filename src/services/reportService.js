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
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../config/firebase";
import {
  REPORT_STATUS,
  REPORT_TYPE_LABELS,
  computeReportDueDate,
  getRequiredReportTypes,
} from "../utils/reportConstants";
import {
  notifyReportSubmitted,
  notifyReportReviewed,
} from "./notificationService";
import { getOrganizationById } from "./organizationService";

/**
 * Report Service
 *
 * Manages the post-activity Reports module (Accomplishment / Financial /
 * Financial Statement). Reports are obligations tied to an approved
 * activity proposal — see paper §1.3 Problem 1 and Table 3.9.
 */

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

/**
 * Create the report obligations for a proposal when it has been distributed.
 * Idempotent — if obligations already exist for this proposal, returns them
 * without creating duplicates.
 *
 * @param {Object} proposal - Proposal document (must include documentId,
 *   organizationId, submitterRole, activityDate). If `activityDate` is
 *   missing (legacy proposal), this is a no-op.
 * @returns {Promise<string[]>} Array of created report IDs (empty if no-op).
 */
export const createReportRequirements = async (proposal) => {
  if (!proposal?.documentId) throw new Error("Proposal documentId is required");
  if (!proposal.activityDate) return []; // legacy proposal — option (a): skip

  // Idempotency check
  const existingQ = query(
    collection(db, "reports"),
    where("proposalId", "==", proposal.documentId)
  );
  const existingSnap = await getDocs(existingQ);
  if (!existingSnap.empty) {
    return existingSnap.docs.map((d) => d.id);
  }

  const baseDate =
    toDate(proposal.activityEndDate) || toDate(proposal.activityDate);
  if (!baseDate) return [];

  const requiredTypes = getRequiredReportTypes(proposal.submitterRole);
  const batch = writeBatch(db);
  const createdIds = [];

  for (const reportType of requiredTypes) {
    const reportRef = doc(collection(db, "reports"));
    const dueDate = computeReportDueDate(baseDate, reportType);
    batch.set(reportRef, {
      reportId: reportRef.id,
      proposalId: proposal.documentId,
      proposalTitle: proposal.title || "",
      organizationId: proposal.organizationId,
      submitterRole: proposal.submitterRole || null,
      reportType,
      status: REPORT_STATUS.PENDING,
      dueDate: Timestamp.fromDate(dueDate),
      submittedAt: null,
      submittedBy: null,
      file: null,
      reviewedAt: null,
      reviewedBy: null,
      reviewRemarks: "",
      revisionCount: 0,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
    createdIds.push(reportRef.id);
  }

  await batch.commit();
  return createdIds;
};

/**
 * Submit (or re-submit) a report file.
 * If submitted after dueDate → status = "late"; otherwise "submitted".
 */
export const submitReport = async (reportId, file, userId) => {
  if (!reportId) throw new Error("Report ID is required");
  if (!file) throw new Error("File is required");
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. PDF or Word (.pdf, .doc, .docx) only.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File too large. Maximum 50 MB.");
  }

  const reportRef = doc(db, "reports", reportId);
  const reportSnap = await getDoc(reportRef);
  if (!reportSnap.exists()) throw new Error("Report not found");
  const report = reportSnap.data();

  const storageRef = ref(
    storage,
    `reports/${reportId}/${Date.now()}_${file.name}`
  );
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      uploadedBy: userId,
      originalFileName: file.name,
      reportId,
    },
  });
  const fileUrl = await getDownloadURL(snapshot.ref);

  const now = new Date();
  const dueDate = toDate(report.dueDate);
  const isLate = dueDate && now > dueDate;

  await updateDoc(reportRef, {
    status: isLate ? REPORT_STATUS.LATE : REPORT_STATUS.SUBMITTED,
    submittedAt: serverTimestamp(),
    submittedBy: userId,
    file: {
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      uploadedAt: Timestamp.fromDate(now),
      uploadedBy: userId,
    },
    revisionCount: (report.revisionCount || 0) + (report.file ? 1 : 0),
    reviewedAt: null,
    reviewedBy: null,
    reviewRemarks: "",
    lastUpdated: serverTimestamp(),
  });

  // Notify admins that a report was submitted (non-blocking)
  try {
    let organizationName = report.organizationId;
    try {
      const org = await getOrganizationById(report.organizationId);
      organizationName = org?.name || organizationName;
    } catch {
      /* ignore — fall back to org id */
    }
    await notifyReportSubmitted({
      reportId,
      reportType: report.reportType,
      proposalTitle: report.proposalTitle,
      organizationName,
    });
  } catch (err) {
    console.error("Failed to send submission notification:", err);
  }

  return { reportId, status: isLate ? REPORT_STATUS.LATE : REPORT_STATUS.SUBMITTED };
};

/**
 * Admin review: approve or request revision.
 * @param {string} decision - "approve" | "revise"
 */
export const reviewReport = async (reportId, adminId, decision, remarks = "") => {
  if (!["approve", "revise"].includes(decision)) {
    throw new Error("decision must be 'approve' or 'revise'");
  }
  const reportRef = doc(db, "reports", reportId);
  const reportSnap = await getDoc(reportRef);
  if (!reportSnap.exists()) throw new Error("Report not found");
  const report = reportSnap.data();

  await updateDoc(reportRef, {
    status:
      decision === "approve"
        ? REPORT_STATUS.REVIEWED
        : REPORT_STATUS.NEEDS_REVISION,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminId,
    reviewRemarks: remarks || "",
    lastUpdated: serverTimestamp(),
  });

  // Notify the owning organization (non-blocking)
  try {
    await notifyReportReviewed({
      reportId,
      reportType: report.reportType,
      proposalTitle: report.proposalTitle,
      organizationId: report.organizationId,
      decision,
      remarks,
    });
  } catch (err) {
    console.error("Failed to send review notification:", err);
  }

  return { reportId, status: decision === "approve" ? REPORT_STATUS.REVIEWED : REPORT_STATUS.NEEDS_REVISION };
};

/**
 * Fetch all reports for an organization, newest first by createdAt.
 */
export const getReportsForOrg = async (organizationId, { status } = {}) => {
  if (!organizationId) return [];
  let q = query(
    collection(db, "reports"),
    where("organizationId", "==", organizationId),
    orderBy("createdAt", "desc")
  );
  if (status) {
    q = query(
      collection(db, "reports"),
      where("organizationId", "==", organizationId),
      where("status", "==", status),
      orderBy("createdAt", "desc")
    );
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/**
 * Fetch reports across all orgs (admin view). Optional status filter.
 */
export const getReportsForAdmin = async ({ status } = {}) => {
  let q;
  if (status) {
    q = query(
      collection(db, "reports"),
      where("status", "==", status),
      orderBy("createdAt", "desc")
    );
  } else {
    q = query(collection(db, "reports"), orderBy("createdAt", "desc"));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const getReportById = async (reportId) => {
  if (!reportId) return null;
  const snap = await getDoc(doc(db, "reports", reportId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

/**
 * Scan for reports whose dueDate has passed but are still in PENDING status.
 * Promotes them to LATE. Idempotent — only updates docs whose status is
 * currently PENDING. Safe to call frequently.
 *
 * @param {string|null} organizationId - If provided, only scan that org's
 *   reports (required for org users — Firestore rules forbid them from
 *   enumerating other orgs' reports). Admin callers may omit it to scan
 *   everything.
 */
export const markOverduePendingReports = async (organizationId = null) => {
  const now = Timestamp.fromDate(new Date());
  const q = organizationId
    ? query(
        collection(db, "reports"),
        where("organizationId", "==", organizationId),
        where("status", "==", REPORT_STATUS.PENDING),
        where("dueDate", "<", now)
      )
    : query(
        collection(db, "reports"),
        where("status", "==", REPORT_STATUS.PENDING),
        where("dueDate", "<", now)
      );
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    batch.update(d.ref, {
      status: REPORT_STATUS.LATE,
      lastUpdated: serverTimestamp(),
    });
  });
  await batch.commit();
  return snap.size;
};

export const REPORT_TYPE_LABEL = REPORT_TYPE_LABELS;
