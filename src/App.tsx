import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  KeyRound,
  FileSpreadsheet,
  Trash2,
  HardHat,
  Search,
  RefreshCw,
  ShieldCheck,
  Users,
  LogOut,
} from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { Retirement, UserProfile, ActiveUtility } from './types';
import { supabase, formatSupabaseUser, isUserAdmin, isSupabaseConfigured } from './utils/supabaseClient';
import { storage } from './utils/storage';
import { syncService } from './utils/syncService';
import { DashboardHeader } from './components/dashboard/DashboardHeader';
import { UtilitiesNav } from './components/dashboard/UtilitiesNav';
import { RetirementCard } from './components/dashboard/RetirementCard';
import { CreateRetirementModal } from './components/dashboard/CreateRetirementModal';
import { AddExistingModal } from './components/dashboard/AddExistingModal';
import { TrashView } from './components/dashboard/TrashView';
import { RetirementHome } from './components/retirement/RetirementHome';
import { ExportPdfModal } from './components/retirement/ExportPdfModal';
import { LandingPage } from './components/landing/LandingPage';
import { AuthModal } from './components/auth/AuthModal';
import { ProfileModal } from './components/auth/ProfileModal';
import { GuideModal } from './components/modals/GuideModal';
import { FAQModal } from './components/modals/FAQModal';
import { AboutModal } from './components/modals/AboutModal';
import { AdminUserManagement } from './components/admin/AdminUserManagement';
import { useSystemTheme } from './hooks/useSystemTheme';

type AppView = 'landing' | 'dashboard' | 'retirement_home' | 'trash' | 'admin_users';

/**
 * Distinguishes temporary connectivity/server errors from confirmed Supabase authentication failures.
 */
function classifySupabaseAuthError(
  error: any
): 'connectivity_or_server_error' | 'confirmed_auth_failure' {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'connectivity_or_server_error';
  }
  if (!error) {
    return 'connectivity_or_server_error';
  }

  const name = String(error.name || '');
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const status = typeof error.status === 'number' ? error.status : 0;

  if (
    name === 'AuthRetryableFetchError' ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  ) {
    return 'connectivity_or_server_error';
  }

  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('fetch error') ||
    message.includes('econn') ||
    message.includes('enotfound') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout')
  ) {
    return 'connectivity_or_server_error';
  }

  const isConfirmedAuthStatus = status === 400 || status === 401 || status === 403;
  const isConfirmedAuthCodeOrMessage =
    code === 'invalid_grant' ||
    code === 'refresh_token_not_found' ||
    code === 'invalid_jwt' ||
    code === 'bad_jwt' ||
    code === 'user_not_found' ||
    code === 'user_banned' ||
    code === 'session_not_found' ||
    code === 'session_expired' ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('invalid grant') ||
    message.includes('user not found') ||
    message.includes('user is banned') ||
    message.includes('session not found') ||
    message.includes('invalid claim');

  if (isConfirmedAuthStatus && isConfirmedAuthCodeOrMessage) {
    return 'confirmed_auth_failure';
  }

  return 'connectivity_or_server_error';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutErr = new Error('Operation timed out');
      timeoutErr.name = 'TimeoutError';
      reject(timeoutErr);
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export default function App() {
  // Automatically follows device/system theme (light / dark)
  useSystemTheme();

  // Synchronously evaluate local offline authentication state on startup (local-first)
  const initialOfflineEval = useMemo(() => storage.evaluateOfflineAccess(), []);
  const hasUrlAuthCallback = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return (
      hash.includes('access_token=') ||
      hash.includes('refresh_token=') ||
      search.includes('code=')
    );
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() =>
    initialOfflineEval.status === 'valid' ? initialOfflineEval.user : null
  );
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(() => {
    if (initialOfflineEval.status === 'valid' || initialOfflineEval.status === 'expired') {
      return false;
    }
    if (hasUrlAuthCallback) {
      return true;
    }
    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      storage.hasPersistedSupabaseSession()
    ) {
      return true;
    }
    return false;
  });

  const [view, setView] = useState<AppView>(() =>
    initialOfflineEval.status === 'valid' ? 'dashboard' : 'landing'
  );
  const [activeUtility, setActiveUtility] = useState<ActiveUtility>('retirement');
  const [retirements, setRetirements] = useState<Retirement[]>(() =>
    initialOfflineEval.status === 'valid' ? storage.getRetirements() : []
  );
  const [activeRetirement, setActiveRetirement] = useState<Retirement | null>(null);

  const [expiredUserEmail, setExpiredUserEmail] = useState<string>(() =>
    initialOfflineEval.status === 'expired' ? initialOfflineEval.user.email : ''
  );

  // Modals
  const [showAuthModal, setShowAuthModal] = useState<boolean>(
    () => initialOfflineEval.status === 'expired'
  );
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [retirementToEdit, setRetirementToEdit] = useState<Retirement | null>(null);
  const [retirementToTrash, setRetirementToTrash] = useState<Retirement | null>(null);
  const [retirementToRemoveImported, setRetirementToRemoveImported] = useState<Retirement | null>(null);
  const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);
  const [showAddExistingModal, setShowAddExistingModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showFAQModal, setShowFAQModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Quick export modal from dashboard card
  const [exportTargetRetirement, setExportTargetRetirement] = useState<Retirement | null>(null);

  // Dashboard search
  const [dashboardSearch, setDashboardSearch] = useState('');

  // Internal refs to coordinate manual logout and background validation
  const isManualLogoutRef = useRef(false);
  const isValidatingOnlineRef = useRef(false);

  const refreshRetirements = useCallback(() => {
    setRetirements(storage.getRetirements());
    setActiveRetirement((prev) => {
      if (!prev) return null;
      const latest = storage.getRetirementById(prev.id);
      if (!latest || latest.status === 'in_trash') {
        setView((v) => (v === 'retirement_home' ? 'dashboard' : v));
        return null;
      }
      return latest;
    });
  }, []);

  // Subscribe to syncService updates for live UI refresh
  useEffect(() => {
    const unsubscribe = syncService.subscribe(() => {
      refreshRetirements();
    });
    return unsubscribe;
  }, [refreshRetirements]);

  /**
   * Performs a non-blocking online authentication validation against the live Supabase server
   * (`supabase.auth.getUser()` / `refreshSession()`).
   * Updates the 7-day validation timestamp ONLY when a genuine online response from Supabase succeeds.
   */
  const validateSessionInBackground = useCallback(
    async (mountedCheck: () => boolean = () => true) => {
      if (isValidatingOnlineRef.current) return;
      if (isManualLogoutRef.current) return;
      if (!isSupabaseConfigured) {
        if (mountedCheck()) setIsAuthLoading(false);
        return;
      }

      const offlineEval = storage.evaluateOfflineAccess();

      // If the user's 7-day offline access period has expired, require explicit online sign-in
      if (offlineEval.status === 'expired') {
        if (mountedCheck()) {
          setSession(null);
          setCurrentUser(null);
          setExpiredUserEmail(offlineEval.user.email);
          setView('landing');
          setIsAuthLoading(false);
        }
        return;
      }

      // If offline, do not attempt network validation or alter lastValidatedAt
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (mountedCheck()) {
          setIsAuthLoading(false);
        }
        return;
      }

      // Restore backed-up Supabase session token if an earlier offline refresh failure cleared it
      if (offlineEval.status === 'valid') {
        storage.restorePersistedSupabaseSessionIfNeeded(offlineEval.user.id);
      }

      if (!storage.hasPersistedSupabaseSession() && !hasUrlAuthCallback && offlineEval.status === 'none') {
        if (mountedCheck()) {
          setIsAuthLoading(false);
        }
        return;
      }

      isValidatingOnlineRef.current = true;
      try {
        // 1. Verify token directly against the live Supabase Auth server (GET /auth/v1/user)
        let {
          data: { user: verifiedUser },
          error: userError,
        } = await withTimeout(supabase.auth.getUser(), 5000);

        // 2. If getUser failed or returned no user, attempt a live token refresh using stored refreshToken
        if ((!verifiedUser || userError) && !isManualLogoutRef.current) {
          const authMeta = storage.getAuthMeta();
          if (authMeta?.refreshToken) {
            const refreshRes = await withTimeout(
              supabase.auth.refreshSession({ refresh_token: authMeta.refreshToken }),
              5000
            );
            if (refreshRes.data?.user && refreshRes.data?.session && !refreshRes.error) {
              verifiedUser = refreshRes.data.user;
              userError = null;
            } else if (refreshRes.error) {
              userError = refreshRes.error;
            }
          }
        }

        if (!mountedCheck() || isManualLogoutRef.current) return;

        if (verifiedUser && !userError) {
          // Genuinely validated online with Supabase Auth server
          const {
            data: { session: latestSession },
          } = await supabase.auth.getSession();
          const profile = formatSupabaseUser(verifiedUser);

          storage.recordOnlineAuthValidation(profile, {
            accessToken: latestSession?.access_token,
            refreshToken: latestSession?.refresh_token,
          });

          if (!mountedCheck()) return;
          setSession(latestSession);
          setCurrentUser(profile);
          setView((prev) => (prev === 'landing' ? 'dashboard' : prev));
          setIsAuthLoading(false);

          // Resume cloud synchronization in background
          syncService.pullFromCloud().then(() => {
            if (mountedCheck()) refreshRetirements();
            syncService.processQueue();
          });
          return;
        }

        // Handle error: distinguish temporary connectivity/server issues from confirmed auth failure
        const errorCategory = classifySupabaseAuthError(userError);

        if (errorCategory === 'confirmed_auth_failure') {
          storage.clearAuthSession();
          setSession(null);
          setCurrentUser(null);
          setActiveRetirement(null);
          setView('landing');
        } else {
          // Temporary connectivity / timeout / server error:
          // Preserve local auth state and keep user on dashboard if within 7-day grace period
          const latestEval = storage.evaluateOfflineAccess();
          if (latestEval.status === 'valid') {
            storage.restorePersistedSupabaseSessionIfNeeded(latestEval.user.id);
            setCurrentUser(latestEval.user);
            setView((prev) => (prev === 'landing' ? 'dashboard' : prev));
          } else if (latestEval.status === 'expired') {
            setSession(null);
            setCurrentUser(null);
            setExpiredUserEmail(latestEval.user.email);
            setView('landing');
          }
        }
      } catch (err) {
        // Network timeout or unexpected fetch failure — never log out a user within their 7-day grace window
        const latestEval = storage.evaluateOfflineAccess();
        if (mountedCheck() && latestEval.status === 'valid') {
          storage.restorePersistedSupabaseSessionIfNeeded(latestEval.user.id);
          setCurrentUser(latestEval.user);
        }
      } finally {
        isValidatingOnlineRef.current = false;
        if (mountedCheck()) {
          setIsAuthLoading(false);
        }
      }
    },
    [hasUrlAuthCallback, refreshRetirements]
  );

  // Initialize background auth check, auth state listener, and network reconnection listener
  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;

    // 1. Run non-blocking background validation on startup
    validateSessionInBackground(isMounted);

    // 2. Listen for Supabase auth state events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      if (isManualLogoutRef.current) return;

      const offlineEval = storage.evaluateOfflineAccess();

      // Do not allow cached INITIAL_SESSION to bypass an expired 7-day offline window
      if (offlineEval.status === 'expired' && event === 'INITIAL_SESSION') {
        setSession(null);
        setCurrentUser(null);
        setExpiredUserEmail(offlineEval.user.email);
        setView('landing');
        setIsAuthLoading(false);
        return;
      }

      if (newSession?.user) {
        setSession(newSession);
        const profile = formatSupabaseUser(newSession.user);
        setCurrentUser(profile);

        // Only update the 7-day validation timestamp on genuine online token refresh / sign-in events,
        // never merely from reading INITIAL_SESSION out of localStorage cache.
        if (
          (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED') &&
          typeof navigator !== 'undefined' &&
          navigator.onLine
        ) {
          storage.recordOnlineAuthValidation(profile, {
            accessToken: newSession.access_token,
            refreshToken: newSession.refresh_token,
          });

          syncService.pullFromCloud().then(() => {
            if (mounted) refreshRetirements();
            syncService.processQueue();
          });
        } else {
          storage.setCurrentUser(profile);
        }

        setView((prev) => (prev === 'landing' ? 'dashboard' : prev));
      } else {
        setSession(null);

        // If a background token refresh failed due to offline/network issues,
        // preserve offline access if still within the 7-day grace period!
        if (offlineEval.status === 'valid') {
          storage.restorePersistedSupabaseSessionIfNeeded(offlineEval.user.id);
          setCurrentUser(offlineEval.user);
        } else {
          if (offlineEval.status === 'expired') {
            setExpiredUserEmail(offlineEval.user.email);
          }
          setCurrentUser(null);
          setActiveRetirement(null);
          setView('landing');
        }
      }
      setIsAuthLoading(false);
    });

    // 3. When internet connectivity returns, resume online authentication validation & sync
    const handleOnline = () => {
      if (!mounted || isManualLogoutRef.current) return;
      validateSessionInBackground(isMounted);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [refreshRetirements, validateSessionInBackground]);

  // Update retirements whenever current user or view changes
  useEffect(() => {
    if (currentUser) {
      refreshRetirements();
    } else {
      setRetirements([]);
    }
  }, [currentUser, view, refreshRetirements]);

  // Protected route & 7-day grace period enforcement
  useEffect(() => {
    if (isAuthLoading) return;

    if (!currentUser) {
      if (view !== 'landing') {
        setView('landing');
      }
      return;
    }

    const offlineEval = storage.evaluateOfflineAccess();
    if (!session && offlineEval.status !== 'valid') {
      if (offlineEval.status === 'expired') {
        setExpiredUserEmail(offlineEval.user.email);
        setAuthMode('login');
        setShowAuthModal(true);
      }
      setCurrentUser(null);
      setActiveRetirement(null);
      setView('landing');
    }
  }, [isAuthLoading, session, currentUser, view]);

  const isAuthenticated = Boolean(
    currentUser && (session || storage.isOfflineAccessValid(currentUser.id))
  );

  const handleOpenRetirement = (retirement: Retirement) => {
    if (!currentUser || (!session && !storage.isOfflineAccessValid(currentUser.id))) {
      const offlineEval = storage.evaluateOfflineAccess();
      if (offlineEval.status === 'expired') {
        setExpiredUserEmail(offlineEval.user.email);
        setCurrentUser(null);
        setView('landing');
      }
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    setActiveRetirement(retirement);
    setView('retirement_home');
  };

  const handleRetirementCreated = (newRet: Retirement) => {
    refreshRetirements();
    setActiveRetirement(newRet);
    setView('retirement_home');
  };

  const handleEditRetirement = (ret: Retirement) => {
    setRetirementToEdit(ret);
    setShowCreateModal(true);
  };

  const handleRetirementAdded = (added: Retirement) => {
    refreshRetirements();
    setActiveRetirement(added);
    setView('retirement_home');
  };

  const handleTrashRetirement = (id: string) => {
    const target = storage.getRetirementById(id);
    if (target) {
      setRetirementToTrash(target);
    } else {
      storage.moveToTrash(id);
      refreshRetirements();
    }
  };

  const handleConfirmTrash = () => {
    if (retirementToTrash) {
      storage.moveToTrash(retirementToTrash.id);
      setRetirementToTrash(null);
      refreshRetirements();
    }
  };

  const handleRemoveImportedRetirement = (ret: Retirement) => {
    setRetirementToRemoveImported(ret);
  };

  const handleConfirmRemoveImported = () => {
    if (retirementToRemoveImported) {
      storage.removeImportedRetirement(retirementToRemoveImported.id);
      setRetirementToRemoveImported(null);
      refreshRetirements();
    }
  };

  const handleLoadDemo = () => {
    if (!currentUser) {
      setAuthMode('register');
      setShowAuthModal(true);
      return;
    }
    storage.loadDemoData(currentUser);
    refreshRetirements();
    setView('dashboard');
  };

  const handleClearDemo = () => {
    setShowClearDemoConfirm(true);
  };

  const handleConfirmClearDemo = () => {
    storage.clearDemoData();
    setShowClearDemoConfirm(false);
    refreshRetirements();
  };

  const handleLogout = async () => {
    isManualLogoutRef.current = true;
    // Immediately clear local authentication state so cached dashboard cannot be restored
    storage.clearAuthSession();
    setSession(null);
    setCurrentUser(null);
    setActiveRetirement(null);
    setRetirements([]);
    setExpiredUserEmail('');
    setView('landing');

    try {
      await withTimeout(supabase.auth.signOut(), 3000);
    } catch (err) {
      console.error('Supabase signOut error:', err);
    } finally {
      // Ensure any residual token written by signOut fallback is removed
      storage.clearAuthSession();
      isManualLogoutRef.current = false;
    }
  };

  const trashCount = currentUser ? storage.getTrashRetirements().length : 0;
  const hasDemo = storage.hasDemoData();

  // Filtered retirements on dashboard
  const filteredDashboardRetirements = retirements.filter((r) => {
    if (!dashboardSearch.trim()) return true;
    const q = dashboardSearch.toLowerCase().trim();
    return (
      r.title.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      r.project.toLowerCase().includes(q)
    );
  });

  // Initial loading splash screen
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mx-auto shadow-2xl">
            <HardHat className="w-8 h-8 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">myRet</h1>
            <p className="text-xs text-slate-400 mt-1">Verifying Supabase authentication session...</p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400/80">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Establishing secure site session</span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated: always render Landing Page with Auth modal triggers
  if (!isAuthenticated || !currentUser || view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
        <LandingPage
          onStartRetirement={() => {
            if (isAuthenticated && currentUser) {
              setView('dashboard');
            } else {
              setAuthMode('register');
              setShowAuthModal(true);
            }
          }}
          onLogin={() => {
            if (isAuthenticated && currentUser) {
              setView('dashboard');
            } else {
              setAuthMode('login');
              setShowAuthModal(true);
            }
          }}
          onOpenGuide={() => setShowGuideModal(true)}
          onOpenFAQ={() => setShowFAQModal(true)}
          onOpenAbout={() => setShowAboutModal(true)}
          onLoadDemo={() => {
            if (isAuthenticated && currentUser) {
              handleLoadDemo();
            } else {
              setAuthMode('login');
              setShowAuthModal(true);
            }
          }}
        />

        {/* Auth Modal */}
        <AuthModal
          isOpen={showAuthModal}
          initialMode={authMode}
          initialEmail={expiredUserEmail}
          onClose={() => setShowAuthModal(false)}
          onSuccess={(user) => {
            isManualLogoutRef.current = false;
            setExpiredUserEmail('');
            setCurrentUser(user);
            refreshRetirements();
            setView('dashboard');

            // Pull cloud data and process pending queue in background after login
            syncService.pullFromCloud().then(() => {
              refreshRetirements();
              syncService.processQueue();
            });
          }}
        />

        {/* Info Modals */}
        <GuideModal isOpen={showGuideModal} onClose={() => setShowGuideModal(false)} />
        <FAQModal isOpen={showFAQModal} onClose={() => setShowFAQModal(false)} />
        <AboutModal
          isOpen={showAboutModal}
          onClose={() => setShowAboutModal(false)}
          currentUser={currentUser}
        />
      </div>
    );
  }

  // Authenticated Protected Views
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      <DashboardHeader
        currentUser={currentUser}
        trashCount={trashCount}
        hasDemoData={hasDemo}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenTrash={() => setView('trash')}
        onOpenGuide={() => setShowGuideModal(true)}
        onOpenFAQ={() => setShowFAQModal(true)}
        onOpenAbout={() => setShowAboutModal(true)}
        onLoadDemo={handleLoadDemo}
        onClearDemo={handleClearDemo}
        onLogout={handleLogout}
        onGoHome={() => {
          setActiveRetirement(null);
          setView('dashboard');
        }}
        onOpenAdmin={() => setView('admin_users')}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* VIEW: ADMIN USER MANAGEMENT & MANUAL PASSWORD RESET */}
        {view === 'admin_users' && (
          <AdminUserManagement
            currentUser={currentUser}
            onBack={() => setView('dashboard')}
          />
        )}

        {/* VIEW: RETIREMENT WORKSPACE */}
        {view === 'retirement_home' && activeRetirement && (
          <RetirementHome
            retirement={activeRetirement}
            currentUser={currentUser}
            onBack={() => {
              setActiveRetirement(null);
              refreshRetirements();
              setView('dashboard');
            }}
            onRetirementUpdated={(updated) => {
              setActiveRetirement(updated);
              refreshRetirements();
            }}
            onRetirementDeleted={(id) => {
              setActiveRetirement(null);
              refreshRetirements();
              setView('dashboard');
            }}
          />
        )}

        {/* VIEW: TRASH & 48-HOUR RETENTION */}
        {view === 'trash' && (
          <TrashView
            onBack={() => {
              refreshRetirements();
              setView('dashboard');
            }}
            onRetirementRestored={() => {
              refreshRetirements();
            }}
          />
        )}

        {/* VIEW: MAIN DASHBOARD */}
        {view === 'dashboard' && (
          <div className="space-y-6 pb-16">
            {/* Site Utilities Nav */}
            <UtilitiesNav
              activeUtility={activeUtility}
              onSelectUtility={setActiveUtility}
            />

            {/* Dashboard Action Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    My Site Retirements
                  </h1>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Connected
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Signed in as <strong className="text-white">{currentUser.name}</strong> ({currentUser.email})
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isUserAdmin(currentUser) && (
                  <button
                    onClick={() => setView('admin_users')}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                    title="User Management & Password Reset"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>User Admin</span>
                  </button>
                )}

                <button
                  onClick={() => setShowAddExistingModal(true)}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Add Existing Retirement</span>
                </button>

                <button
                  onClick={() => {
                    setRetirementToEdit(null);
                    setShowCreateModal(true);
                  }}
                  className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Create New Retirement</span>
                </button>
              </div>
            </div>

            {/* Dashboard Search */}
            {retirements.length > 0 && (
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search retirements by title, project, or code (e.g. RET-7K4M2P)..."
                  value={dashboardSearch}
                  onChange={(e) => setDashboardSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {/* Retirements Grid or Empty State */}
            {retirements.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4 max-w-lg mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
                  <HardHat className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">No Retirements Yet</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                    Create your first retirement to start recording site expenditure, or explore with realistic sample construction data.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      setRetirementToEdit(null);
                      setShowCreateModal(true);
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                  >
                    Create Your First Retirement
                  </button>
                  <button
                    onClick={handleLoadDemo}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  >
                    Try Demo Data
                  </button>
                </div>
              </div>
            ) : filteredDashboardRetirements.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
                No retirements match your search "{dashboardSearch}".
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDashboardRetirements.map((ret) => (
                  <RetirementCard
                    key={ret.id}
                    retirement={ret}
                    currentUser={currentUser}
                    onOpen={handleOpenRetirement}
                    onEdit={handleEditRetirement}
                    onTrash={handleTrashRetirement}
                    onRemoveImported={handleRemoveImportedRetirement}
                    onExport={(r) => setExportTargetRetirement(r)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Modals */}
      <ProfileModal
        isOpen={showProfileModal}
        currentUser={currentUser}
        onClose={() => setShowProfileModal(false)}
        onProfileUpdated={(updated) => {
          setCurrentUser(updated);
          refreshRetirements();
        }}
      />

      <CreateRetirementModal
        isOpen={showCreateModal}
        currentUser={currentUser}
        retirementToEdit={retirementToEdit}
        onClose={() => {
          setShowCreateModal(false);
          setRetirementToEdit(null);
        }}
        onCreated={handleRetirementCreated}
        onUpdated={(updated) => {
          refreshRetirements();
          if (activeRetirement?.id === updated.id) {
            setActiveRetirement(updated);
          }
        }}
      />

      <AddExistingModal
        isOpen={showAddExistingModal}
        currentUser={currentUser}
        onClose={() => setShowAddExistingModal(false)}
        onAdded={handleRetirementAdded}
      />

      {exportTargetRetirement && (
        <ExportPdfModal
          isOpen={true}
          onClose={() => setExportTargetRetirement(null)}
          retirement={exportTargetRetirement}
          dailyRecords={storage.getDailyRecords(exportTargetRetirement.id)}
          supplementary={storage.getSupplementaryEntries(exportTargetRetirement.id)}
        />
      )}

      {/* Delete Retirement Confirmation Modal */}
      {retirementToTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Move to Trash Bin</h3>
                <p className="text-xs text-slate-400">48-Hour Recovery Available</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to move <strong className="text-white">{retirementToTrash.title}</strong> ({retirementToTrash.code}) to the Trash Bin?
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p>• The retirement and all its recorded expenses will be moved to the Trash Bin.</p>
              <p>• It will be removed from your active list immediately.</p>
              <p>• You can restore it anytime within 48 hours from the Trash Bin.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRetirementToTrash(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmTrash}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/20 transition"
              >
                Yes, Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Imported Retirement Confirmation Modal */}
      {retirementToRemoveImported && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remove Imported Retirement</h3>
                <p className="text-xs text-slate-400">Remove from Your Workspace Only</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Remove <strong className="text-white">{retirementToRemoveImported.title}</strong> ({retirementToRemoveImported.code}) from your workspace?
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p>• This only removes the retirement from your workspace.</p>
              <p>• The original owner&apos;s retirement, daily records, and supplementary entries remain completely untouched.</p>
              <p>• You can re-import it later using its code ({retirementToRemoveImported.code}) if you still have access.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRetirementToRemoveImported(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveImported}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/20 transition"
              >
                Remove from Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Demo Confirmation Modal */}
      {showClearDemoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Clear Demo Data</h3>
                <p className="text-xs text-slate-400">Reset Demo Ledgers</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Clear all simulated demo records? Any real retirements and entries you created will remain untouched.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowClearDemoConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearDemo}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition"
              >
                Clear Demo Data
              </button>
            </div>
          </div>
        </div>
      )}

      <GuideModal isOpen={showGuideModal} onClose={() => setShowGuideModal(false)} />
      <FAQModal isOpen={showFAQModal} onClose={() => setShowFAQModal(false)} />
      <AboutModal
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
        currentUser={currentUser}
      />
    </div>
  );
}
