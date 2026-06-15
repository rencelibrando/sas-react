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
  runTransaction,
  limit as queryLimit
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../config/firebase";
import { getUserById } from "./userService";
import { getRequiredKeys, REQUIREMENT_LABELS } from "../utils/proposalConstants";
import { createReportRequirements } from "./reportService";
import { logAdminAction } from "./adminActivityLogService";
import { apiJson } from "./apiClient";
import {
  notifyOrganization,
  NOTIFICATION_TYPES,
} from "./notificationService";

/**
 * Fire a proposal-update notification to the requesting organization.
 * Fire-and-forget: never blocks the main mutation if the notification fails.
 */
const notifyProposalUpdate = ({
  organizationId,
  documentId,
  type,
  title,
  message,
}) => {
  if (!organizationId) return;
  notifyOrganization(organizationId, {
    type,
    title,
    message,
    link: "activity-proposals",
    sourceCollection: "documents",
    sourceId: documentId,
    alsoEmail: true,
  }).catch((err) =>
    console.warn("proposal notification failed:", err?.message || err)
  );
};

/**
 * Document Service
 * 
 * Handles all document management operations including:
 * - Document submission by organization officers
 * - Document retrieval and filtering
 * - Admin document management (status updates, assignment)
 * - Status history tracking
 * - File uploads to Firebase Storage
 */

/**
 * Submit an activity proposal with multiple required files.
 * Creates document with `files` array schema and initializes the pipeline.
 */
export const submitActivityProposal = async (
  { title, description, activityDate, activityEndDate, proposalFlags, submitterRole },
  uploadedFiles,
  userId,
  organizationId
) => {
  if (!title?.trim()) throw new Error("Proposal title is required");
  if (title.length > 200) throw new Error("Title must be 200 characters or less");
  if (!organizationId) throw new Error("Organization not found");
  if (!activityDate) throw new Error("Activity date is required");

  const activityDateObj = new Date(activityDate);
  if (Number.isNaN(activityDateObj.getTime())) {
    throw new Error("Activity date is invalid");
  }
  let activityEndDateObj = null;
  if (activityEndDate) {
    activityEndDateObj = new Date(activityEndDate);
    if (Number.isNaN(activityEndDateObj.getTime())) {
      throw new Error("Activity end date is invalid");
    }
    if (activityEndDateObj < activityDateObj) {
      throw new Error("Activity end date cannot be earlier than start date");
    }
  }

  const isISGSubmission = submitterRole === "ISG";
  const requiredKeys = getRequiredKeys(proposalFlags, { isISG: isISGSubmission });
  for (const key of requiredKeys) {
    if (!uploadedFiles[key]) {
      throw new Error(`Missing required document: ${REQUIREMENT_LABELS[key]}`);
    }
  }

  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  for (const [key, file] of Object.entries(uploadedFiles)) {
    if (!file) continue;
    if (!allowedTypes.includes(file.type)) {
      throw new Error(
        `Invalid file type for "${REQUIREMENT_LABELS[key]}". PDF or Word (.pdf, .doc, .docx) only.`
      );
    }
    if (file.size > 50 * 1024 * 1024) {
      throw new Error(
        `File too large: "${REQUIREMENT_LABELS[key]}". Maximum 50 MB.`
      );
    }
  }

  const documentRef = doc(collection(db, "documents"));
  const documentId = documentRef.id;
  const uploadedAt = Timestamp.fromDate(new Date());

  const filesArray = [];
  for (const [requirementKey, file] of Object.entries(uploadedFiles)) {
    if (!file) continue;
    const storageRef = ref(
      storage,
      `documents/${documentId}/${requirementKey}/${file.name}`
    );
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedBy: userId,
        originalFileName: file.name,
        documentId,
      },
    });
    const fileUrl = await getDownloadURL(snapshot.ref);
    filesArray.push({
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      requirementKey,
      uploadedAt,
      uploadedBy: userId,
    });
  }

  const batch = writeBatch(db);

  const initialStage = isISGSubmission ? "sas_review" : "isg_endorsement";

  batch.set(documentRef, {
    documentId,
    documentNumber: null,
    organizationId,
    submittedBy: userId,
    submitterRole: submitterRole || null,
    documentType: "activity_proposal",
    direction: "incoming",
    title: title.trim(),
    description: description?.trim() || "",
    activityDate: Timestamp.fromDate(activityDateObj),
    activityEndDate: activityEndDateObj ? Timestamp.fromDate(activityEndDateObj) : null,
    files: filesArray,
    proposalFlags,
    revisionCount: 0,
    dateLastRevised: null,
    status: "pending",
    remarks: "",
    assignedTo: null,
    createdBy: userId,
    updatedBy: userId,
    dateSubmitted: serverTimestamp(),
    dateAssigned: null,
    dateReviewed: null,
    dateReleased: null,
    lastUpdated: serverTimestamp(),
    pipeline: {
      currentStage: initialStage,
      stages: [],
    },
  });

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: "pending",
    previousStatus: null,
    changedBy: userId,
    remarks: isISGSubmission
      ? "Activity proposal submitted by ISG — forwarded directly to SAS"
      : "Activity proposal submitted",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  return { documentId, status: "pending" };
};

/**
 * Submit a new document (Organization Officer)
 * @param {Object} documentData - Document data
 * @param {string} documentData.organizationId - Organization ID
 * @param {string} documentData.documentType - Document type code
 * @param {string} documentData.direction - "incoming" | "outgoing"
 * @param {string} documentData.title - Document title
 * @param {string} documentData.description - Optional description
 * @param {File} file - File to upload
 * @param {string} userId - User ID of the submitter
 * @returns {Promise<Object>} Created document with documentId
 */
export const submitDocument = async (documentData, file, userId) => {
  try {
    // Validate user is verified officer
    const user = await getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    
    if (user.verificationStatus !== "verified") {
      throw new Error("You must be a verified officer to submit documents");
    }
    
    if (user.organizationId !== documentData.organizationId) {
      throw new Error("You can only submit documents for your organization");
    }

    // Validate file
    if (!file) {
      throw new Error("File is required");
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    
    if (!allowedTypes.includes(file.type)) {
      throw new Error("Invalid file type. Please upload a PDF or Word document (.pdf, .doc, .docx)");
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new Error("File size exceeds 50MB limit. Please upload a smaller file.");
    }

    // Validate required fields
    if (!documentData.title || documentData.title.trim().length === 0) {
      throw new Error("Document title is required");
    }
    
    if (documentData.title.length > 200) {
      throw new Error("Document title must be 200 characters or less");
    }

    if (documentData.description && documentData.description.length > 1000) {
      throw new Error("Description must be 1000 characters or less");
    }

    // Create document record first (to get documentId)
    const documentsRef = collection(db, "documents");
    const documentRef = doc(documentsRef);
    const documentId = documentRef.id;

    // Upload file to Firebase Storage
    const timestamp = Date.now();
    const fileName = `${documentId}_${timestamp}_${file.name}`;
    const storageRef = ref(storage, `documents/${documentId}/${fileName}`);
    
    const metadata = {
      contentType: file.type,
      customMetadata: {
        uploadedBy: userId,
        uploadedAt: new Date().toISOString(),
        originalFileName: file.name,
        documentId: documentId
      }
    };

    const uploadSnapshot = await uploadBytes(storageRef, file, metadata);
    const fileUrl = await getDownloadURL(uploadSnapshot.ref);

    // Create document with batch write (document + status history)
    const batch = writeBatch(db);

    // Create document
    batch.set(documentRef, {
      documentId: documentId,
      documentNumber: null, // Will be assigned by admin
      organizationId: documentData.organizationId,
      submittedBy: userId,
      documentType: documentData.documentType,
      direction: documentData.direction || "incoming",
      title: documentData.title.trim(),
      description: documentData.description?.trim() || "",
      fileUrl: fileUrl,
      fileName: file.name,
      fileSize: file.size,
      status: "pending",
      remarks: "",
      assignedTo: null,
      dateSubmitted: serverTimestamp(),
      dateAssigned: null,
      dateReviewed: null,
      dateReleased: null,
      lastUpdated: serverTimestamp(),
      createdBy: userId,
      updatedBy: userId
    });

    // Create initial status history entry
    const historyRef = doc(collection(db, "documentStatusHistory"));
    batch.set(historyRef, {
      documentId: documentId,
      status: "pending",
      previousStatus: null,
      changedBy: userId,
      remarks: "Document submitted",
      timestamp: serverTimestamp()
    });

    await batch.commit();

    console.log(`Document ${documentId} submitted successfully`);
    
    return {
      documentId: documentId,
      documentNumber: null,
      status: "pending"
    };
  } catch (error) {
    console.error("Error submitting document:", error);
    throw error;
  }
};

/**
 * Get documents by organization
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Optional filters
 * @param {string} filters.status - Filter by status
 * @param {string} filters.documentType - Filter by document type
 * @param {Date} filters.dateFrom - Filter from date
 * @param {Date} filters.dateTo - Filter to date
 * @param {string} filters.direction - Filter by direction
 * @returns {Promise<Array>} Array of documents
 */
export const getDocumentsByOrganization = async (organizationId, filters = {}) => {
  try {
    const documentsRef = collection(db, "documents");
    let q = query(documentsRef, where("organizationId", "==", organizationId));

    // Apply filters
    if (filters.status) {
      q = query(q, where("status", "==", filters.status));
    }
    
    if (filters.documentType) {
      q = query(q, where("documentType", "==", filters.documentType));
    }
    
    if (filters.direction) {
      q = query(q, where("direction", "==", filters.direction));
    }
    
    if (filters.dateFrom) {
      const fromTimestamp = Timestamp.fromDate(filters.dateFrom);
      q = query(q, where("dateSubmitted", ">=", fromTimestamp));
    }
    
    if (filters.dateTo) {
      const toTimestamp = Timestamp.fromDate(filters.dateTo);
      q = query(q, where("dateSubmitted", "<=", toTimestamp));
    }

    // Order by date submitted (newest first)
    q = query(q, orderBy("dateSubmitted", "desc"));

    const querySnapshot = await getDocs(q);
    const documents = [];
    
    querySnapshot.forEach((docSnapshot) => {
      documents.push({
        documentId: docSnapshot.id,
        ...docSnapshot.data()
      });
    });

    return documents;
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw error;
  }
};

/**
 * Get document by ID
 * @param {string} documentId - Document ID
 * @returns {Promise<Object|null>} Document object or null
 */
export const getDocumentById = async (documentId) => {
  try {
    const documentRef = doc(db, "documents", documentId);
    const documentSnapshot = await getDoc(documentRef);
    
    if (documentSnapshot.exists()) {
      return {
        documentId: documentSnapshot.id,
        ...documentSnapshot.data()
      };
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching document:", error);
    throw error;
  }
};

/**
 * Get the appropriate response type for an incoming document type
 * @param {string} incomingType - The incoming document type code
 * @returns {Object} Response type info with type code and display label
 */
export const getResponseTypeForIncoming = (incomingType) => {
  const mapping = {
    activity_proposal: { type: "approval_memorandum", label: "Approval Memorandum" },
    financial_report: { type: "endorsement_letter", label: "Endorsement Letter" },
    financial_statement: { type: "endorsement_letter", label: "Endorsement Letter" },
    compliance_document: { type: "feedback_memo", label: "Feedback Memo" },
    other: { type: "generic_response", label: "Generic Response" },
    accomplishment_report: { type: "acknowledgment_letter", label: "Acknowledgment Letter" }
  };
  return mapping[incomingType] || { type: "generic_response", label: "Generic Response" };
};

/**
 * Format date for templates
 * @param {Timestamp|Date} timestamp - Date to format
 * @returns {string} Formatted date string
 */
const formatDateForTemplate = (timestamp) => {
  if (!timestamp) return "N/A";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
};

/**
 * Get pre-filled template for response document
 * @param {Object} incomingDoc - The incoming document data
 * @param {string} responseType - The response type code
 * @returns {Object} Template with subject and description
 */
export const getResponseTemplate = (incomingDoc, responseType) => {
  const docTypeDisplay = incomingDoc.documentType?.replace(/_/g, " ") || "document";
  const formattedDate = formatDateForTemplate(incomingDoc.dateSubmitted);
  
  const templates = {
    approval_memorandum: {
      subject: `Approval: ${incomingDoc.title}`,
      description: `This is to formally approve your Activity Proposal titled "${incomingDoc.title}" submitted on ${formattedDate}.\n\nYour proposal has been reviewed and meets all necessary requirements. You may proceed with the planned activities as outlined in your submission.`
    },
    endorsement_letter: {
      subject: `Endorsement: ${incomingDoc.title}`,
      description: `We hereby endorse the ${docTypeDisplay} titled "${incomingDoc.title}" submitted by your organization on ${formattedDate}.\n\nThis endorsement confirms the accuracy and validity of the reported information.`
    },
    feedback_memo: {
      subject: `Feedback: ${incomingDoc.title}`,
      description: `Please find below our feedback regarding your ${docTypeDisplay} submission dated ${formattedDate}:\n\n[Add specific feedback here]`
    },
    acknowledgment_letter: {
      subject: `Acknowledgment: ${incomingDoc.title}`,
      description: `We acknowledge receipt and successful review of your ${docTypeDisplay} titled "${incomingDoc.title}" submitted on ${formattedDate}.\n\nYour organization's efforts are duly noted and appreciated.`
    },
    generic_response: {
      subject: `Response: ${incomingDoc.title}`,
      description: `This is in response to your submission titled "${incomingDoc.title}" dated ${formattedDate}.\n\n[Add response details here]`
    }
  };
  
  return templates[responseType] || templates.generic_response;
};

/**
 * Get outgoing documents linked to an incoming document
 * @param {string} incomingDocumentId - The incoming document ID
 * @returns {Promise<Array>} Array of linked outgoing documents
 */
export const getOutgoingDocumentsForIncoming = async (incomingDocumentId) => {
  try {
    const documentsRef = collection(db, "documents");
    const q = query(
      documentsRef,
      where("responseTo", "==", incomingDocumentId),
      where("direction", "==", "outgoing"),
      orderBy("dateSubmitted", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const documents = [];
    
    querySnapshot.forEach((docSnapshot) => {
      documents.push({
        documentId: docSnapshot.id,
        ...docSnapshot.data()
      });
    });
    
    return documents;
  } catch (error) {
    console.error("Error fetching outgoing documents for incoming:", error);
    return [];
  }
};

/**
 * Assign document number (Admin only)
 * @param {string} documentId - Document ID
 * @param {string} documentNumber - Document number to assign (e.g., "DOC-2024-001")
 * @param {string} adminId - Admin user ID
 * @returns {Promise<void>}
 */
export const assignDocumentNumber = async (documentId, documentNumber, adminId) => {
  try {
    const documentRef = doc(db, "documents", documentId);
    const documentSnapshot = await getDoc(documentRef);
    
    if (!documentSnapshot.exists()) {
      throw new Error("Document not found");
    }

    const documentData = documentSnapshot.data();
    
    // Check if document number already assigned
    if (documentData.documentNumber) {
      throw new Error("Document number already assigned");
    }

    // Check if document is in pending status
    if (documentData.status !== "pending") {
      throw new Error(`Cannot assign document number. Document status is: ${documentData.status}`);
    }

    // Check for duplicate document number
    const documentsRef = collection(db, "documents");
    const duplicateQuery = query(
      documentsRef,
      where("documentNumber", "==", documentNumber),
      queryLimit(1)
    );
    const duplicateSnapshot = await getDocs(duplicateQuery);
    
    if (!duplicateSnapshot.empty) {
      throw new Error("Document number already exists. Please use a different number.");
    }

    // Use batch to update document and create history
    const batch = writeBatch(db);

    // Update document
    batch.update(documentRef, {
      documentNumber: documentNumber,
      status: "under_review",
      assignedTo: adminId,
      dateAssigned: serverTimestamp(),
      lastUpdated: serverTimestamp(),
      updatedBy: adminId
    });

    // Create status history entry
    const historyRef = doc(collection(db, "documentStatusHistory"));
    batch.set(historyRef, {
      documentId: documentId,
      status: "under_review",
      previousStatus: "pending",
      changedBy: adminId,
      remarks: `Document number assigned: ${documentNumber}`,
      timestamp: serverTimestamp()
    });

    await batch.commit();
    
    console.log(`Document number ${documentNumber} assigned to document ${documentId}`);
  } catch (error) {
    console.error("Error assigning document number:", error);
    throw error;
  }
};

/**
 * Update document status (Admin only)
 * @param {string} documentId - Document ID
 * @param {string} newStatus - New status
 * @param {string} remarks - Optional remarks
 * @param {string} adminId - Admin user ID
 * @param {boolean} generateResponse - Whether to generate a response document (for incoming approvals)
 * @param {Object} responseData - Response document data (if generateResponse is true)
 * @param {string} responseData.subject - Response document subject
 * @param {string} responseData.description - Response document description
 * @param {string} responseData.orderNumber - Optional order number for memorandums
 * @param {string} responseData.fileUrl - Optional file URL
 * @param {string} responseData.fileName - Optional file name
 * @param {number} responseData.fileSize - Optional file size
 * @returns {Promise<Object>} Updated document info, includes outgoingDocumentId if response was generated
 */
export const updateDocumentStatus = async (
  documentId, 
  newStatus, 
  remarks, 
  adminId, 
  generateResponse = false,
  responseData = null
) => {
  try {
    // Validate status
    const validStatuses = ["pending", "under_review", "approved", "returned", "rejected", "released"];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const documentRef = doc(db, "documents", documentId);
    const documentSnapshot = await getDoc(documentRef);
    
    if (!documentSnapshot.exists()) {
      throw new Error("Document not found");
    }

    const documentData = documentSnapshot.data();
    const previousStatus = documentData.status;

    // Validate status transition
    if (newStatus === previousStatus) {
      throw new Error("Document is already in this status");
    }

    // Cannot change status if document is released
    if (documentData.status === "released") {
      throw new Error("Cannot change status of a released document");
    }

    // Validate response generation only for approved status on incoming documents
    let outgoingDocumentId = null;
    if (generateResponse) {
      if (newStatus !== "approved") {
        throw new Error("Response documents can only be generated when approving a document");
      }
      if (documentData.direction !== "incoming") {
        throw new Error("Response documents can only be generated for incoming documents");
      }
      if (!responseData || !responseData.subject || !responseData.description) {
        throw new Error("Response data with subject and description is required");
      }
    }

    // Use batch to update document and create history
    const batch = writeBatch(db);

    const updateData = {
      status: newStatus,
      remarks: remarks || "",
      lastUpdated: serverTimestamp(),
      updatedBy: adminId
    };

    // Set dateReviewed if transitioning to approved/rejected/returned
    if (newStatus === "approved" || newStatus === "rejected" || newStatus === "returned") {
      if (!documentData.dateReviewed) {
        updateData.dateReviewed = serverTimestamp();
      }
    }

    batch.update(documentRef, updateData);

    // Create status history entry
    const historyRef = doc(collection(db, "documentStatusHistory"));
    batch.set(historyRef, {
      documentId: documentId,
      status: newStatus,
      previousStatus: previousStatus,
      changedBy: adminId,
      remarks: remarks || "",
      timestamp: serverTimestamp()
    });

    // Generate response document if requested
    if (generateResponse && responseData) {
      const outgoingRef = doc(collection(db, "documents"));
      outgoingDocumentId = outgoingRef.id;

      batch.set(outgoingRef, {
        documentId: outgoingDocumentId,
        documentNumber: responseData.orderNumber || null,
        organizationId: documentData.organizationId,
        submittedBy: adminId,
        documentType: responseData.responseType || "generic_response",
        direction: "outgoing",
        responseTo: documentId,
        title: responseData.subject,
        description: responseData.description,
        status: "released",
        remarks: responseData.remarks || "",
        assignedTo: adminId,
        dateSubmitted: serverTimestamp(),
        dateAssigned: serverTimestamp(),
        dateReviewed: serverTimestamp(),
        dateReleased: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        createdBy: adminId,
        updatedBy: adminId,
        fileUrl: responseData.fileUrl || null,
        fileName: responseData.fileName || null,
        fileSize: responseData.fileSize || null
      });

      // Create status history entry for outgoing document
      const outgoingHistoryRef = doc(collection(db, "documentStatusHistory"));
      batch.set(outgoingHistoryRef, {
        documentId: outgoingDocumentId,
        status: "released",
        previousStatus: null,
        changedBy: adminId,
        remarks: `Generated in response to ${documentData.documentNumber || documentId}`,
        timestamp: serverTimestamp()
      });
    }

    await batch.commit();
    
    console.log(`Document ${documentId} status updated from ${previousStatus} to ${newStatus}`);
    
    return {
      documentId,
      status: newStatus,
      outgoingDocumentId
    };
  } catch (error) {
    console.error("Error updating document status:", error);
    throw error;
  }
};

/**
 * Release document (Admin only)
 * Marks document as released and makes it read-only
 * @param {string} documentId - Document ID
 * @param {string} adminId - Admin user ID
 * @returns {Promise<void>}
 */
export const releaseDocument = async (documentId, adminId) => {
  try {
    const documentRef = doc(db, "documents", documentId);
    const documentSnapshot = await getDoc(documentRef);
    
    if (!documentSnapshot.exists()) {
      throw new Error("Document not found");
    }

    const documentData = documentSnapshot.data();
    
    // Can only release documents that are approved
    if (documentData.status !== "approved") {
      throw new Error(`Cannot release document. Current status is: ${documentData.status}. Document must be approved first.`);
    }

    // Use batch to update document and create history
    const batch = writeBatch(db);

    // Update document
    batch.update(documentRef, {
      status: "released",
      dateReleased: serverTimestamp(),
      lastUpdated: serverTimestamp(),
      updatedBy: adminId
    });

    // Create status history entry
    const historyRef = doc(collection(db, "documentStatusHistory"));
    batch.set(historyRef, {
      documentId: documentId,
      status: "released",
      previousStatus: documentData.status,
      changedBy: adminId,
      remarks: "Document released",
      timestamp: serverTimestamp()
    });

    await batch.commit();

    if (documentData.documentType === "Memorandum") {
      logAdminAction({
        type: "memorandum_released",
        targetCollection: "documents",
        targetId: documentId,
        targetLabel: documentData.title || documentId,
      });
    }

    console.log(`Document ${documentId} released successfully`);
  } catch (error) {
    console.error("Error releasing document:", error);
    throw error;
  }
};

/**
 * Search documents with filters
 * @param {Object} filters - Search filters
 * @param {string} filters.organizationId - Optional organization ID
 * @param {string} filters.documentType - Optional document type
 * @param {string} filters.status - Optional status
 * @param {Date} filters.dateFrom - Optional from date
 * @param {Date} filters.dateTo - Optional to date
 * @param {string} filters.direction - Optional direction
 * @param {string} filters.searchTerm - Optional search term (searches title and description)
 * @returns {Promise<Array>} Array of matching documents
 */
export const searchDocuments = async (filters = {}) => {
  try {
    const documentsRef = collection(db, "documents");
    let q = query(documentsRef);

    // Apply filters
    if (filters.organizationId) {
      q = query(q, where("organizationId", "==", filters.organizationId));
    }
    
    if (filters.status) {
      q = query(q, where("status", "==", filters.status));
    }
    
    if (filters.documentType) {
      q = query(q, where("documentType", "==", filters.documentType));
    }
    
    if (filters.direction) {
      q = query(q, where("direction", "==", filters.direction));
    }
    
    if (filters.dateFrom) {
      const fromTimestamp = Timestamp.fromDate(filters.dateFrom);
      q = query(q, where("dateSubmitted", ">=", fromTimestamp));
    }
    
    if (filters.dateTo) {
      const toTimestamp = Timestamp.fromDate(filters.dateTo);
      q = query(q, where("dateSubmitted", "<=", toTimestamp));
    }

    // Order by date submitted (newest first)
    q = query(q, orderBy("dateSubmitted", "desc"));

    const querySnapshot = await getDocs(q);
    const documents = [];
    
    querySnapshot.forEach((docSnapshot) => {
      const docData = {
        documentId: docSnapshot.id,
        ...docSnapshot.data()
      };

      // Filter by search term if provided (client-side filtering)
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        const titleMatch = docData.title?.toLowerCase().includes(searchLower);
        const descMatch = docData.description?.toLowerCase().includes(searchLower);
        const docNumMatch = docData.documentNumber?.toLowerCase().includes(searchLower);
        
        if (titleMatch || descMatch || docNumMatch) {
          documents.push(docData);
        }
      } else {
        documents.push(docData);
      }
    });

    return documents;
  } catch (error) {
    console.error("Error searching documents:", error);
    throw error;
  }
};

/**
 * Get document status history
 * @param {string} documentId - Document ID
 * @returns {Promise<Array>} Array of status history entries
 */
export const getDocumentStatusHistory = async (documentId) => {
  try {
    const historyRef = collection(db, "documentStatusHistory");
    const q = query(
      historyRef,
      where("documentId", "==", documentId),
      orderBy("timestamp", "asc")
    );

    const querySnapshot = await getDocs(q);
    const history = [];
    
    querySnapshot.forEach((docSnapshot) => {
      history.push({
        historyId: docSnapshot.id,
        ...docSnapshot.data()
      });
    });

    return history;
  } catch (error) {
    console.error("Error fetching document status history:", error);
    throw error;
  }
};

/**
 * Get all pending documents (Admin)
 * @returns {Promise<Array>} Array of pending documents
 */
export const getPendingDocuments = async () => {
  try {
    return await searchDocuments({ status: "pending" });
  } catch (error) {
    console.error("Error fetching pending documents:", error);
    throw error;
  }
};

/**
 * Get documents by status (Admin)
 * @param {string} status - Document status
 * @returns {Promise<Array>} Array of documents with the specified status
 */
export const getDocumentsByStatus = async (status) => {
  try {
    return await searchDocuments({ status });
  } catch (error) {
    console.error("Error fetching documents by status:", error);
    throw error;
  }
};

/**
 * Get released outgoing documents (Memorandums and Announcements)
 * @param {number} limit - Optional limit on number of documents to return
 * @returns {Promise<Array>} Array of released outgoing documents
 */
export const getReleasedOutgoingDocuments = async (limit = null) => {
  try {
    // Fetch all outgoing documents with approved or released status
    // Then filter for Memorandum and Announcement types
    const documentsRef = collection(db, "documents");
    
    // Try to query with status filter first
    let documents = [];
    
    try {
      // Query for approved outgoing documents
      let qApproved = query(
        documentsRef,
        where("direction", "==", "outgoing"),
        where("status", "==", "approved"),
        orderBy("dateSubmitted", "desc")
      );
      
      const approvedSnapshot = await getDocs(qApproved);
      approvedSnapshot.forEach((docSnapshot) => {
        const docData = {
          documentId: docSnapshot.id,
          ...docSnapshot.data()
        };
        if (docData.documentType === "Memorandum" || docData.documentType === "Announcement") {
          documents.push(docData);
        }
      });
    } catch (error) {
      console.warn("Could not query approved documents:", error);
    }
    
    try {
      // Query for released outgoing documents
      let qReleased = query(
        documentsRef,
        where("direction", "==", "outgoing"),
        where("status", "==", "released"),
        orderBy("dateSubmitted", "desc")
      );
      
      const releasedSnapshot = await getDocs(qReleased);
      releasedSnapshot.forEach((docSnapshot) => {
        const docData = {
          documentId: docSnapshot.id,
          ...docSnapshot.data()
        };
        if (docData.documentType === "Memorandum" || docData.documentType === "Announcement") {
          // Avoid duplicates
          if (!documents.find(doc => doc.documentId === docData.documentId)) {
            documents.push(docData);
          }
        }
      });
    } catch (error) {
      console.warn("Could not query released documents:", error);
    }
    
    // Sort by dateSubmitted descending
    documents.sort((a, b) => {
      const dateA = a.dateSubmitted?.toDate?.() || new Date(0);
      const dateB = b.dateSubmitted?.toDate?.() || new Date(0);
      return dateB - dateA;
    });
    
    // Apply limit if specified
    if (limit && documents.length > limit) {
      return documents.slice(0, limit);
    }
    
    return documents;
  } catch (error) {
    console.error("Error fetching released outgoing documents:", error);
    return [];
  }
};

/**
 * Get all activity proposals currently at a given pipeline stage.
 * ISG users have Firestore read permission across all orgs for activity_proposal docs.
 */
export const getProposalsAtStage = async (stage) => {
  // Equality-only where clauses avoid the composite index requirement.
  // We sort by dateSubmitted client-side (oldest first = FIFO queue).
  const q = query(
    collection(db, "documents"),
    where("documentType", "==", "activity_proposal"),
    where("pipeline.currentStage", "==", stage)
  );
  const snap = await getDocs(q);
  const docs = snap.docs.map((d) => ({ documentId: d.id, ...d.data() }));
  docs.sort((a, b) => {
    const aTime = a.dateSubmitted?.toDate?.()?.getTime() ?? 0;
    const bTime = b.dateSubmitted?.toDate?.()?.getTime() ?? 0;
    return aTime - bTime;
  });
  return docs;
};

/**
 * ISG forwards an activity proposal to SAS after assessment.
 * ISG does not generate documents — the endorsement letter is SAS's responsibility.
 */
export const endorseProposal = async (documentId, userId, remarks = "") => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();
  if (data.pipeline?.currentStage !== "isg_endorsement") {
    throw new Error("Proposal is not at the ISG endorsement stage");
  }

  const completedAt = Timestamp.fromDate(new Date());
  const newStage = {
    stage: "isg_endorsement",
    action: "forwarded",
    completedAt,
    completedBy: userId,
    remarks: remarks || "",
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    "pipeline.currentStage": "sas_review",
    "pipeline.stages": [...(data.pipeline?.stages || []), newStage],
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: "pending",
    previousStatus: data.status,
    changedBy: userId,
    remarks: remarks
      ? `Assessed and forwarded to SAS by ISG — ${remarks}`
      : "Assessed and forwarded to SAS by ISG",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  notifyProposalUpdate({
    organizationId: data.organizationId,
    documentId,
    type: NOTIFICATION_TYPES.PROPOSAL_STAGE_ADVANCED,
    title: `Proposal forwarded to SAS: ${data.title || ""}`.trim(),
    message: `Your activity proposal "${data.title || documentId}" has been assessed by ISG and forwarded to SAS for review.`,
  });
};

/**
 * ISG returns a proposal to the submitting org for revision.
 */
export const returnProposalFromISG = async (documentId, userId, remarks) => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();

  const completedAt = Timestamp.fromDate(new Date());
  const newStage = {
    stage: "isg_endorsement",
    action: "returned",
    completedAt,
    completedBy: userId,
    remarks: remarks || "",
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    status: "returned",
    remarks: remarks || "",
    "pipeline.currentStage": null,
    "pipeline.stages": [...(data.pipeline?.stages || []), newStage],
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: "returned",
    previousStatus: data.status,
    changedBy: userId,
    remarks: remarks || "Returned by ISG for revision",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  notifyProposalUpdate({
    organizationId: data.organizationId,
    documentId,
    type: NOTIFICATION_TYPES.PROPOSAL_RETURNED,
    title: `Proposal returned for revision: ${data.title || ""}`.trim(),
    message: `Your activity proposal "${data.title || documentId}" was returned by ISG for revision.${
      remarks ? ` Reviewer remarks: ${remarks}` : ""
    }`,
  });
};

/**
 * ISG marks a proposal as distributed to the requesting organization.
 * This is the final pipeline stage — the document is marked approved and the pipeline closes.
 */
export const markAsDistributed = async (documentId, userId) => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();
  if (data.pipeline?.currentStage !== "isg_distribution") {
    throw new Error("Proposal is not at the ISG distribution stage");
  }

  const completedAt = Timestamp.fromDate(new Date());
  const newStage = {
    stage: "isg_distribution",
    action: "distributed",
    completedAt,
    completedBy: userId,
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    status: "approved",
    "pipeline.currentStage": null,
    "pipeline.stages": [...(data.pipeline?.stages || []), newStage],
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: "approved",
    previousStatus: data.status,
    changedBy: userId,
    remarks: "Distributed to student organization by ISG — activity proposal complete",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  // Create post-activity report obligations now that the proposal is fully approved.
  // Skipped silently for legacy proposals without an activityDate (option (a)).
  try {
    await createReportRequirements({
      documentId,
      organizationId: data.organizationId,
      submitterRole: data.submitterRole,
      title: data.title,
      activityDate: data.activityDate,
      activityEndDate: data.activityEndDate,
    });
  } catch (err) {
    console.error("Failed to create report requirements:", err);
  }

  notifyProposalUpdate({
    organizationId: data.organizationId,
    documentId,
    type: NOTIFICATION_TYPES.PROPOSAL_APPROVED,
    title: `Proposal approved: ${data.title || ""}`.trim(),
    message: `Your activity proposal "${data.title || documentId}" has been fully approved and distributed by ISG. You may now proceed with the planned activity.`,
  });
};

/**
 * SAS completes review: uploads endorsement letter, advances pipeline to vpaa_review,
 * creates a single-use review token for VPAA.
 * Returns { tokenId, fileUrl } for the caller to send the review-link email.
 */
export const completeSASReview = async (documentId, adminId, endorsementFile) => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();
  if (data.pipeline?.currentStage !== "sas_review") {
    throw new Error("Proposal is not at the SAS review stage");
  }
  const openRequests = (data.additionalRequests || []).filter(isOpenAdditionalRequest);
  if (openRequests.length > 0) {
    throw new Error(
      `Cannot forward — ${openRequests.length} additional document request(s) still open. Mark each as Resolved before forwarding.`
    );
  }

  // Upload endorsement letter to Storage
  const storageRef = ref(
    storage,
    `documents/${documentId}/sas_endorsement_letter/${endorsementFile.name}`
  );
  const snapshot = await uploadBytes(storageRef, endorsementFile, {
    contentType: endorsementFile.type,
    customMetadata: { uploadedBy: adminId, documentId },
  });
  const fileUrl = await getDownloadURL(snapshot.ref);

  const now = Timestamp.fromDate(new Date());
  const expiresAt = Timestamp.fromDate(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  );

  const tokenRef = doc(collection(db, "reviewTokens"));
  const tokenId = tokenRef.id;

  const sasStageEntry = {
    stage: "sas_review",
    action: "forwarded",
    completedAt: now,
    completedBy: adminId,
    generatedFileUrl: fileUrl,
    generatedFileName: endorsementFile.name,
  };

  const vpaaStageEntry = {
    stage: "vpaa_review",
    token: tokenId,
    tokenSentAt: now,
    tokenExpiresAt: expiresAt,
    completedAt: null,
    completedBy: null,
    action: null,
    remarks: null,
  };

  const updatedFiles = [
    ...(data.files || []),
    {
      fileUrl,
      fileName: endorsementFile.name,
      fileSize: endorsementFile.size,
      requirementKey: "sas_endorsement_letter",
      uploadedAt: now,
      uploadedBy: adminId,
    },
  ];

  const batch = writeBatch(db);

  batch.update(docRef, {
    "pipeline.currentStage": "vpaa_review",
    "pipeline.stages": [
      ...(data.pipeline?.stages || []),
      sasStageEntry,
      vpaaStageEntry,
    ],
    files: updatedFiles,
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  batch.set(tokenRef, {
    tokenId,
    documentId,
    stage: "vpaa_review",
    createdAt: serverTimestamp(),
    createdBy: adminId,
    expiresAt,
    consumed: false,
    consumedAt: null,
    action: null,
    remarks: null,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: "pending",
    previousStatus: data.status,
    changedBy: adminId,
    remarks:
      "SAS review complete — endorsement letter generated — forwarded to VPAA for review",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  logAdminAction({
    type: "proposal_forwarded_to_vpaa",
    targetCollection: "documents",
    targetId: documentId,
    targetLabel: data.title || documentId,
    remarks: "Endorsement letter generated; review link sent to VPAA",
  });

  notifyProposalUpdate({
    organizationId: data.organizationId,
    documentId,
    type: NOTIFICATION_TYPES.PROPOSAL_STAGE_ADVANCED,
    title: `Proposal forwarded to VPAA: ${data.title || ""}`.trim(),
    message: `SAS has completed its review of your activity proposal "${data.title || documentId}" and forwarded it to the VPAA office.`,
  });

  return { tokenId, fileUrl };
};

/**
 * SAS performs the final release after the last reviewing office approves.
 * - Org-submitted proposals advance from `sas_release` to `isg_distribution`
 *   so ISG can hand the approved proposal back to the requesting organization.
 * - ISG-submitted proposals are marked approved directly (no separate
 *   distribution stage — ISG is the requester).
 */
export const releaseFromSASToISG = async (documentId, adminId) => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();
  if (data.pipeline?.currentStage !== "sas_release") {
    throw new Error("Proposal is not at the SAS release stage");
  }

  const isISGSubmission = data.submitterRole === "ISG";
  const now = Timestamp.fromDate(new Date());
  const stages = Array.isArray(data.pipeline?.stages)
    ? [...data.pipeline.stages]
    : [];

  let activeIdx = -1;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i]?.stage === "sas_release" && stages[i]?.completedAt == null) {
      activeIdx = i;
      break;
    }
  }
  const stageEntry = {
    stage: "sas_release",
    action: "released",
    completedAt: now,
    completedBy: adminId,
  };
  if (activeIdx !== -1) {
    stages[activeIdx] = { ...stages[activeIdx], ...stageEntry };
  } else {
    stages.push(stageEntry);
  }

  const batch = writeBatch(db);
  batch.update(docRef, {
    status: isISGSubmission ? "approved" : data.status,
    "pipeline.currentStage": isISGSubmission ? null : "isg_distribution",
    "pipeline.stages": stages,
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: isISGSubmission ? "approved" : "pending",
    previousStatus: data.status,
    changedBy: adminId,
    remarks: isISGSubmission
      ? "Released by SAS — ISG-submitted proposal approved"
      : "Released by SAS — forwarded to ISG for distribution",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  logAdminAction({
    type: "proposal_released",
    targetCollection: "documents",
    targetId: documentId,
    targetLabel: data.title || documentId,
    remarks: isISGSubmission
      ? "ISG-submitted proposal approved"
      : "Released to ISG for distribution",
  });

  if (isISGSubmission) {
    notifyProposalUpdate({
      organizationId: data.organizationId,
      documentId,
      type: NOTIFICATION_TYPES.PROPOSAL_APPROVED,
      title: `Proposal approved: ${data.title || ""}`.trim(),
      message: `Your activity proposal "${data.title || documentId}" has been approved by SAS. You may now proceed with the planned activity.`,
    });
  } else {
    notifyProposalUpdate({
      organizationId: data.organizationId,
      documentId,
      type: NOTIFICATION_TYPES.PROPOSAL_STAGE_ADVANCED,
      title: `Proposal released to ISG: ${data.title || ""}`.trim(),
      message: `SAS has released your activity proposal "${data.title || documentId}". ISG will distribute the approved copy back to your organization shortly.`,
    });
  }
};

/**
 * SAS returns a proposal to the submitting organization for revision.
 */
export const returnFromSAS = async (documentId, adminId, remarks) => {
  const docRef = doc(db, "documents", documentId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error("Proposal not found");
  const data = docSnap.data();

  const now = Timestamp.fromDate(new Date());
  const stageEntry = {
    stage: "sas_review",
    action: "returned",
    completedAt: now,
    completedBy: adminId,
    remarks: remarks || "",
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    status: "returned",
    remarks: remarks || "",
    "pipeline.currentStage": null,
    "pipeline.stages": [...(data.pipeline?.stages || []), stageEntry],
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: "returned",
    previousStatus: data.status,
    changedBy: adminId,
    remarks: remarks || "Returned by SAS for revision",
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  logAdminAction({
    type: "proposal_returned_from_sas",
    targetCollection: "documents",
    targetId: documentId,
    targetLabel: data.title || documentId,
    remarks: remarks || "Returned by SAS for revision",
  });

  notifyProposalUpdate({
    organizationId: data.organizationId,
    documentId,
    type: NOTIFICATION_TYPES.PROPOSAL_RETURNED,
    title: `Proposal returned for revision: ${data.title || ""}`.trim(),
    message: `Your activity proposal "${data.title || documentId}" was returned by SAS for revision.${
      remarks ? ` Reviewer remarks: ${remarks}` : ""
    }`,
  });
};

/**
 * Create outgoing document (Admin only)
 * @param {Object} documentData - Document data
 * @param {string} documentData.documentType - Document type ("Memorandum", "Announcement", "Other")
 * @param {string} documentData.title - Document title/subject
 * @param {string} documentData.description - Document description
 * @param {string} documentData.orderNumber - Order number (required for Memorandum)
 * @param {File|null} file - Optional file to upload
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Created document with documentId
 */
export const createOutgoingDocument = async (documentData, file, adminId) => {
  try {
    // Validate required fields
    if (!documentData.documentType) {
      throw new Error("Document type is required");
    }

    if (!documentData.title || documentData.title.trim().length === 0) {
      throw new Error("Subject/Title is required");
    }

    if (documentData.title.length > 200) {
      throw new Error("Subject/Title must be 200 characters or less");
    }

    if (!documentData.description || documentData.description.trim().length === 0) {
      throw new Error("Description is required");
    }

    if (documentData.description.length > 1000) {
      throw new Error("Description must be 1000 characters or less");
    }

    // Validate Memorandum-specific fields
    if (documentData.documentType === "Memorandum") {
      if (!documentData.orderNumber || documentData.orderNumber.trim().length === 0) {
        throw new Error("Order Number is required for Memorandum");
      }
      if (!file) {
        throw new Error("File upload is required for Memorandum");
      }
    }

    // Create document record first (to get documentId for file upload)
    const documentsRef = collection(db, "documents");
    const documentRef = doc(documentsRef);
    const documentId = documentRef.id;

    // Validate file if provided
    let fileUrl = null;
    let fileName = null;
    let fileSize = null;

    if (file) {
      // Validate file type
      const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
      ];
      
      if (!allowedTypes.includes(file.type)) {
        throw new Error("Invalid file type. Please upload a PDF, Word document, or image file");
      }

      // Validate file size (max 50MB)
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        throw new Error("File size exceeds 50MB limit. Please upload a smaller file.");
      }

      // Upload file to Firebase Storage
      const timestamp = Date.now();
      fileName = `${documentId}_${timestamp}_${file.name}`;
      const storageRef = ref(storage, `documents/${documentId}/${fileName}`);
      
      const metadata = {
        contentType: file.type,
        customMetadata: {
          uploadedBy: adminId,
          uploadedAt: new Date().toISOString(),
          originalFileName: file.name,
          documentId: documentId
        }
      };

      const uploadSnapshot = await uploadBytes(storageRef, file, metadata);
      fileUrl = await getDownloadURL(uploadSnapshot.ref);
      fileSize = file.size;
    }

    // Use batch to create document and status history
    const batch = writeBatch(db);

    // Create document
    const docData = {
      documentId: documentId,
      documentNumber: documentData.orderNumber || null,
      organizationId: null, // Admin-created documents don't belong to an organization
      submittedBy: adminId,
      documentType: documentData.documentType,
      direction: "outgoing",
      title: documentData.title.trim(),
      description: documentData.description.trim(),
      status: "approved", // Admin-created documents are automatically approved
      remarks: "",
      assignedTo: adminId,
      dateSubmitted: serverTimestamp(),
      dateAssigned: serverTimestamp(),
      dateReviewed: serverTimestamp(),
      dateReleased: null,
      lastUpdated: serverTimestamp(),
      createdBy: adminId,
      updatedBy: adminId
    };

    if (fileUrl) {
      docData.fileUrl = fileUrl;
      docData.fileName = fileName;
      docData.fileSize = fileSize;
    }

    batch.set(documentRef, docData);

    // Create status history entry
    const historyRef = doc(collection(db, "documentStatusHistory"));
    batch.set(historyRef, {
      documentId: documentId,
      status: "approved",
      previousStatus: null,
      changedBy: adminId,
      remarks: "Document created by admin",
      timestamp: serverTimestamp()
    });

    await batch.commit();

    if (documentData.documentType === "Memorandum") {
      logAdminAction({
        type: "memorandum_created",
        targetCollection: "documents",
        targetId: documentId,
        targetLabel: documentData.title.trim(),
        remarks: documentData.orderNumber ? `Order #${documentData.orderNumber}` : null,
      });
    }

    console.log(`Outgoing document ${documentId} created successfully`);

    return {
      documentId: documentId,
      documentNumber: documentData.orderNumber || null,
      status: "approved"
    };
  } catch (error) {
    console.error("Error creating outgoing document:", error);
    throw error;
  }
};

const STAGE_OFFICE_LABEL = {
  isg_endorsement: "ISG",
  sas_review: "SAS",
  sas_release: "SAS",
  isg_distribution: "ISG",
};

/**
 * Records that the active reviewing office has opened a proposal document.
 * - Only acts when `pipeline.currentStage === expectedStage` (so monitoring views from
 *   non-active offices don't flip the badge).
 * - Increments `viewCount` on every call; stamps `firstViewedAt`/`firstViewedBy` only on first view.
 * - Appends a `documentStatusHistory` entry on first view ("Viewed by ISG"/"Viewed by SAS").
 * Fire-and-forget from callers — failures are logged, not thrown.
 */
export const markProposalFileViewed = async (documentId, userId, expectedStage) => {
  if (!documentId || !userId || !expectedStage) return;
  const docRef = doc(db, "documents", documentId);
  const historyRef = doc(collection(db, "documentStatusHistory"));
  const officeLabel = STAGE_OFFICE_LABEL[expectedStage] || expectedStage;

  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists()) return { skipped: "doc-missing" };
      const data = snap.data();
      if (data.pipeline?.currentStage !== expectedStage) {
        return { skipped: "stage-mismatch" };
      }
      const stages = Array.isArray(data.pipeline?.stages) ? [...data.pipeline.stages] : [];
      let activeIdx = -1;
      for (let i = stages.length - 1; i >= 0; i--) {
        if (stages[i]?.stage === expectedStage) { activeIdx = i; break; }
      }

      if (activeIdx === -1) {
        // No stage entry yet (e.g., isg_endorsement on a freshly submitted proposal that
        // doesn't pre-seed an entry). Create one so view tracking has a place to live.
        const isFirstView = true;
        const now = Timestamp.fromDate(new Date());
        stages.push({
          stage: expectedStage,
          action: null,
          completedAt: null,
          completedBy: null,
          firstViewedAt: now,
          firstViewedBy: userId,
          viewCount: 1,
        });
        tx.update(docRef, {
          "pipeline.stages": stages,
          lastUpdated: serverTimestamp(),
        });
        tx.set(historyRef, {
          documentId,
          status: data.status || "pending",
          previousStatus: data.status || "pending",
          changedBy: userId,
          remarks: `Viewed by ${officeLabel}`,
          timestamp: serverTimestamp(),
        });
        return { isFirstView };
      }

      const isFirstView = !stages[activeIdx].firstViewedAt;
      const now = Timestamp.fromDate(new Date());
      stages[activeIdx] = {
        ...stages[activeIdx],
        viewCount: (stages[activeIdx].viewCount || 0) + 1,
        ...(isFirstView ? { firstViewedAt: now, firstViewedBy: userId } : {}),
      };
      tx.update(docRef, {
        "pipeline.stages": stages,
        lastUpdated: serverTimestamp(),
      });
      if (isFirstView) {
        tx.set(historyRef, {
          documentId,
          status: data.status || "pending",
          previousStatus: data.status || "pending",
          changedBy: userId,
          remarks: `Viewed by ${officeLabel}`,
          timestamp: serverTimestamp(),
        });
      }
      return { isFirstView };
    });
    return result;
  } catch (error) {
    console.error("Error recording proposal view:", error);
    return { error: error.message };
  }
};

/**
 * Upload a revised version of a file on a proposal.
 * - Archives the current entry into `previousVersion` (cap at 1 prior version).
 * - Increments the entry's `version` (default 1 → 2 → 3, with `previousVersion` always
 *   holding only the most-recent prior).
 * - Resolves the listed comments with revision metadata.
 * - Bumps `revisionCount` and `dateLastRevised` on the parent doc.
 * - Appends a status-history entry describing the revision.
 *
 * @param {Object} args
 * @param {string} args.documentId
 * @param {string} args.requirementKey   - which file in `files[]` to revise
 * @param {File}   args.file             - the new file
 * @param {string} args.reason           - revision reason (free text)
 * @param {string[]} args.commentIds     - comment IDs being resolved by this revision
 * @param {string} args.userId           - uid of the org member uploading
 */
export const uploadRevision = async ({
  documentId,
  requirementKey,
  file,
  reason,
  commentIds,
  userId,
}) => {
  if (!documentId || !requirementKey || !file || !userId) {
    throw new Error("documentId, requirementKey, file, and userId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Document not found");
  const data = snap.data();

  if (data.organizationId) {
    const user = await getUserById(userId);
    if (!user || user.organizationId !== data.organizationId) {
      throw new Error("Only members of the requesting organization may upload a revision");
    }
  }

  const files = Array.isArray(data.files) ? [...data.files] : [];
  const idx = files.findIndex((f) => f.requirementKey === requirementKey);
  if (idx === -1) throw new Error("File entry not found for this requirementKey");

  const current = files[idx];
  const currentVersion = current.version || 1;
  const newVersion = currentVersion + 1;

  const storageRef = ref(
    storage,
    `documents/${documentId}/${requirementKey}/v${newVersion}_${file.name}`
  );
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      uploadedBy: userId,
      originalFileName: file.name,
      documentId,
      revisionVersion: String(newVersion),
    },
  });
  const fileUrl = await getDownloadURL(snapshot.ref);
  const uploadedAt = Timestamp.fromDate(new Date());

  // Cap at 1 prior version: previousVersion always holds the version we're about to replace.
  const previousVersion = {
    fileUrl: current.fileUrl,
    fileName: current.fileName,
    fileSize: current.fileSize || null,
    uploadedAt: current.uploadedAt || null,
    uploadedBy: current.uploadedBy || null,
    version: currentVersion,
  };

  files[idx] = {
    ...current,
    fileUrl,
    fileName: file.name,
    fileSize: file.size,
    uploadedAt,
    uploadedBy: userId,
    version: newVersion,
    revisionReason: reason?.trim() || "",
    resolvedCommentIds: Array.isArray(commentIds) ? [...commentIds] : [],
    previousVersion,
  };

  const batch = writeBatch(db);

  batch.update(docRef, {
    files,
    revisionCount: (data.revisionCount || 0) + 1,
    dateLastRevised: serverTimestamp(),
    lastUpdated: serverTimestamp(),
  });

  if (Array.isArray(commentIds)) {
    for (const commentId of commentIds) {
      const cRef = doc(db, "documents", documentId, "comments", commentId);
      batch.update(cRef, {
        resolved: true,
        resolvedByRevision: {
          version: newVersion,
          fileName: file.name,
          fileUrl,
          reason: reason?.trim() || "",
          resolvedAt: Timestamp.now(),
          resolvedBy: userId,
        },
      });
    }
  }

  const historyRef = doc(collection(db, "documentStatusHistory"));
  batch.set(historyRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: userId,
    remarks: `${REQUIREMENT_LABELS[requirementKey] || requirementKey} revised to v${newVersion}${
      reason ? `: ${reason.trim()}` : ""
    }`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  return { fileUrl, version: newVersion };
};

// ── Additional document requests (SAS-initiated during sas_review) ──────────

const ALLOWED_ADDITIONAL_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];

const validateAdditionalFile = (file) => {
  if (!file) throw new Error("File is required");
  if (!ALLOWED_ADDITIONAL_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. Upload a PDF, Word, or image file.");
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("File too large. Maximum 50 MB.");
  }
};

// A request is "open" (still blocking the pipeline) until a reviewer resolves or
// cancels it. Legacy entries used status "uploaded"; new responses use
// "responded" — both count as open/awaiting-review here.
export const isOpenAdditionalRequest = (r) =>
  r && r.status !== "resolved" && r.status !== "cancelled";

// Human-readable phrasing for what a reviewer is asking the submitter to provide.
export const REQUEST_TYPE_VERB = {
  clarification: "a clarification",
  document: "an additional document",
  both: "a revision and clarification",
};

/**
 * Reviewer (SAS admin via portal, or an office via the tokenized backend) creates
 * a new request on a proposal. Pauses the proposal in place at its current stage —
 * the submitter responds inline rather than resubmitting the whole proposal.
 *
 * `type` controls what the submitter may provide:
 *   "clarification" — written reply only
 *   "document"      — file upload only (legacy default)
 *   "both"          — written reply and/or file
 */
export const createAdditionalRequest = async ({
  documentId,
  label,
  description,
  adminId,
  type = "document",
  requestedByOffice = "SAS",
}) => {
  if (!documentId || !adminId) throw new Error("documentId and adminId are required");
  if (!label?.trim()) throw new Error("Document label is required");

  const reqType = ["clarification", "document", "both"].includes(type) ? type : "document";

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();
  const stage = data.pipeline?.currentStage;
  if (!stage) {
    throw new Error("Requests can only be raised while the proposal is in an active review stage");
  }

  const requestId = doc(collection(db, "documents")).id;
  const now = Timestamp.fromDate(new Date());
  const entry = {
    id: requestId,
    label: label.trim(),
    description: description?.trim() || "",
    type: reqType,
    stage,
    status: "pending",
    requestedBy: adminId,
    requestedByOffice,
    requestedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: [...(data.additionalRequests || []), entry],
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: adminId,
    remarks: `${requestedByOffice} requested ${REQUEST_TYPE_VERB[reqType]}: ${label.trim()}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return { requestId, request: entry };
};

/**
 * Org / ISG submitter uploads a file for an additional request. Multiple files
 * are allowed per request — each upload is appended to the request's `files[]`
 * array. Does NOT change status or notify the reviewer; the submitter finalizes
 * with a single "Send response" (respondToAdditionalRequest + notify) so the
 * office is pulled back once, not once per file.
 */
export const uploadAdditionalDocument = async ({
  documentId,
  requestId,
  file,
  userId,
}) => {
  if (!documentId || !requestId || !userId) {
    throw new Error("documentId, requestId, and userId are required");
  }
  validateAdditionalFile(file);

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();

  if (data.organizationId) {
    const user = await getUserById(userId);
    if (!user || user.organizationId !== data.organizationId) {
      throw new Error("Only members of the requesting organization may upload");
    }
  }

  const requests = Array.isArray(data.additionalRequests)
    ? [...data.additionalRequests]
    : [];
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) throw new Error("Request not found");
  const current = requests[idx];
  if (current.status !== "pending") {
    throw new Error(
      "You have already responded to this request. Wait for the reviewer to send a new request."
    );
  }

  // Normalize: legacy entries stored a single `file`; new ones use `files[]`.
  const existingFiles = Array.isArray(current.files)
    ? [...current.files]
    : current.file
    ? [current.file]
    : [];

  const storageRef = ref(
    storage,
    `documents/${documentId}/additional/${requestId}/${Date.now()}_${file.name}`
  );
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      uploadedBy: userId,
      originalFileName: file.name,
      documentId,
      additionalRequestId: requestId,
    },
  });
  const fileUrl = await getDownloadURL(snapshot.ref);
  const uploadedAt = Timestamp.fromDate(new Date());

  existingFiles.push({
    fileUrl,
    fileName: file.name,
    fileSize: file.size,
    uploadedAt,
    uploadedBy: userId,
  });

  // Drop any legacy singular `file`; `files[]` is the source of truth now.
  const { file: _legacyFile, ...rest } = current;
  requests[idx] = {
    ...rest,
    files: existingFiles,
    lastUploadedAt: uploadedAt,
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: requests,
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: userId,
    remarks: `Attached document for request "${current.label}": ${file.name}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return { fileUrl, fileCount: existingFiles.length };
};

/**
 * Org / ISG submitter finalizes their response to a request: marks it
 * "responded" and (optionally) records a written reply to the reviewer's
 * message. Called once after any files are uploaded; the caller then triggers
 * notifyReviewerOfResponse to re-notify the office.
 */
export const respondToAdditionalRequest = async ({
  documentId,
  requestId,
  responseText,
  userId,
}) => {
  if (!documentId || !requestId || !userId) {
    throw new Error("documentId, requestId, and userId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();

  if (data.organizationId) {
    const user = await getUserById(userId);
    if (!user || user.organizationId !== data.organizationId) {
      throw new Error("Only members of the requesting organization may respond");
    }
  }

  const requests = Array.isArray(data.additionalRequests)
    ? [...data.additionalRequests]
    : [];
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) throw new Error("Request not found");
  const current = requests[idx];
  if (current.status !== "pending") {
    throw new Error(
      "You have already responded to this request. Wait for the reviewer to send a new request."
    );
  }

  const now = Timestamp.fromDate(new Date());
  requests[idx] = {
    ...current,
    status: "responded",
    ...(responseText?.trim() ? { responseText: responseText.trim() } : {}),
    respondedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: requests,
    lastUpdated: serverTimestamp(),
    updatedBy: userId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: userId,
    remarks: `Submitted response to request: ${current.label}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * After the submitter has written their response to a request, ask the backend
 * to re-notify the requesting office with a fresh review link (office-stage
 * requests only). Best-effort — the response is already saved in Firestore, so
 * a notify failure must not surface as a hard error to the submitter.
 */
export const notifyReviewerOfResponse = async ({ documentId, requestId }) => {
  try {
    const res = await apiJson(
      "/api/review/respond",
      { documentId, requestId },
      { auth: true }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      console.warn("notifyReviewerOfResponse failed:", data?.error || res.status);
    }
    return data;
  } catch (err) {
    console.warn("notifyReviewerOfResponse error:", err?.message || err);
    return { success: false };
  }
};

/**
 * SAS marks an additional request as Resolved. A request can be resolved even
 * if the org never uploaded — e.g. SAS got verbal clarification and no longer
 * needs the document. This is what unblocks Forward-to-VPAA.
 */
export const resolveAdditionalRequest = async ({
  documentId,
  requestId,
  adminId,
  note,
}) => {
  if (!documentId || !requestId || !adminId) {
    throw new Error("documentId, requestId, and adminId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();
  if (data.pipeline?.currentStage !== "sas_review") {
    throw new Error("Requests can only be resolved during SAS review");
  }

  const requests = Array.isArray(data.additionalRequests)
    ? [...data.additionalRequests]
    : [];
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) throw new Error("Request not found");
  const current = requests[idx];
  if (current.status === "resolved" || current.status === "cancelled") return;

  const now = Timestamp.fromDate(new Date());
  requests[idx] = {
    ...current,
    status: "resolved",
    resolvedBy: adminId,
    resolvedAt: now,
    resolveNote: note?.trim() || "",
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: requests,
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: adminId,
    remarks: `Resolved additional document request: ${current.label}${
      note ? ` — ${note.trim()}` : ""
    }`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * SAS reopens a previously resolved request (in case they change their mind
 * before forwarding).
 */
export const reopenAdditionalRequest = async ({
  documentId,
  requestId,
  adminId,
}) => {
  if (!documentId || !requestId || !adminId) {
    throw new Error("documentId, requestId, and adminId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();
  if (data.pipeline?.currentStage !== "sas_review") {
    throw new Error("Requests can only be reopened during SAS review");
  }

  const requests = Array.isArray(data.additionalRequests)
    ? [...data.additionalRequests]
    : [];
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) throw new Error("Request not found");
  const current = requests[idx];

  // Reopen makes the request answerable again — the org may respond afresh.
  const nextStatus = "pending";
  requests[idx] = {
    ...current,
    status: nextStatus,
    resolvedBy: null,
    resolvedAt: null,
    resolveNote: "",
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: requests,
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: adminId,
    remarks: `Reopened additional document request: ${current.label}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * SAS cancels an additional request entirely (removes it from the open list).
 * Cancelled requests don't block forwarding.
 */
export const cancelAdditionalRequest = async ({
  documentId,
  requestId,
  adminId,
}) => {
  if (!documentId || !requestId || !adminId) {
    throw new Error("documentId, requestId, and adminId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();
  if (data.pipeline?.currentStage !== "sas_review") {
    throw new Error("Requests can only be cancelled during SAS review");
  }

  const requests = Array.isArray(data.additionalRequests)
    ? [...data.additionalRequests]
    : [];
  const idx = requests.findIndex((r) => r.id === requestId);
  if (idx === -1) throw new Error("Request not found");
  const current = requests[idx];

  const now = Timestamp.fromDate(new Date());
  requests[idx] = {
    ...current,
    status: "cancelled",
    cancelledBy: adminId,
    cancelledAt: now,
  };

  const batch = writeBatch(db);
  batch.update(docRef, {
    additionalRequests: requests,
    lastUpdated: serverTimestamp(),
    updatedBy: adminId,
  });

  const histRef = doc(collection(db, "documentStatusHistory"));
  batch.set(histRef, {
    documentId,
    status: data.status || "pending",
    previousStatus: data.status || "pending",
    changedBy: adminId,
    remarks: `Cancelled additional document request: ${current.label}`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
};

/**
 * Admin permanently deletes a REJECTED (or legacy returned) activity proposal and
 * its related records (status history, comments subcollection). Restricted to
 * rejected/returned proposals so active/approved ones can't be removed by mistake.
 * Firestore rules already gate document deletes to admins.
 */
export const deleteProposal = async (documentId, adminId) => {
  if (!documentId || !adminId) {
    throw new Error("documentId and adminId are required");
  }

  const docRef = doc(db, "documents", documentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Proposal not found");
  const data = snap.data();
  if (data.status !== "rejected" && data.status !== "returned") {
    throw new Error("Only rejected proposals can be deleted.");
  }

  const batch = writeBatch(db);

  // Status-history entries (top-level collection keyed by documentId).
  const histSnap = await getDocs(
    query(collection(db, "documentStatusHistory"), where("documentId", "==", documentId))
  );
  histSnap.forEach((d) => batch.delete(d.ref));

  // Inline comments subcollection.
  const commentsSnap = await getDocs(
    collection(db, "documents", documentId, "comments")
  );
  commentsSnap.forEach((d) => batch.delete(d.ref));

  // The proposal document itself.
  batch.delete(docRef);

  await batch.commit();

  // NOTE: reviewTokens are intentionally NOT deleted here — Firestore rules lock
  // them to the Admin SDK (client read/delete denied). Orphaned tokens are inert:
  // the review endpoints 404 once the proposal document no longer exists.

  logAdminAction({
    type: "proposal_deleted",
    targetCollection: "documents",
    targetId: documentId,
    targetLabel: data.title || documentId,
    remarks: "Returned activity proposal deleted",
  });
};
