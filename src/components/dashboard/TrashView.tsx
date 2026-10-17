import React, { useState, useEffect } from 'react';
import { Trash2, RotateCcw, AlertTriangle, ArrowLeft, Clock, ShieldAlert } from 'lucide-react';
import { Retirement } from '../../types';
import { storage, TRASH_RETENTION_MS } from '../../utils/storage';
import { syncService } from '../../utils/syncService';

interface TrashViewProps {
  onBack: () => void;
  onRetirementRestored: (id: string) => void;
}

export const TrashView: React.FC<TrashViewProps> = ({
  onBack,
  onRetirementRestored,
}) => {
  const [trashList, setTrashList] = useState<Retirement[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadTrash = () => {
    setTrashList(storage.getTrashRetirements());
  };

  useEffect(() => {
    loadTrash();
    const unsubscribe = syncService.subscribe(() => {
      loadTrash();
    });
    syncService.pullFromCloud().then(() => {
      loadTrash();
    });
    return unsubscribe;
  }, []);

  const handleRestore = (id: string) => {
    const restored = storage.restoreFromTrash(id);
    if (restored) {
      onRetirementRestored(id);
    }
    loadTrash();
  };

  const handlePermanentDelete = (id: string) => {
    storage.permanentlyDelete(id);
    setDeleteConfirmId(null);
    loadTrash();
  };

  const formatRemainingTime = (deletedAt?: string) => {
    if (!deletedAt) return '48h remaining';
    const deletedTime = new Date(deletedAt).getTime();
    const elapsed = Date.now() - deletedTime;
    const remainingMs = Math.max(0, TRASH_RETENTION_MS - elapsed);
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m remaining`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Trash &amp; 48-Hour Recovery
            </h1>
            <p className="text-xs text-slate-400">
              Retirements in Trash are kept safely recoverable for 48 hours before permanent purging.
            </p>
          </div>
        </div>
      </div>

      {trashList.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">Trash is Empty</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No deleted retirements. Any retirement you move to trash will be held here for 48 hours.
          </p>
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
          >
            Return to Retirements
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {trashList.map((ret) => (
            <div
              key={ret.id}
              className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 relative overflow-hidden"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    {ret.code}
                  </span>
                  <h3 className="text-sm font-bold text-white mt-1.5 line-clamp-1">{ret.title}</h3>
                  <p className="text-xs text-slate-400 line-clamp-1">{ret.project}</p>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/50">
                  <Clock className="w-3 h-3" />
                  <span>{formatRemainingTime(ret.deletedAt)}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  onClick={() => handleRestore(ret.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>

                {deleteConfirmId === ret.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handlePermanentDelete(ret.id)}
                      className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(ret.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-800/40 text-xs font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
