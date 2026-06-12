import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../config/firebase";
import { logAdminAction } from "./adminActivityLogService";

/**
 * Get dashboard statistics (proposals + incoming docs + account counts)
 */
export const getDashboardStats = async () => {
  try {
    const usersRef = collection(db, "users");

    const allUsersSnapshot = await getDocs(usersRef);
    const allUsers = [];
    allUsersSnapshot.forEach((doc) => {
      allUsers.push(doc.data());
    });

    const stats = {
      totalUsers: allUsers.length,
      adminUsers: allUsers.filter(u => u.role === "Admin").length
    };

    try {
      const documentsRef = collection(db, "documents");
      const docsSnapshot = await getDocs(documentsRef);
      const allDocs = [];
      docsSnapshot.forEach((doc) => {
        allDocs.push(doc.data());
      });

      stats.pendingProposals = allDocs.filter(
        d => d.documentType === "activity_proposal" &&
        (d.status === "pending" || d.status === "under_review")
      ).length;

      stats.incomingDocuments = allDocs.filter(d => d.direction === "incoming").length;
    } catch (error) {
      console.error("Error fetching document stats:", error);
      stats.pendingProposals = 0;
      stats.incomingDocuments = 0;
    }

    return stats;
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    throw error;
  }
};

/**
 * Update user status (activate/deactivate)
 */
export const updateUserStatus = async (userId, status) => {
  try {
    const userRef = doc(db, "users", userId);
    const before = await getDoc(userRef);
    await updateDoc(userRef, {
      status: status,
      lastUpdated: serverTimestamp()
    });
    logAdminAction({
      type: "user_status_changed",
      targetCollection: "users",
      targetId: userId,
      targetLabel: before.exists()
        ? before.data().fullName || before.data().email || userId
        : userId,
      before: before.exists() ? { status: before.data().status } : null,
      after: { status },
    });
    console.log(`User ${userId} status updated to ${status}`);
  } catch (error) {
    console.error("Error updating user status:", error);
    throw error;
  }
};
