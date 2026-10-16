import React from 'react';
import {
  FileSpreadsheet,
  Calendar,
  Building,
  User,
  Trash2,
  Share2,
  FileText,
  Layers,
  ArrowRight,
  ShieldCheck,
  Eye,
  Edit3,
  Cloud,
  Clock,
  Check,
} from 'lucide-react';
import { Retirement, UserProfile } from '../../types';
import { storage } from '../../utils/storage';
import { formatNaira } from '../../utils/currency';
import { isUserAdmin } from '../../utils/supabaseClient';

interface RetirementCardProps {
  retirement: Retirement;
  currentUser: UserProfile;
  onOpen: (retirement: Retirement) => void;
  onEdit?: (retirement: Retirement) => void;
  onTrash: (id: string) => void;
  onExport: (retirement: Retirement) => void;
}

export const RetirementCard: React.FC<RetirementCardProps> = ({
  retirement,
  currentUser,
  onOpen,
  onEdit,
  onTrash,
  onExport,
}) => {
  const totals = storage.calculateTotals(retirement.id);
  const isOwner = retirement.ownerId === currentUser.id;
  const userAccess = retirement.access.find(
    (a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase()
  );
  const role = isOwner ? 'OWNER' : userAccess?.role || 'REVIEWER';
  const canDelete = isOwner || isUserAdmin(currentUser);

  return (
    <div
      onClick={() => onOpen(retirement)}
      className="group p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/5 transition cursor-pointer flex flex-col justify-between"
    >
      <div>
        {/* Top Header line */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25">
              {retirement.code}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                role === 'OWNER'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
              }`}
            >
              {role === 'OWNER' ? 'Owner' : 'Reviewer'}
            </span>
            {retirement.isDemo ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60">
                Demo Sample
              </span>
            ) : retirement.syncStatus === 'pending' ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center gap-1" title="Stored locally — pending cloud backup">
                <Clock className="w-2.5 h-2.5 text-amber-400" />
                <span>Pending</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 flex items-center gap-1" title="Synchronized with cloud database">
                <Check className="w-2.5 h-2.5 text-emerald-400" />
                <span>Cloud</span>
              </span>
            )}
            {retirement.connectedRetirementIds && retirement.connectedRetirementIds.length > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1">
                <Layers className="w-2.5 h-2.5" />
                <span>{retirement.connectedRetirementIds.length} Linked</span>
              </span>
            )}
          </div>

          {/* Quick Action Button Icons */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {isOwner && onEdit && (
              <button
                onClick={() => onEdit(retirement)}
                title="Edit Retirement"
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => onExport(retirement)}
              title="Export Audit PDF"
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
            >
              <FileText className="w-4 h-4" />
            </button>
            {canDelete && (
              <button
                onClick={() => onTrash(retirement.id)}
                title="Delete Retirement (Move to Trash Bin)"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Title & Placement */}
        <h3 className="text-base font-bold text-white group-hover:text-amber-300 transition line-clamp-1">
          {retirement.title}
        </h3>
        <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1 line-clamp-1">
          <Building className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          <span>{retirement.project}</span>
        </p>
      </div>

      {/* Financial Snapshot Box */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Daily Total</span>
            <span className="font-semibold text-slate-200">{formatNaira(totals.dailyRetirementTotal)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Supplementary</span>
            <span className="font-semibold text-slate-200">{formatNaira(totals.supplementaryTotal)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">
              General Total
            </span>
            <span className="text-sm font-black text-amber-400">
              {formatNaira(totals.generalTotal)}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-amber-400 group-hover:translate-x-0.5 transition">
            <span>Open</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
};
