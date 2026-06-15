import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteField,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";

export const getOfficeProfile = async (officeId) => {
  const snap = await getDoc(doc(db, "officeProfiles", officeId));
  if (!snap.exists()) return null;
  return { officeId: snap.id, ...snap.data() };
};

export const getAllOfficeProfiles = async () => {
  const snap = await getDocs(collection(db, "officeProfiles"));
  return snap.docs.map((d) => ({ officeId: d.id, ...d.data() }));
};

/**
 * Create or update an office profile (upsert).
 * @param {string} officeId - Document ID, e.g. "vpaa" or "op"
 * @param {{ name?: string, email?: string, role?: string }} data
 * @param {string} adminUserId - UID of the admin making the change
 * @param {{ clearSignature?: boolean }} [options] - when clearSignature is true,
 *   the stored e-signature fields are removed (used when the office's email — and
 *   therefore the holder — changes, since the old signature no longer applies).
 */
export const upsertOfficeProfile = async (
  officeId,
  data,
  adminUserId,
  { clearSignature = false } = {}
) => {
  const ref = doc(db, "officeProfiles", officeId);
  await setDoc(
    ref,
    {
      ...data,
      ...(clearSignature
        ? {
            signatureUrl: deleteField(),
            signatureMime: deleteField(),
            signatureUploadedAt: deleteField(),
          }
        : {}),
      officeId,
      updatedBy: adminUserId,
      lastUpdated: serverTimestamp(),
    },
    { merge: true }
  );
};
