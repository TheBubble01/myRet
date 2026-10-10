import React from 'react';
import { X, History, User, Clock, CheckCircle } from 'lucide-react';
import { ActivityLog } from '../../types';

interface ActivityHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: ActivityLog[];
  retirementCode: string;
}

export const ActivityHistoryModal: React.FC<ActivityHistoryModalProps> = ({
  isOpen,
  onClose,
  logs,
  retirementCode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Activity &amp; Audit Log</h2>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 font-bold">
                  {retirementCode}
                </span>
              </div>
              <p className="text-xs text-slate-400">Chronological site audit trail of entries and modifications</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List of logs */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1">
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-8 text-center">
              No activity logs recorded yet.
            </p>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400">{log.action}</span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {log.details && (
                  <p className="text-slate-300 text-xs">{log.details}</p>
                )}

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-0.5">
                  <User className="w-3 h-3 text-slate-500" />
                  <span>By: <strong>{log.userName}</strong></span>
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
