import React, { useState, useEffect, useRef } from 'react';
import {
  HardHat,
  User,
  Trash2,
  BookOpen,
  HelpCircle,
  Info,
  LogOut,
  FileSpreadsheet,
  Users,
  Menu,
  X,
  Home,
  BarChart3,
  Wifi,
  WifiOff,
  ChevronRight,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { isUserAdmin } from '../../utils/supabaseClient';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const isOnline = useOnlineStatus();
  const isAdmin = isUserAdmin(currentUser);

  // Close menu on outside click or Escape key
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  // Prevent unintended background scrolling on small mobile screens when menu is open
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (isMenuOpen && window.innerWidth < 640) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isMenuOpen]);

  const handleMenuAction = (action: () => void) => {
    setIsMenuOpen(false);
    action();
  };

  const userInitials = currentUser.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Application Logo & Name */}
        <button
          type="button"
          onClick={() => handleMenuAction(onGoHome)}
          className="flex items-center gap-2.5 sm:gap-3 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl p-1 -ml-1 transition min-w-0"
          aria-label="Go to myRet Home Dashboard"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 flex-shrink-0 group-hover:border-amber-500/60 transition">
            <HardHat className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-black tracking-tight text-white truncate">
                myRet
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block truncate">
              Digital Site Expenditure &amp; Retirement
            </p>
          </div>
        </button>

        {/* Right: Online/Offline Connectivity, Synchronization Status & Menu Toggle */}
        <div
          ref={menuContainerRef}
          className="relative flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0"
        >
          {/* Online/Offline Connectivity Indicator */}
          <div
            className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
              isOnline
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                : 'bg-amber-950/80 text-amber-300 border-amber-800/60'
            }`}
            title={
              isOnline
                ? 'Network connectivity: Online'
                : 'Network connectivity: Offline — changes are saved locally'
            }
            role="status"
            aria-label={isOnline ? 'Network status: Online' : 'Network status: Offline'}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                <span className="hidden md:inline">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-amber-400 flex-shrink-0" />
                <span className="hidden md:inline">Offline</span>
              </>
            )}
          </div>

          {/* Existing Synchronization Status Indicator */}
          <OfflineIndicator />

          {/* Collapsible Navigation Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-expanded={isMenuOpen}
            aria-haspopup="true"
            aria-controls="myret-navigation-menu"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            title={isMenuOpen ? 'Close Menu' : 'Open Menu'}
            className={`relative inline-flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-xl border text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              isMenuOpen
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/10'
                : 'bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white border-slate-700/80'
            }`}
          >
            {isMenuOpen ? (
              <X className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
            ) : (
              <Menu className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
            )}
            <span className="hidden sm:inline">Menu</span>
            {!isMenuOpen && trashCount > 0 && (
              <span
                className="w-2 h-2 rounded-full bg-red-500"
                title={`${trashCount} item(s) in Trash Bin`}
              />
            )}
          </button>

          {/* Mobile Backdrop for clean touch dismissal */}
          {isMenuOpen && (
            <div
              className="fixed inset-0 top-16 bg-black/60 backdrop-blur-xs sm:hidden z-40"
              onClick={() => setIsMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Collapsible Navigation Dropdown / Panel */}
          {isMenuOpen && (
            <nav
              id="myret-navigation-menu"
              aria-label="Application navigation"
              className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-[4.25rem] sm:top-full sm:mt-2 w-auto sm:w-80 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl z-50 divide-y divide-slate-800 text-slate-100"
            >
              {/* User Summary Header inside Menu */}
              <div className="p-3.5 bg-slate-950/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {userInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate">
                    {currentUser.name}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {currentUser.designation || currentUser.email}
                  </p>
                </div>
              </div>

              {/* SECTION 1: NAVIGATION */}
              <div className="p-2 space-y-1">
                <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Navigation
                </p>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onGoHome)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <Home className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Home / Dashboard</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onOpenTrash)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span>Trash Bin</span>
                  </span>
                  {trashCount > 0 ? (
                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {trashCount}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">48h Recovery</span>
                  )}
                </button>

                {/* Project Report (Existing destination status) */}
                <div
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-400 bg-slate-950/40 cursor-not-allowed select-none"
                  title="Project Report utility is coming soon"
                  aria-disabled="true"
                >
                  <span className="flex items-center gap-2.5">
                    <BarChart3 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span>Project Report</span>
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    Soon
                  </span>
                </div>

                {/* Admin User Management (If Admin) */}
                {isAdmin && onOpenAdmin && (
                  <button
                    type="button"
                    onClick={() => handleMenuAction(onOpenAdmin)}
                    className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-amber-400 hover:bg-amber-500/15 active:bg-amber-500/20 transition text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span>User Admin</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-amber-400/70" />
                  </button>
                )}

                {/* Demo Data Control */}
                {hasDemoData ? (
                  <button
                    type="button"
                    onClick={() => handleMenuAction(onClearDemo)}
                    className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-red-400 hover:bg-slate-800 transition text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <FileSpreadsheet className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <span>Clear Demo Data</span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleMenuAction(onLoadDemo)}
                    className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-amber-400 hover:bg-amber-500/10 transition text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <FileSpreadsheet className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span>Try Demo Data</span>
                    </span>
                  </button>
                )}
              </div>

              {/* SECTION 2: HELP & INFORMATION */}
              <div className="p-2 space-y-1">
                <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Help &amp; Information
                </p>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onOpenGuide)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <BookOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Manual</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onOpenFAQ)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <HelpCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>FAQ</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onOpenAbout)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>About myRet</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>

              {/* SECTION 3: ACCOUNT */}
              <div className="p-2 space-y-1">
                <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Account
                </p>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onOpenProfile)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-800/80 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Profile</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>

                <div className="px-2.5 py-1.5">
                  <PWAInstallButton />
                </div>

                <button
                  type="button"
                  onClick={() => handleMenuAction(onLogout)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-950/50 active:bg-red-950/70 transition text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <LogOut className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span>Logout</span>
                  </span>
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};

