import React, { useState } from 'react';
import {
  X,
  Layers,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Link2,
} from 'lucide-react';
import { Retirement } from '../../types';
import { storage } from '../../utils/storage';
import { formatNaira } from '../../utils/currency';

interface ConnectRetirementModalProps {
  isOpen: boolean;
  onClose: () => void;
  retirement: Retirement;
  onUpdateRetirement: (updated: Retirement) => void;
}

export const ConnectRetirementModal: React.FC<ConnectRetirementModalProps> = ({
  isOpen,
  onClose,
  retirement,
  onUpdateRetirement,
}) => {
  const [connectCode, setConnectCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const allRetirements = storage.getRetirements();
  const availableToConnect = allRetirements.filter(
    (r) => r.id !== retirement.id && !(retirement.connectedRetirementIds || []).includes(r.id)
  );

  const connectedList = (retirement.connectedRetirementIds || [])
    .map((id) => storage.getRetirementById(id))
    .filter((r): r is Retirement => r !== undefined);

  const handleConnect = (targetRetirement: Retirement) => {
    setError(null);
    setSuccess(null);

    const currentConnected = retirement.connectedRetirementIds || [];
    if (currentConnected.includes(targetRetirement.id)) {
      setError('This retirement is already connected.');
      return;
    }

    // Bidirectional connection
    const updatedSource: Retirement = {
      ...retirement,
      connectedRetirementIds: [...currentConnected, targetRetirement.id],
    };

    const targetConnected = targetRetirement.connectedRetirementIds || [];
    const updatedTarget: Retirement = {
      ...targetRetirement,
      connectedRetirementIds: [...targetConnected, retirement.id],
    };

    storage.saveRetirement(updatedSource);
    storage.saveRetirement(updatedTarget);

    storage.logActivity(
      retirement.id,
      'Retirement Connected',
      `Connected with ${targetRetirement.code} ("${targetRetirement.title}")`
    );

    onUpdateRetirement(updatedSource);
    setSuccess(`Connected with ${targetRetirement.code} successfully!`);
    setConnectCode('');
  };

  const handleConnectByCode = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanCode = connectCode.trim().toUpperCase();
    if (!cleanCode) return;

    if (cleanCode === retirement.code.toUpperCase()) {
      setError('Cannot connect a retirement to itself.');
      return;
    }

    const target = storage.getRetirementByCode(cleanCode);
    if (!target) {
      setError(`No retirement found with code "${cleanCode}".`);
      return;
    }

    handleConnect(target);
  };

  const handleDisconnect = (targetId: string) => {
    const updatedConnected = (retirement.connectedRetirementIds || []).filter((id) => id !== targetId);
    const updatedSource: Retirement = {
      ...retirement,
      connectedRetirementIds: updatedConnected,
    };

    const target = storage.getRetirementById(targetId);
    if (target) {
      const updatedTargetConnected = (target.connectedRetirementIds || []).filter((id) => id !== retirement.id);
      storage.saveRetirement({
        ...target,
        connectedRetirementIds: updatedTargetConnected,
      });
    }

    storage.saveRetirement(updatedSource);
    storage.logActivity(
      retirement.id,
      'Retirement Disconnected',
      `Disconnected from linked retirement ID ${targetId}`
    );

    onUpdateRetirement(updatedSource);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Connected Retirements</h2>
              <p className="text-xs text-slate-400">Link project phases together for combined consolidated audits</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-200 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Connect by Code Form */}
          <form onSubmit={handleConnectByCode} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="Enter Code (e.g. RET-3M9X7Q)"
              value={connectCode}
              onChange={(e) => setConnectCode(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono uppercase text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          </form>

          {/* Currently Connected List */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active Connected Retirements ({connectedList.length})
            </h4>

            {connectedList.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-3 text-center">
                No connected retirements linked yet.
              </p>
            ) : (
              connectedList.map((conn) => {
                const totals = storage.calculateTotals(conn.id);
                return (
                  <div
                    key={conn.id}
                    className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-400">{conn.code}</span>
                        <span className="font-semibold text-white truncate">{conn.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Total: <strong className="text-white font-mono">{formatNaira(totals.generalTotal)}</strong>
                      </p>
                    </div>

                    <button
                      onClick={() => handleDisconnect(conn.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800 transition"
                      title="Disconnect retirement"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Select from User's Other Retirements */}
          {availableToConnect.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Quick Connect From Your Retirements
              </h4>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {availableToConnect.map((avail) => (
                  <div
                    key={avail.id}
                    className="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs hover:border-slate-700 transition"
                  >
                    <div className="truncate mr-2">
                      <span className="font-mono text-amber-400 font-bold mr-2">{avail.code}</span>
                      <span className="text-slate-300 font-medium">{avail.title}</span>
                    </div>
                    <button
                      onClick={() => handleConnect(avail)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-purple-600 hover:text-white text-slate-300 text-[11px] font-semibold transition flex-shrink-0"
                    >
                      + Connect
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
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
