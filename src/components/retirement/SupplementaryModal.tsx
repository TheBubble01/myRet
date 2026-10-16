import React, { useState } from 'react';
import { X, Plus, Trash2, Edit3, Banknote, AlertCircle, Save } from 'lucide-react';
import { SupplementaryEntry } from '../../types';
import { formatNaira, parseNumber } from '../../utils/currency';
import { generateUUID } from '../../utils/codeGenerator';

interface SupplementaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  retirementId: string;
  entries: SupplementaryEntry[];
  onSaveEntry: (entry: SupplementaryEntry) => void;
  onDeleteEntry: (id: string) => void;
}

export const SupplementaryModal: React.FC<SupplementaryModalProps> = ({
  isOpen,
  onClose,
  retirementId,
  entries,
  onSaveEntry,
  onDeleteEntry,
}) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalSupplementary = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!description.trim()) {
      setError('Please provide a description.');
      return;
    }

    const parsedAmount = parseNumber(amount);
    if (parsedAmount <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }

    const entry: SupplementaryEntry = {
      id: editingId || generateUUID(),
      retirementId,
      description: description.trim(),
      amount: parsedAmount,
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
    };

    onSaveEntry(entry);
    setDescription('');
    setAmount('');
    setEditingId(null);
  };

  const handleEdit = (entry: SupplementaryEntry) => {
    setEditingId(entry.id);
    setDescription(entry.description);
    setAmount(entry.amount.toString());
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setDescription('');
    setAmount('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Supplementary Site Payments</h2>
              <p className="text-xs text-slate-400">Non-dated site disbursements &amp; emergency contingency advances</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Total Badge */}
        <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-medium">Supplementary Total:</span>
          <span className="text-base font-extrabold text-amber-400 font-mono">
            {formatNaira(totalSupplementary)}
          </span>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mt-4 p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold text-slate-200">
            {editingId ? 'Edit Supplementary Entry' : 'Add New Supplementary Payment'}
          </h3>

          {error && (
            <div className="p-2 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-200 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-slate-400 font-medium block mb-1">
                Description (No date required)
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Payment for additional binding wire, emergency transport"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 font-medium block mb-1">
                Amount (₦)
              </label>
              <input
                type="number"
                min="1"
                step="any"
                required
                placeholder="e.g. 50000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1.5 rounded-lg text-slate-400 text-xs hover:text-white"
              >
                Cancel Edit
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
            >
              {editingId ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{editingId ? 'Update Entry' : 'Add Entry'}</span>
            </button>
          </div>
        </form>

        {/* List of Supplementary Entries */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Recorded Supplementary Payments ({entries.length})
          </h4>

          {entries.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4 text-center">
              No supplementary entries yet.
            </p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 font-medium truncate">{entry.description}</p>
                  <p className="text-[11px] font-mono text-amber-400 font-bold mt-0.5">
                    {formatNaira(entry.amount)}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(entry)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                    title="Edit entry"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteEntry(entry.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                    title="Delete entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
