import { 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
  query,
  where,
  getDocs
} from "firebase/firestore";
import { updateEmail, deleteUser } from "firebase/auth";
import { db, auth } from "../config/firebase";

/**
 * Create a new user document in Firestore
 * @param {string} userId - Firebase Auth UID
 * @param {Object} userData - User data object
 * @param {string} userData.fullName - User's full name
 * @param {string} userData.email - User's email
 * @param {string} userData.role - "ISG" | "CSG" | "AO" (organization type)
 * @param {string} userData.organizationId - Organization document ID
 * @param {string} userData.userRole - User's position/role in their organization
 * @returns {Promise<void>}
 */
export const createUserDocument = async (userId, userData) => {
  try {
    const userRef = doc(db, "users", userId);
    
    await setDoc(userRef, {
      userId: userId,
      fullName: userData.fullName,
      email: userData.email,
      role: userData.role,
      organizationId: userData.organizationId,
      userRole: userData.userRole, // User's position/role in organization
      status: "active",
      dateCreated: serverTimestamp(),
      lastLogin: null
    });
    
    console.log("User document created successfully");
  } catch (error) {
    console.error("Error creating user document:", error);
    throw error;
  }
};

/**
 * Create organization account (admin only)
 * @param {string} userId - Firebase Auth UID
 * @param {Object} userData - User data object
 * @param {string} userData.email - User's email
 * @param {string} userData.role - "ISG" | "CSG" | "AO" (organization type)
 * @param {string} userData.organizationId - Organization document ID
 * @returns {Promise<void>}
 */
export const createOrganizationAccount = async (userId, userData) => {
  try {
    const userRef = doc(db, "users", userId);
    
    await setDoc(userRef, {
      userId: userId,
      fullName: userData.organizationName || "Organization Account",
      email: userData.email,
      role: userData.role,
      organizationId: userData.organizationId,
      userRole: "Officer", // Default role for org accounts
      status: "active",
      dateCreated: serverTimestamp(),
      lastLogin: null
    });
    
    console.log("Organization account created successfully");
  } catch (error) {
    console.error("Error creating organization account:", error);
    throw error;
  }
};

/**
 * Get user document by ID
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<Object|null>} User object or null
 */
export const getUserById = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    const userSnapshot = await getDoc(userRef);
    
    if (userSnapshot.exists()) {
      return {
        userId: userSnapshot.id,
        ...userSnapshot.data()
      };
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching user:", error);
    throw error;
  }
};

/**
 * Get user document by email
 * @param {string} email - User's email address
 * @returns {Promise<Object|null>} User object or null
 */
export const getUserByEmail = async (email) => {
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const userDoc = querySnapshot.docs[0];
      return {
        userId: userDoc.id,
        ...userDoc.data()
      };
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching user by email:", error);
    throw error;
  }
};

/**
 * Update user's last login timestamp
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<void>}
 */
export const updateLastLogin = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      lastLogin: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating last login:", error);
    // Don't throw - this is a non-critical update
  }
};

/**
 * Update user password
 * @param {string} newPassword - New password
 * @returns {Promise<void>}
 */
export const updateUserPassword = async (newPassword) => {
  try {
    const { updatePassword } = await import("firebase/auth");
    const user = auth.currentUser;
    if (!user) {
      throw new Error("User not authenticated");
    }
    await updatePassword(user, newPassword);
    console.log("Password updated successfully");
  } catch (error) {
    console.error("Error updating password:", error);
    throw error;
  }
};

/**
 * Update user email
 * @param {string} newEmail - New email address
 * @returns {Promise<void>}
 */
/**
 * Stamp `privacyConsentAt` on the current user's doc. Called when the
 * first-login ConsentModal is accepted.
 */
export const recordPrivacyConsent = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");
  const userRef = doc(db, "users", user.uid);
  await updateDoc(userRef, {
    privacyConsentAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
  });
};

/**
 * Replace the user's notificationPreferences map. Pass the full
 * { [category]: { inApp, email } } object. The caller is responsible for
 * building it from DEFAULT_NOTIFICATION_PREFERENCES + their toggles.
 */
export const updateNotificationPreferences = async (preferences) => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");
  const userRef = doc(db, "users", user.uid);
  await updateDoc(userRef, {
    notificationPreferences: preferences,
    lastUpdated: serverTimestamp(),
  });
};

export const updateUserEmail = async (newEmail) => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Update email in Firebase Auth
    await updateEmail(user, newEmail);
    
    // Update email in Firestore user document
    const userRef = doc(db, "users", user.uid);
    await updateDoc(userRef, {
      email: newEmail,
      lastUpdated: serverTimestamp()
    });
    
    console.log("Email updated successfully");
  } catch (error) {
    console.error("Error updating email:", error);
    throw error;
  }
};

/**
 * Get all admin/staff user accounts
 * @returns {Promise<Array>} Array of user objects with role "Admin"
 */
export const getAllAdminUsers = async () => {
  try {
    const usersRef = collection(db, "users");
    const querySnapshot = await getDocs(usersRef);
    const users = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.role === "Admin") {
        users.push({ userId: docSnap.id, ...data });
      }
    });

    users.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    return users;
  } catch (error) {
    console.error("Error fetching admin users:", error);
    throw error;
  }
};

/**
 * Get all non-admin user accounts (org/office accounts)
 * @returns {Promise<Array>} Array of user objects
 */
export const getAllOrgUsers = async () => {
  try {
    const usersRef = collection(db, "users");
    const querySnapshot = await getDocs(usersRef);
    const users = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.role !== "Admin") {
        users.push({ userId: docSnap.id, ...data });
      }
    });

    users.sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return (a.fullName || "").localeCompare(b.fullName || "");
    });

    return users;
  } catch (error) {
    console.error("Error fetching org users:", error);
    throw error;
  }
};

/**
 * Delete user account
 * Deletes user from Firebase Auth and Firestore
 * Note: This may require special permissions in Firestore rules
 * @returns {Promise<void>}
 */
export const deleteUserAccount = async () => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("User not authenticated");
    }

    const userId = user.uid;

    // Delete user document from Firestore
    // Note: This may fail if Firestore rules don't allow user to delete their own document
    // In that case, you may want to mark the account as deleted instead
    try {
      const userRef = doc(db, "users", userId);
      await deleteDoc(userRef);
      console.log("User document deleted from Firestore");
    } catch (firestoreError) {
      console.warn("Could not delete user document from Firestore:", firestoreError);
      // If deletion fails due to permissions, mark as deleted instead
      try {
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, {
          status: "deleted",
          deletedAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });
        console.log("User document marked as deleted");
      } catch (updateError) {
        console.error("Could not mark user as deleted:", updateError);
        // Continue with Auth deletion even if Firestore update fails
      }
    }

    // Delete user from Firebase Auth
    await deleteUser(user);
    console.log("User account deleted successfully");
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
};

