import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { logAdminAction } from "./adminActivityLogService";

/**
 * Get all active organizations filtered by type
 * @param {string} type - "ISG" | "CSG" | "AO"
 * @returns {Promise<Array>} Array of organization objects
 */
export const getOrganizationsByType = async (type) => {
  try {
    const organizationsRef = collection(db, "organizations");
    const q = query(
      organizationsRef,
      where("type", "==", type),
      where("status", "==", "active")
    );
    
    const querySnapshot = await getDocs(q);
    const organizations = [];
    const seenIds = new Set(); // Track seen organization IDs
    const seenNames = new Set(); // Track seen organization names (for additional deduplication)
    
    querySnapshot.forEach((doc) => {
      const orgId = doc.id;
      const orgData = doc.data();
      const orgName = orgData.name;
      
      // Deduplicate by both ID and name to handle edge cases
      if (!seenIds.has(orgId) && !seenNames.has(orgName)) {
        seenIds.add(orgId);
        seenNames.add(orgName);
        organizations.push({
          organizationId: orgId,
          ...orgData
        });
      }
    });
    
    // Sort alphabetically by name (client-side sorting to avoid index requirement)
    organizations.sort((a, b) => a.name.localeCompare(b.name));
    
    return organizations;
  } catch (error) {
    console.error("Error fetching organizations:", error);
    throw error;
  }
};

/**
 * Get a single organization by ID
 * @param {string} organizationId - Organization document ID
 * @returns {Promise<Object|null>} Organization object or null
 */
export const getOrganizationById = async (organizationId) => {
  try {
    const orgDoc = doc(db, "organizations", organizationId);
    const orgSnapshot = await getDoc(orgDoc);
    
    if (orgSnapshot.exists()) {
      return {
        organizationId: orgSnapshot.id,
        ...orgSnapshot.data()
      };
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching organization:", error);
    throw error;
  }
};

/**
 * Get all active organizations (all types)
 * @returns {Promise<Array>} Array of all organization objects
 */
export const getAllOrganizations = async () => {
  try {
    const organizationsRef = collection(db, "organizations");
    const q = query(
      organizationsRef,
      where("status", "==", "active")
    );
    
    const querySnapshot = await getDocs(q);
    const organizations = [];
    const seenIds = new Set(); // Track seen organization IDs to prevent duplicates
    
    querySnapshot.forEach((doc) => {
      const orgId = doc.id;
      // Only add if we haven't seen this ID before
      if (!seenIds.has(orgId)) {
        seenIds.add(orgId);
        organizations.push({
          organizationId: orgId,
          ...doc.data()
        });
      }
    });
    
    // Sort by type first, then by name (client-side sorting to avoid index requirement)
    organizations.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return a.name.localeCompare(b.name);
    });
    
    return organizations;
  } catch (error) {
    console.error("Error fetching all organizations:", error);
    throw error;
  }
};

/**
 * Get all organizations (including inactive ones) for admin management
 * @returns {Promise<Array>} Array of all organization objects
 */
export const getAllOrganizationsForAdmin = async () => {
  try {
    const organizationsRef = collection(db, "organizations");
    const querySnapshot = await getDocs(organizationsRef);
    const organizations = [];
    const seenIds = new Set();
    
    querySnapshot.forEach((doc) => {
      const orgId = doc.id;
      if (!seenIds.has(orgId)) {
        seenIds.add(orgId);
        organizations.push({
          organizationId: orgId,
          ...doc.data()
        });
      }
    });
    
    // Sort by dateCreated (most recent first), then by type, then by name
    organizations.sort((a, b) => {
      const aDate = a.dateCreated?.toDate?.() || new Date(0);
      const bDate = b.dateCreated?.toDate?.() || new Date(0);
      if (bDate.getTime() !== aDate.getTime()) {
        return bDate - aDate; // Most recent first
      }
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return a.name.localeCompare(b.name);
    });
    
    return organizations;
  } catch (error) {
    console.error("Error fetching all organizations for admin:", error);
    throw error;
  }
};

/**
 * Increment the late-return counter for an org and return the updated doc data.
 */
export const recordLateReturn = async (organizationId) => {
  if (!organizationId) return null;
  const orgRef = doc(db, "organizations", organizationId);
  await updateDoc(orgRef, {
    lateReturnCount: increment(1),
    lastUpdated: serverTimestamp(),
  });
  const snap = await getDoc(orgRef);
  return snap.exists() ? snap.data() : null;
};

/**
 * Set or clear the borrowing restriction on an org.
 * Clearing also resets lateReturnCount to 0.
 */
export const setBorrowingRestriction = async (organizationId, restricted, adminId = null) => {
  if (!organizationId) return;
  const orgRef = doc(db, "organizations", organizationId);
  const patch = restricted
    ? { borrowingRestricted: true, borrowingRestrictedAt: serverTimestamp(), lastUpdated: serverTimestamp() }
    : { borrowingRestricted: false, borrowingRestrictedAt: null, lateReturnCount: 0, lastUpdated: serverTimestamp() };
  await updateDoc(orgRef, patch);
  if (!restricted && adminId) {
    const before = await getDoc(orgRef);
    logAdminAction({
      type: "org_updated",
      targetCollection: "organizations",
      targetId: organizationId,
      targetLabel: before.exists() ? before.data().name || organizationId : organizationId,
      before: { borrowingRestricted: true },
      after: { borrowingRestricted: false, lateReturnCount: 0 },
      remarks: "Borrowing restriction cleared by admin",
    });
  }
};

/**
 * Update organization status
 * @param {string} organizationId - Organization document ID
 * @param {string} status - "active" | "inactive"
 * @returns {Promise<void>}
 */
export const updateOrganizationStatus = async (organizationId, status) => {
  try {
    const orgRef = doc(db, "organizations", organizationId);
    const before = await getDoc(orgRef);
    await updateDoc(orgRef, {
      status: status,
      lastUpdated: serverTimestamp()
    });
    logAdminAction({
      type: "org_updated",
      targetCollection: "organizations",
      targetId: organizationId,
      targetLabel: before.exists() ? before.data().name || organizationId : organizationId,
      before: before.exists() ? { status: before.data().status } : null,
      after: { status },
      remarks: `Status changed to ${status}`,
    });
    console.log(`Organization ${organizationId} status updated to ${status}`);
  } catch (error) {
    console.error("Error updating organization status:", error);
    throw error;
  }
};

