import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
  increment,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { logAdminAction } from "./adminActivityLogService";

/**
 * Equipment Service
 *
 * Admin-managed catalog of borrowable equipment/items.
 * Used by:
 *   - AdminEquipmentInventory page (CRUD)
 *   - EquipmentItemPicker subcomponent (requester picks active items)
 */

const VALID_CATEGORIES = ["sound", "venue", "av", "furniture", "other"];

const sanitizeQuantity = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

const sanitizeText = (raw, max = 200) => {
  const s = (raw || "").toString().trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
};

/**
 * List equipment items.
 * @param {Object} options
 * @param {boolean} [options.activeOnly=false] - only return active items
 */
export const listEquipment = async ({ activeOnly = false } = {}) => {
  const equipRef = collection(db, "equipment");
  const q = activeOnly
    ? query(equipRef, where("isActive", "==", true), orderBy("name", "asc"))
    : query(equipRef, orderBy("name", "asc"));

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ equipmentId: d.id, ...d.data() }));
};

export const getEquipmentById = async (equipmentId) => {
  const ref = doc(db, "equipment", equipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { equipmentId: snap.id, ...snap.data() };
};

/**
 * Create a new equipment item. Admin only.
 */
export const createEquipment = async (payload, adminId) => {
  const name = sanitizeText(payload.name, 120);
  if (!name) throw new Error("Equipment name is required");

  const category = VALID_CATEGORIES.includes(payload.category)
    ? payload.category
    : "other";
  const totalQuantity = sanitizeQuantity(payload.totalQuantity);
  const description = sanitizeText(payload.description, 1000);
  const condition = sanitizeText(payload.condition, 200);

  const equipRef = doc(collection(db, "equipment"));
  const batch = writeBatch(db);
  batch.set(equipRef, {
    equipmentId: equipRef.id,
    name,
    description,
    category,
    totalQuantity,
    quantityOnHand: totalQuantity,
    condition,
    isActive: true,
    createdAt: serverTimestamp(),
    createdBy: adminId,
    updatedAt: serverTimestamp(),
    updatedBy: adminId,
  });
  await batch.commit();
  logAdminAction({
    type: "equipment_created",
    targetCollection: "equipment",
    targetId: equipRef.id,
    targetLabel: name,
    after: { name, category, totalQuantity, quantityOnHand: totalQuantity, condition },
  });
  return { equipmentId: equipRef.id };
};

/**
 * Update an existing equipment item. Pass only the fields to change.
 */
export const updateEquipment = async (equipmentId, updates, adminId) => {
  if (!equipmentId) throw new Error("equipmentId is required");
  const ref = doc(db, "equipment", equipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Equipment not found");

  const patch = {
    updatedAt: serverTimestamp(),
    updatedBy: adminId,
  };

  if (updates.name !== undefined) {
    const name = sanitizeText(updates.name, 120);
    if (!name) throw new Error("Equipment name cannot be empty");
    patch.name = name;
  }
  if (updates.description !== undefined) {
    patch.description = sanitizeText(updates.description, 1000);
  }
  if (updates.category !== undefined) {
    patch.category = VALID_CATEGORIES.includes(updates.category)
      ? updates.category
      : "other";
  }
  if (updates.totalQuantity !== undefined) {
    patch.totalQuantity = sanitizeQuantity(updates.totalQuantity);
    // Keep quantityOnHand in sync when admin manually adjusts totalQuantity
    // (only if quantityOnHand isn't already being managed by borrowing flow).
    const existing = snap.data();
    if (existing.quantityOnHand === undefined) {
      // First-time migration: seed quantityOnHand from the old totalQuantity.
      patch.quantityOnHand = patch.totalQuantity;
    }
  }
  if (updates.condition !== undefined) {
    patch.condition = sanitizeText(updates.condition, 200);
  }
  if (updates.isActive !== undefined) {
    patch.isActive = Boolean(updates.isActive);
  }

  const before = snap.data();
  const batch = writeBatch(db);
  batch.update(ref, patch);
  await batch.commit();

  const isToggleOnly =
    Object.keys(updates).length === 1 && updates.isActive !== undefined;
  logAdminAction({
    type: isToggleOnly
      ? (updates.isActive ? "equipment_updated" : "equipment_deleted")
      : "equipment_updated",
    targetCollection: "equipment",
    targetId: equipmentId,
    targetLabel: patch.name || before.name || null,
    before: {
      name: before.name,
      category: before.category,
      totalQuantity: before.totalQuantity,
      isActive: before.isActive,
    },
    after: patch,
  });
};

/**
 * Toggle the active flag — preferred over deletion so historical requests
 * retain their item references.
 */
export const setEquipmentActive = async (equipmentId, isActive, adminId) => {
  return updateEquipment(equipmentId, { isActive }, adminId);
};

/**
 * Atomically adjust the quantityOnHand for a single equipment item.
 * delta > 0 means items are being returned (added back).
 * delta < 0 means items are being borrowed (removed).
 *
 * Runs inside an existing WriteBatch when one is provided, otherwise commits
 * immediately.
 *
 * @param {import('firebase/firestore').WriteBatch | null} batch  Existing batch or null.
 * @param {string} equipmentId
 * @param {number} delta  e.g. -2 to deduct 2, +2 to restore 2.
 * @param {string} adminId
 */
export const adjustEquipmentQuantityOnHand = (batch, equipmentId, delta, adminId) => {
  if (!equipmentId || delta === 0) return;
  const ref = doc(db, "equipment", equipmentId);
  const patch = {
    quantityOnHand: increment(delta),
    updatedAt: serverTimestamp(),
    updatedBy: adminId,
  };
  if (batch) {
    batch.update(ref, patch);
  }
  // When no batch is supplied callers should use the returned ref+patch
  // to do a standalone update — not needed for our current use-cases.
};

/**
 * Seed quantityOnHand for existing equipment documents that pre-date this
 * field (one-time migration; safe to run multiple times).
 * Call this once from an admin action or on app start.
 */
export const seedQuantityOnHand = async (adminId) => {
  const snap = await getDocs(collection(db, "equipment"));
  const batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.quantityOnHand === undefined) {
      batch.update(d.ref, {
        quantityOnHand: sanitizeQuantity(data.totalQuantity),
        updatedAt: serverTimestamp(),
        updatedBy: adminId || "system",
      });
      count++;
    }
  }
  if (count > 0) await batch.commit();
  return count;
};

export const EQUIPMENT_CATEGORIES = VALID_CATEGORIES;

export const EQUIPMENT_CATEGORY_LABELS = {
  sound: "Sound System",
  venue: "Venue",
  av: "Audio/Visual",
  furniture: "Furniture",
  other: "Other",
};
