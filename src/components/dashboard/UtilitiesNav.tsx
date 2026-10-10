import React from 'react';
import { FileSpreadsheet, BarChart3, Wrench, Sparkles, Users } from 'lucide-react';
import { ActiveUtility } from '../../types';

interface UtilitiesNavProps {
  activeUtility: ActiveUtility;
  onSelectUtility: (utility: ActiveUtility) => void;
  isAdmin?: boolean;
}

export const UtilitiesNav: React.FC<UtilitiesNavProps> = ({
  activeUtility,
  onSelectUtility,
  isAdmin = false,
}) => {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-2.5 sm:p-3 mb-6">
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-amber-500" /> Site Utilities
        </span>
        <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-semibold">
          {isAdmin ? 'Admin Access Enabled' : 'Retirement Active'}
        </span>
      </div>

      <div className={`grid grid-cols-1 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-2`}>
        {/* 1. Retirement - Active */}
        <button
          onClick={() => onSelectUtility('retirement')}
          className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
            activeUtility === 'retirement'
              ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-sm'
              : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm ${
              activeUtility === 'retirement'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white">Retirement</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="text-[11px] text-amber-400 font-medium">Active &bull; Daily Site Book</p>
          </div>
        </button>

        {/* 2. User Management - Admin Only */}
        {isAdmin && (
          <button
            onClick={() => onSelectUtility('user_management')}
            className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
              activeUtility === 'user_management'
                ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-sm'
                : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm ${
                activeUtility === 'user_management'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">User Management</span>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              </div>
              <p className="text-[11px] text-amber-400 font-medium">Admin &bull; Password Reset</p>
            </div>
          </button>
        )}

        {/* 3. Project Report - Coming Soon */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 text-slate-500 cursor-not-allowed select-none">
          <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-400">Project Report</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Coming Soon
            </span>
          </div>
        </div>

        {/* 4. Other Utilities - Coming Soon */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 text-slate-500 cursor-not-allowed select-none">
          <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-400">Other Utilities</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Coming Soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
