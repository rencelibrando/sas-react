import { useState, useEffect, useMemo } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import {
  listEquipment,
  createEquipment,
  updateEquipment,
  setEquipmentActive,
  seedQuantityOnHand,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
} from "../services/equipmentService";
import { migrateApprovedReservations } from "../services/equipmentRequestService";
import AdminLayout from "../components/admin/AdminLayout";
import LoadingScreen from "../components/LoadingScreen";
import "../styles/colors.css";
import "./AdminEquipmentInventory.css";

const INITIAL_FORM = {
  name: "",
  description: "",
  category: "sound",
  totalQuantity: 1,
  condition: "",
};

const AdminEquipmentInventory = () => {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadItems = async () => {
    const all = await listEquipment();
    setItems(all);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        setUserData(userDoc);
        if (userDoc?.role !== "Admin") return;
        // Migrate existing docs that pre-date the quantityOnHand field.
        await seedQuantityOnHand(user.uid).catch((err) =>
          console.warn("seedQuantityOnHand failed (non-fatal):", err)
        );
        // Deduct quantityOnHand for approved requests that pre-date the
        // "deduct at approval" model (idempotent, skips already-migrated docs).
        await migrateApprovedReservations(user.uid).catch((err) =>
          console.warn("migrateApprovedReservations failed (non-fatal):", err)
        );
        await loadItems();
      } catch (err) {
        console.error("Error loading equipment inventory:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (!showInactive && it.isActive === false) return false;
      if (categoryFilter !== "all" && it.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = it.name?.toLowerCase().includes(q);
        const matchDesc = it.description?.toLowerCase().includes(q);
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });
  }, [items, searchQuery, categoryFilter, showInactive]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(INITIAL_FORM);
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (item) => {
    setEditingId(item.equipmentId);
    setForm({
      name: item.name || "",
      description: item.description || "",
      category: item.category || "other",
      totalQuantity: item.totalQuantity ?? 0,
      condition: item.condition || "",
    });
    setFormError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(INITIAL_FORM);
    setFormError("");
  };

  const handleSave = async () => {
    if (saving) return;
    setFormError("");
    if (!form.name.trim()) {
      setFormError("Equipment name is required");
      return;
    }
    const adminId = auth.currentUser?.uid;
    if (!adminId) {
      setFormError("Not signed in");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateEquipment(editingId, form, adminId);
      } else {
        await createEquipment(form, adminId);
      }
      await loadItems();
      closeModal();
    } catch (err) {
      console.error("Error saving equipment:", err);
      setFormError(err.message || "Failed to save equipment");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item) => {
    const adminId = auth.currentUser?.uid;
    if (!adminId) return;
    const nextActive = !(item.isActive ?? true);
    const confirmMsg = nextActive
      ? `Reactivate "${item.name}"? Requesters will be able to select it again.`
      : `Deactivate "${item.name}"? Requesters won't see it in the picker, but existing requests are unaffected.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await setEquipmentActive(item.equipmentId, nextActive, adminId);
      await loadItems();
    } catch (err) {
      console.error("Error toggling equipment active state:", err);
      alert(err.message || "Failed to update equipment");
    }
  };

  if (userData && userData.role !== "Admin") {
    return (
      <div className="admin-dashboard-blocked">
        <div className="blocked-message">
          <h2>Access Denied</h2>
          <p>You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout userData={userData} currentPage="equipment-inventory">
      {loading ? (
        <LoadingScreen compact={true} />
      ) : (
        <div className="admin-equipment-inventory">
          <div className="equip-inv-header">
            <div>
              <h1 className="equip-inv-title">Equipment Inventory</h1>
              <p className="equip-inv-subtitle">
                Manage the catalog of items organizations can borrow.
              </p>
            </div>
            <button className="equip-create-btn" onClick={openCreateModal}>
              + Add Equipment
            </button>
          </div>

          <div className="equip-controls">
            <div className="equip-tabs">
              <button
                className={`equip-tab ${categoryFilter === "all" ? "active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                All
              </button>
              {EQUIPMENT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`equip-tab ${categoryFilter === cat ? "active" : ""}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {EQUIPMENT_CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
            <div className="equip-controls-right">
              <label className="equip-show-inactive">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Show inactive
              </label>
              <input
                type="text"
                className="equip-search"
                placeholder="Search name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="equip-table-wrapper">
            {filteredItems.length === 0 ? (
              <div className="equip-empty">
                <p>No equipment matches your filters.</p>
              </div>
            ) : (
              <table className="equip-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>On Hand</th>
                    <th>Total Stock</th>
                    <th>Condition</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isActive = item.isActive !== false;
                    return (
                      <tr key={item.equipmentId} className={isActive ? "" : "inactive-row"}>
                        <td>
                          <div className="equip-name">{item.name}</div>
                          {item.description && (
                            <div className="equip-desc">{item.description}</div>
                          )}
                        </td>
                        <td>{EQUIPMENT_CATEGORY_LABELS[item.category] || item.category}</td>
                        <td>
                          {item.quantityOnHand ?? item.totalQuantity ?? 0}
                        </td>
                        <td>{item.totalQuantity ?? 0}</td>
                        <td>{item.condition || "—"}</td>
                        <td>
                          <span
                            className={`equip-status-badge ${isActive ? "active" : "inactive"}`}
                          >
                            {isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="equip-actions-cell">
                          <button className="equip-edit-btn" onClick={() => openEditModal(item)}>
                            Edit
                          </button>
                          <button
                            className={`equip-toggle-btn ${isActive ? "deactivate" : "activate"}`}
                            onClick={() => handleToggleActive(item)}
                          >
                            {isActive ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {showModal && (
            <div className="equip-modal-overlay" onClick={closeModal}>
              <div className="equip-modal" onClick={(e) => e.stopPropagation()}>
                <div className="equip-modal-header">
                  <h3>{editingId ? "Edit Equipment" : "Add Equipment"}</h3>
                  <button className="equip-modal-close" onClick={closeModal}>
                    ×
                  </button>
                </div>
                <div className="equip-modal-body">
                  {formError && <div className="equip-form-error">{formError}</div>}
                  <div className="equip-form-group">
                    <label htmlFor="equip-name">Name *</label>
                    <input
                      id="equip-name"
                      type="text"
                      value={form.name}
                      maxLength={120}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Yamaha PA Speakers"
                    />
                  </div>
                  <div className="equip-form-group">
                    <label htmlFor="equip-category">Category</label>
                    <select
                      id="equip-category"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      {EQUIPMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {EQUIPMENT_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="equip-form-group">
                    <label htmlFor="equip-qty">Total quantity on hand</label>
                    <input
                      id="equip-qty"
                      type="number"
                      min="0"
                      value={form.totalQuantity}
                      onChange={(e) =>
                        setForm({ ...form, totalQuantity: e.target.value })
                      }
                    />
                  </div>
                  <div className="equip-form-group">
                    <label htmlFor="equip-condition">Default condition</label>
                    <input
                      id="equip-condition"
                      type="text"
                      value={form.condition}
                      maxLength={200}
                      onChange={(e) => setForm({ ...form, condition: e.target.value })}
                      placeholder="e.g., Good, fully functional"
                    />
                  </div>
                  <div className="equip-form-group">
                    <label htmlFor="equip-desc">Description</label>
                    <textarea
                      id="equip-desc"
                      rows={3}
                      maxLength={1000}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Notes, specs, serial numbers, etc."
                    />
                  </div>
                </div>
                <div className="equip-modal-footer">
                  <button className="equip-btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button className="equip-btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : editingId ? "Save changes" : "Create"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminEquipmentInventory;
