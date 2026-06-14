import { useState, useEffect, useMemo } from "react";
import {
  listEquipment,
  EQUIPMENT_CATEGORY_LABELS,
} from "../../services/equipmentService";

/**
 * EquipmentItemPicker
 *
 * Loads the active equipment catalog and lets the requester build a wishlist
 * of items + quantity. Quantities are advisory (validated client-side against
 * catalog totalQuantity); SAS does the authoritative availability check.
 *
 * Props:
 *   - value: Array<{ equipmentId, name, quantity, remarks }>
 *   - onChange: (next) => void
 */
const EquipmentItemPicker = ({ value = [], onChange }) => {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedQty, setSelectedQty] = useState(1);
  const [selectedRemarks, setSelectedRemarks] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const items = await listEquipment({ activeOnly: true });
        if (!cancelled) setCatalog(items);
      } catch (err) {
        console.error("Failed to load equipment catalog:", err);
        if (!cancelled) setError("Could not load equipment list");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogById = useMemo(() => {
    const m = new Map();
    for (const it of catalog) m.set(it.equipmentId, it);
    return m;
  }, [catalog]);

  const selectedRows = value;
  const alreadyPicked = useMemo(
    () => new Set(selectedRows.map((r) => r.equipmentId)),
    [selectedRows]
  );

  const availableCatalog = useMemo(
    () => catalog.filter((c) => !alreadyPicked.has(c.equipmentId)),
    [catalog, alreadyPicked]
  );

  const addRow = () => {
    setAddError("");
    if (!selectedId) return;
    const item = catalogById.get(selectedId);
    if (!item) return;
    const availableQty = item.quantityOnHand ?? item.totalQuantity ?? 0;
    const qty = Math.max(1, Math.floor(Number(selectedQty) || 1));
    if (qty > availableQty) {
      setAddError(`Cannot add more than ${availableQty} available items.`);
      return;
    }
    onChange([
      ...selectedRows,
      {
        equipmentId: item.equipmentId,
        name: item.name,
        quantity: qty,
        remarks: selectedRemarks.trim(),
      },
    ]);
    setSelectedId("");
    setSelectedQty(1);
    setSelectedRemarks("");
  };

  const removeRow = (equipmentId) => {
    onChange(selectedRows.filter((r) => r.equipmentId !== equipmentId));
  };

  const updateRow = (equipmentId, patch) => {
    onChange(
      selectedRows.map((r) =>
        r.equipmentId === equipmentId ? { ...r, ...patch } : r
      )
    );
  };

  if (loading) {
    return <div className="picker-loading">Loading equipment catalog…</div>;
  }

  if (error) {
    return <div className="picker-error">{error}</div>;
  }

  if (catalog.length === 0) {
    return (
      <div className="picker-empty">
        No equipment is currently available in the catalog. Please contact SAS.
      </div>
    );
  }

  return (
    <div className="equipment-picker">
      <div className="picker-add-row">
        <select
          className="picker-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={availableCatalog.length === 0}
        >
          <option value="">
            {availableCatalog.length === 0
              ? "All items added"
              : "Choose an item to add…"}
          </option>
          {availableCatalog.map((it) => {
            const avail = it.quantityOnHand ?? it.totalQuantity;
            return (
              <option key={it.equipmentId} value={it.equipmentId}>
                {it.name} ({EQUIPMENT_CATEGORY_LABELS[it.category] || it.category})
                {typeof avail === "number" ? ` — ${avail} available` : ""}
              </option>
            );
          })}
        </select>
        <input
          type="number"
          min="1"
          max={selectedId ? (catalogById.get(selectedId)?.quantityOnHand ?? catalogById.get(selectedId)?.totalQuantity ?? "") : ""}
          className="picker-qty"
          value={selectedQty}
          onChange={(e) => setSelectedQty(e.target.value)}
          placeholder="Qty"
        />
        <input
          type="text"
          className="picker-remarks"
          value={selectedRemarks}
          onChange={(e) => setSelectedRemarks(e.target.value)}
          placeholder="Notes (optional)"
          maxLength={300}
        />
        <button
          type="button"
          className="picker-add-btn"
          onClick={addRow}
          disabled={!selectedId}
        >
          + Add
        </button>
      </div>
      {addError && <div className="picker-row-warn" style={{ marginTop: "0.5rem", marginBottom: "0.5rem", color: "#c0392b" }}>{addError}</div>}

      {selectedRows.length === 0 ? (
        <div className="picker-rows-empty">No items added yet.</div>
      ) : (
        <div className="picker-rows">
          <div className="picker-row picker-row-header">
            <div>Item</div>
            <div>Qty</div>
            <div>Notes</div>
            <div></div>
          </div>
          {selectedRows.map((row) => {
            const catalogItem = catalogById.get(row.equipmentId);
            const availableQty = catalogItem
              ? (catalogItem.quantityOnHand ?? catalogItem.totalQuantity ?? 0)
              : 0;
            const overLimit = catalogItem && row.quantity > availableQty;
            return (
              <div className="picker-row" key={row.equipmentId}>
                <div className="picker-row-name">
                  <div>{row.name}</div>
                  {overLimit && (
                    <div className="picker-row-warn">
                      Exceeds {availableQty} available
                    </div>
                  )}
                </div>
                <div>
                  <input
                    type="number"
                    min="1"
                    max={availableQty}
                    className="picker-qty"
                    value={row.quantity}
                    onChange={(e) => {
                      const val = Math.floor(Number(e.target.value) || 1);
                      updateRow(row.equipmentId, {
                        quantity: Math.max(1, Math.min(val, availableQty)),
                      });
                    }}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    className="picker-remarks"
                    value={row.remarks || ""}
                    onChange={(e) =>
                      updateRow(row.equipmentId, { remarks: e.target.value })
                    }
                    maxLength={300}
                  />
                </div>
                <div>
                  <button
                    type="button"
                    className="picker-remove-btn"
                    onClick={() => removeRow(row.equipmentId)}
                    aria-label="Remove item"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EquipmentItemPicker;
