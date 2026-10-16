import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Trash2,
  Calendar,
  Layers,
  Save,
  Tag,
  AlertCircle,
  FolderPlus,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { DailyRecord, Category, ExpenseItem } from '../../types';
import { calculateAmount, formatNaira, parseNumber } from '../../utils/currency';
import { generateUUID } from '../../utils/codeGenerator';
import { normalizeDate, storage } from '../../utils/storage';

interface DailyRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordToEdit?: DailyRecord | null;
  retirementId: string;
  onSave: (record: DailyRecord) => void;
}

const DEFAULT_SUGGESTED_CATEGORIES = [
  'Excavation',
  'Blockwork',
  'Casting',
  'Supply',
  'Other Works',
];

const createDefaultCategory = (name: string = 'Blockwork'): Category => ({
  id: generateUUID(),
  name,
  items: [
    {
      id: generateUUID(),
      description: '',
      quantity: 1,
      rate: 0,
      amount: 0,
    },
  ],
  subtotal: 0,
});

export const DailyRecordModal: React.FC<DailyRecordModalProps> = ({
  isOpen,
  onClose,
  recordToEdit,
  retirementId,
  onSave,
}) => {
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const [date, setDate] = useState<string>(
    recordToEdit?.date ? normalizeDate(recordToEdit.date) : getTodayDate()
  );

  const [categories, setCategories] = useState<Category[]>(() => {
    if (recordToEdit && recordToEdit.categories && recordToEdit.categories.length > 0) {
      return recordToEdit.categories.map((cat) => ({
        ...cat,
        id: cat.id || generateUUID(),
        items: cat.items.map((item) => {
          const rawQty = item.quantity !== undefined && item.quantity !== null ? Number(item.quantity) : 1;
          const rawRate = Number(item.rate) || 0;
          const existingAmt = Number(item.amount) || 0;
          const qty = isNaN(rawQty) || rawQty <= 0 ? (existingAmt > 0 ? 1 : 0) : rawQty;
          let rate = rawRate;
          let amount = (qty > 0 && rate > 0) ? calculateAmount(qty, rate) : existingAmt;
          if (rate === 0 && amount > 0 && qty > 0) {
            rate = Math.round((amount / qty) * 100) / 100;
          }
          return {
            ...item,
            id: item.id || generateUUID(),
            quantity: qty,
            rate: rate,
            amount: amount,
          };
        }),
        subtotal: cat.items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      }));
    }
    return [createDefaultCategory('Blockwork')];
  });

  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddCategoryInput, setShowAddCategoryInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize state whenever recordToEdit changes or modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (recordToEdit) {
      setDate(normalizeDate(recordToEdit.date));
      if (recordToEdit.categories && recordToEdit.categories.length > 0) {
        // Deep clone categories with safeguarded amounts and rates
        const clonedCategories: Category[] = recordToEdit.categories.map((cat) => {
          const processedItems = cat.items.map((item) => {
            const rawQty = item.quantity !== undefined && item.quantity !== null ? Number(item.quantity) : 1;
            const rawRate = Number(item.rate) || 0;
            const existingAmt = Number(item.amount) || 0;
            const qty = isNaN(rawQty) || rawQty <= 0 ? (existingAmt > 0 ? 1 : 0) : rawQty;
            let rate = rawRate;
            let amount = (qty > 0 && rate > 0) ? calculateAmount(qty, rate) : existingAmt;
            if (rate === 0 && amount > 0 && qty > 0) {
              rate = Math.round((amount / qty) * 100) / 100;
            }
            return {
              ...item,
              id: item.id || generateUUID(),
              quantity: qty,
              rate: rate,
              amount: amount,
            };
          });

          return {
            ...cat,
            id: cat.id || generateUUID(),
            items: processedItems,
            subtotal: processedItems.reduce((s, i) => s + i.amount, 0),
          };
        });
        setCategories(clonedCategories);
      } else {
        setCategories([createDefaultCategory('Blockwork')]);
      }
    } else {
      setDate(getTodayDate());
      setCategories([createDefaultCategory('Blockwork')]);
    }
    setError(null);
    setNewCategoryName('');
    setShowAddCategoryInput(false);
  }, [isOpen, recordToEdit]);

  if (!isOpen) return null;

  // Recalculate item and category amounts
  const handleItemChange = (
    catIndex: number,
    itemIndex: number,
    field: 'description' | 'quantity' | 'rate',
    value: string
  ) => {
    const updatedCats = [...categories];
    const item = updatedCats[catIndex].items[itemIndex];

    if (field === 'description') {
      item.description = value;
    } else if (field === 'quantity') {
      item.quantity = parseNumber(value);
      item.amount = calculateAmount(item.quantity, item.rate);
    } else if (field === 'rate') {
      item.rate = parseNumber(value);
      item.amount = calculateAmount(item.quantity, item.rate);
    }

    // Recalculate category subtotal
    updatedCats[catIndex].subtotal = updatedCats[catIndex].items.reduce(
      (sum, i) => sum + i.amount,
      0
    );

    setCategories(updatedCats);
  };

  const handleAddItem = (catIndex: number) => {
    const updatedCats = [...categories];
    updatedCats[catIndex].items.push({
      id: generateUUID(),
      description: '',
      quantity: 1,
      rate: 0,
      amount: 0,
    });
    setCategories(updatedCats);
  };

  const handleDeleteItem = (catIndex: number, itemIndex: number) => {
    const updatedCats = [...categories];
    if (updatedCats[catIndex].items.length <= 1) {
      // Clear values if last item
      updatedCats[catIndex].items[0] = {
        id: generateUUID(),
        description: '',
        quantity: 1,
        rate: 0,
        amount: 0,
      };
      updatedCats[catIndex].subtotal = 0;
    } else {
      updatedCats[catIndex].items.splice(itemIndex, 1);
      updatedCats[catIndex].subtotal = updatedCats[catIndex].items.reduce(
        (sum, i) => sum + i.amount,
        0
      );
    }
    setCategories(updatedCats);
  };

  const handleAddCategory = (nameToAdd?: string) => {
    const finalName = (nameToAdd || newCategoryName).trim();
    if (!finalName) return;

    // Check duplicate
    if (categories.some((c) => c.name.toLowerCase() === finalName.toLowerCase())) {
      setError(`Category "${finalName}" already exists for this day.`);
      return;
    }

    setError(null);
    setCategories([
      ...categories,
      {
        id: generateUUID(),
        name: finalName,
        items: [
          {
            id: generateUUID(),
            description: '',
            quantity: 1,
            rate: 0,
            amount: 0,
          },
        ],
        subtotal: 0,
      },
    ]);
    setNewCategoryName('');
    setShowAddCategoryInput(false);
  };

  const handleDeleteCategory = (catIndex: number) => {
    if (categories.length <= 1) {
      setError('A daily record must contain at least one category.');
      return;
    }
    setError(null);
    const updated = [...categories];
    updated.splice(catIndex, 1);
    setCategories(updated);
  };

  const handleRenameCategory = (catIndex: number, newName: string) => {
    const updated = [...categories];
    updated[catIndex].name = newName;
    setCategories(updated);
  };

  const normalizedCurrentDate = normalizeDate(date);
  const existingRecordForDate = useMemo(() => {
    if (recordToEdit) return null;
    const records = storage.getDailyRecords(retirementId);
    return records.find((r) => normalizeDate(r.date) === normalizedCurrentDate) || null;
  }, [normalizedCurrentDate, recordToEdit, retirementId]);

  const handleLoadExistingCategoriesForDate = () => {
    if (!existingRecordForDate) return;
    setCategories(JSON.parse(JSON.stringify(existingRecordForDate.categories)));
  };

  // Compute daily total
  const dailyTotal = categories.reduce((sum, cat) => sum + cat.subtotal, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedDate = normalizeDate(date);
    if (!normalizedDate) {
      setError('Please select a valid date.');
      return;
    }

    // Filter out categories with empty items or clean them
    const cleanedCategories: Category[] = categories
      .map((cat) => {
        const validItems = cat.items.filter(
          (item) => item.description.trim().length > 0 || (Number(item.amount) || 0) > 0
        );
        const subtotal = validItems.reduce((sum, i) => sum + i.amount, 0);
        return {
          ...cat,
          items: validItems,
          subtotal,
        };
      })
      .filter((cat) => cat.items.length > 0);

    if (cleanedCategories.length === 0) {
      setError('Please provide at least one expenditure line item (description and amount).');
      return;
    }

    const finalDailyTotal = cleanedCategories.reduce((sum, c) => sum + c.subtotal, 0);

    const record: DailyRecord = {
      id: recordToEdit?.id || generateUUID(),
      retirementId,
      date: normalizedDate,
      categories: cleanedCategories,
      dailyTotal: finalDailyTotal,
      createdAt: recordToEdit?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
    };

    onSave(record);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-6 shadow-2xl text-slate-100 max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-800 flex-shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              {recordToEdit ? 'Editing Existing Record' : 'Batch Expense Entry'}
            </span>
            <h2 className="text-base sm:text-lg font-bold text-white mt-1">
              {recordToEdit ? `Edit Daily Construction Record (${date})` : 'Add Daily Construction Record'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-950/70 border border-red-800/80 text-xs text-red-200 flex items-center gap-2 flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {existingRecordForDate && !recordToEdit && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                A daily retirement already exists for {date} ({existingRecordForDate.categories.length} categories, {formatNaira(existingRecordForDate.dailyTotal)}). Entries saved will be merged into this daily retirement.
              </span>
            </div>
            <button
              type="button"
              onClick={handleLoadExistingCategoriesForDate}
              className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] whitespace-nowrap hover:bg-amber-400 transition self-start sm:self-auto"
            >
              Load Existing Entries
            </button>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col flex-1 overflow-hidden">
          {/* Top Bar: Date Picker & Daily Total Live Counter */}
          <div className="p-3 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <label className="text-xs font-semibold text-slate-300">Date:</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
              <span className="text-xs text-slate-400 font-medium">Day Subtotal:</span>
              <span className="text-sm sm:text-base font-black text-amber-400 font-mono">
                {formatNaira(dailyTotal)}
              </span>
            </div>
          </div>

          {/* Suggested Quick Add Categories pill bar */}
          <div className="py-2.5 flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Tag className="w-3 h-3 text-amber-400" /> Suggested:
            </span>
            {DEFAULT_SUGGESTED_CATEGORIES.map((catName) => {
              const alreadyAdded = categories.some((c) => c.name.toLowerCase() === catName.toLowerCase());
              return (
                <button
                  key={catName}
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => handleAddCategory(catName)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
                    alreadyAdded
                      ? 'bg-slate-800/40 border-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-white hover:border-amber-500/50 hover:bg-slate-700'
                  }`}
                >
                  + {catName}
                </button>
              );
            })}
          </div>

          {/* Categories & Items Scrollable Area */}
          <div className="overflow-y-auto flex-1 space-y-4 pr-1 py-1">
            {categories.map((cat, catIdx) => (
              <div
                key={cat.id}
                className="p-3.5 sm:p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3"
              >
                {/* Category Header */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) => handleRenameCategory(catIdx, e.target.value)}
                      placeholder="Category Name"
                      className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-amber-500 px-1 py-0.5 text-xs sm:text-sm font-bold text-white focus:outline-none uppercase tracking-wide"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">
                      Subtotal: <strong className="text-white font-mono">{formatNaira(cat.subtotal)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(catIdx)}
                      title="Remove Category"
                      className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Items Table */}
                <div className="space-y-2">
                  {/* Table Header (hidden on tiny screens) */}
                  <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] uppercase font-bold tracking-wider text-slate-400 px-1">
                    <div className="col-span-5">Description (Labour / Material)</div>
                    <div className="col-span-2 text-center">Quantity</div>
                    <div className="col-span-2 text-right">Rate (₦)</div>
                    <div className="col-span-2 text-right">Amount (₦)</div>
                    <div className="col-span-1"></div>
                  </div>

                  {cat.items.map((item, itemIdx) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-900/60 p-2 sm:p-1.5 rounded-lg border border-slate-800/80"
                    >
                      {/* Description */}
                      <div className="sm:col-span-5">
                        <label className="sm:hidden text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                          Description
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Mason, Labourers, Cement, Counting"
                          value={item.description}
                          onChange={(e) => handleItemChange(catIdx, itemIdx, 'description', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Quantity */}
                      <div className="grid grid-cols-2 sm:contents gap-2">
                        <div className="sm:col-span-2">
                          <label className="sm:hidden text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Qty"
                            value={item.quantity || ''}
                            onChange={(e) => handleItemChange(catIdx, itemIdx, 'quantity', e.target.value)}
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-center font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        {/* Rate */}
                        <div className="sm:col-span-2">
                          <label className="sm:hidden text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                            Rate (₦)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Rate"
                            value={item.rate || ''}
                            onChange={(e) => handleItemChange(catIdx, itemIdx, 'rate', e.target.value)}
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-right font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      {/* Calculated Amount */}
                      <div className="sm:col-span-2 flex items-center justify-between sm:justify-end px-1">
                        <span className="sm:hidden text-[10px] text-slate-400 font-semibold uppercase">
                          Amount:
                        </span>
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {formatNaira(item.amount)}
                        </span>
                      </div>

                      {/* Delete item button */}
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(catIdx, itemIdx)}
                          className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition"
                          title="Delete row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add item button */}
                  <button
                    type="button"
                    onClick={() => handleAddItem(catIdx)}
                    className="w-full py-1.5 mt-1 border border-dashed border-slate-700 hover:border-amber-500/60 rounded-lg text-xs font-semibold text-slate-300 hover:text-amber-400 flex items-center justify-center gap-1.5 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Item to {cat.name}</span>
                  </button>
                </div>
              </div>
            ))}

            {/* Custom Category Add Button */}
            {showAddCategoryInput ? (
              <div className="p-3 bg-slate-950 border border-slate-700 rounded-xl flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Enter custom category name (e.g. Electrical Conduit, Roof Truss)"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleAddCategory()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCategoryInput(false)}
                  className="px-2 py-1.5 rounded-lg text-slate-400 text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddCategoryInput(true)}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-700 hover:border-amber-500/50 text-slate-400 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
              >
                <FolderPlus className="w-4 h-4 text-amber-500" />
                <span>+ Create New Category for this Day</span>
              </button>
            )}
          </div>

          {/* Footer Bar */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="text-xs">
              <span className="text-slate-400">Total Calculated: </span>
              <span className="font-mono font-bold text-amber-400 text-sm">
                {formatNaira(dailyTotal)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition"
              >
                <Save className="w-4 h-4" />
                <span>{recordToEdit ? 'Save Changes' : 'Save Daily Record'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
