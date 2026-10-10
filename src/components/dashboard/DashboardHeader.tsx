import React from 'react';
import {
  HardHat,
  User,
  Trash2,
  BookOpen,
  HelpCircle,
  Info,
  LogOut,
  Sparkles,
  FileSpreadsheet,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { isUserAdmin } from '../../utils/supabaseClient';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { OfflineIndicator } from '../pwa/OfflineIndicator';

interface DashboardHeaderProps {
  currentUser: UserProfile;
  trashCount: number;
  hasDemoData: boolean;
  onOpenProfile: () => void;
  onOpenTrash: () => void;
  onOpenGuide: () => void;
  onOpenFAQ: () => void;
  onOpenAbout: () => void;
  onLoadDemo: () => void;
  onClearDemo: () => void;
  onLogout: () => void;
  onGoHome: () => void;
  onOpenAdmin?: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  currentUser,
  trashCount,
  hasDemoData,
  onOpenProfile,
  onOpenTrash,
  onOpenGuide,
  onOpenFAQ,
  onOpenAbout,
  onLoadDemo,
  onClearDemo,
  onLogout,
  onGoHome,
  onOpenAdmin,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Left Branding */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={onGoHome}>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <HardHat className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-white">myRet</span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">Digital Site Expenditure &amp; Retirement</p>
          </div>
        </div>

        {/* Center / Navigation Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Demo Data Toggle */}
          {hasDemoData ? (
            <button
              onClick={onClearDemo}
              className="text-[11px] font-semibold text-slate-400 hover:text-red-400 px-2 py-1 rounded-lg border border-slate-800 bg-slate-950 hover:border-red-900 transition"
              title="Remove sample construction demo retirements"
            >
              Clear Demo
            </button>
          ) : (
            <button
              onClick={onLoadDemo}
              className="hidden xs:flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition"
              title="Load realistic Nigerian construction project demo data"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Try Demo Data</span>
            </button>
          )}

          {/* In-app Manual & FAQ */}
          <button
            onClick={onOpenGuide}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Field Manual Guide"
          >
            <BookOpen className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenFAQ}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="FAQ"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenAbout}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="About myRet"
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Trash Button */}
          <button
            onClick={onOpenTrash}
            className="relative p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
            title="Trash (48h Recovery)"
          >
            <Trash2 className="w-4 h-4" />
            {trashCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {trashCount}
              </span>
            )}
          </button>

          {/* Admin User Management Button */}
          {isUserAdmin(currentUser) && onOpenAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-xs font-semibold transition"
              title="User Management (Admin Portal)"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">User Admin</span>
            </button>
          )}

          {/* PWA Install Button */}
          <PWAInstallButton />
        </div>

        {/* Right User Profile */}
        <div className="flex items-center gap-2">
          <OfflineIndicator />

          <button
            onClick={onOpenProfile}
            className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-left transition"
            title="Edit profile & persona"
          >
            <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xs font-bold">
              {currentUser.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase()}
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-bold text-white line-clamp-1 leading-tight">
                {currentUser.name}
              </p>
              <p className="text-[10px] text-slate-400 line-clamp-1 leading-tight">
                {currentUser.designation}
              </p>
            </div>
          </button>

          <button
            onClick={onLogout}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
