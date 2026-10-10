import React from 'react';
import { WifiOff, CheckCircle2, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  pendingCount?: number;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ pendingCount = 0 }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && pendingCount === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        <span className="hidden xs:inline">Synced</span>
      </div>
    );
  }

  if (isOnline && pendingCount > 0) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/50 animate-pulse">
        <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
        <span>Syncing {pendingCount} records...</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-xl bg-amber-600/95 text-slate-950 px-3.5 py-2 text-xs font-semibold shadow-xl border border-amber-400 backdrop-blur-md">
      <WifiOff className="w-4 h-4 text-slate-950 animate-bounce" />
      <div>
        <p className="leading-tight">Site Offline Mode</p>
        <p className="text-[10px] font-normal text-slate-900 opacity-90">
          Entries safely saved locally — pending synchronization
        </p>
      </div>
    </div>
  );
};
