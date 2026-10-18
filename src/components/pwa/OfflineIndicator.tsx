import React, { useState, useEffect } from 'react';
import { WifiOff, CheckCircle2, RefreshCw, AlertCircle, Database } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { syncService } from '../../utils/syncService';
import { SyncState } from '../../types';

interface OfflineIndicatorProps {
  pendingCount?: number;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ pendingCount: propPendingCount }) => {
  const isOnline = useOnlineStatus();
  const [syncState, setSyncState] = useState<SyncState>(syncService.getState());

  useEffect(() => {
    const unsubscribe = syncService.subscribe((state) => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  const pendingCount = propPendingCount !== undefined ? propPendingCount : syncState.pendingCount;

  // Offline Mode indicator
  if (!isOnline) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60">
        <WifiOff className="w-3 h-3 text-amber-400" />
        <span className="hidden xs:inline">Offline {pendingCount > 0 ? `(${pendingCount} queued)` : ''}</span>
      </div>
    );
  }

  // Active Syncing
  if (syncState.status === 'syncing') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/50 animate-pulse">
        <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
        <span>Syncing {pendingCount} records...</span>
      </div>
    );
  }

  // Tables Awaiting Migration in Supabase
  if (syncState.status === 'tables_missing') {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/90 text-amber-300 border border-amber-700/80 cursor-help"
        title="Cloud tables not deployed yet. Local data is securely preserved. Run the prepared migration in Supabase SQL editor to enable cloud backup."
      >
        <Database className="w-3 h-3 text-amber-400" />
        <span className="hidden xs:inline">Local Safe (Cloud DB Pending)</span>
      </div>
    );
  }

  // Pending queue items awaiting push
  if (pendingCount > 0) {
    return (
      <button
        onClick={() => syncService.processQueue()}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/70 text-amber-300 border border-amber-700/60 hover:bg-amber-900/60 transition"
        title="Click to sync pending records to Supabase now"
      >
        <RefreshCw className="w-3 h-3 text-amber-400" />
        <span>Sync {pendingCount} pending</span>
      </button>
    );
  }

  // Synced status
  return (
    <div
      onClick={() => syncService.pullFromCloud()}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 cursor-pointer hover:bg-emerald-950/90 transition"
      title="All data synchronized with cloud. Click to check for updates."
    >
      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      <span className="hidden xs:inline">Synced</span>
    </div>
  );
};
