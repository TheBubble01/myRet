import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Mail,
  UserCheck,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Lock,
  ArrowLeft,
  Key,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { supabase } from '../../utils/supabaseClient';
import { AdminResetPasswordModal, AdminTargetUser } from './AdminResetPasswordModal';

interface SupabaseAdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  user_metadata: {
    name?: string;
    designation?: string;
    phone?: string;
    placement?: string;
    role?: string;
  };
}

interface AdminUserManagementProps {
  currentUser: UserProfile;
  onBack: () => void;
}

export const AdminUserManagement: React.FC<AdminUserManagementProps> = ({
  currentUser,
  onBack,
}) => {
  const [users, setUsers] = useState<SupabaseAdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceKeyConfigured, setServiceKeyConfigured] = useState(true);

  // Setup service key state (server-side only)
  const [inputServiceKey, setInputServiceKey] = useState('');
  const [isConfiguringKey, setIsConfiguringKey] = useState(false);
  const [keyConfigSuccess, setKeyConfigSuccess] = useState<string | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Target user for password reset modal
  const [selectedUser, setSelectedUser] = useState<AdminTargetUser | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  // Direct reset by email or UUID
  const [showDirectInput, setShowDirectInput] = useState(false);
  const [directEmailOrId, setDirectEmailOrId] = useState('');

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Administrative session expired. Please sign in again.');
        setIsLoading(false);
        return;
      }

      const res = await fetch('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch users from server.');
      }

      if (data.serviceKeyConfigured === false) {
        setServiceKeyConfigured(false);
      } else {
        setServiceKeyConfigured(true);
        setUsers(data.users || []);
      }
    } catch (err: any) {
      console.error('Error fetching admin users:', err);
      setError(err?.message || 'Could not load users from Supabase Auth.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleConfigureServiceKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputServiceKey.trim()) return;

    setIsConfiguringKey(true);
    setError(null);
    setKeyConfigSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Session expired');
      }

      const res = await fetch('/api/admin/set-service-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          serviceRoleKey: inputServiceKey.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save service key on server');
      }

      setInputServiceKey('');
      setKeyConfigSuccess('Service role key verified and saved securely on server.');
      setServiceKeyConfigured(true);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to verify key');
    } finally {
      setIsConfiguringKey(false);
    }
  };

  const handleInitiateReset = (user: SupabaseAdminUser) => {
    setSelectedUser({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name,
      designation: user.user_metadata?.designation,
      created_at: user.created_at,
    });
    setShowResetModal(true);
  };

  const handleInitiateDirectReset = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = directEmailOrId.trim();
    if (!clean) return;

    // Check if user is in fetched users
    const matched = users.find(
      (u) => u.email.toLowerCase() === clean.toLowerCase() || u.id === clean
    );
    if (matched) {
      handleInitiateReset(matched);
    } else {
      setSelectedUser({
        id: clean,
        email: clean.includes('@') ? clean : `${clean} (UUID)`,
        name: clean.includes('@') ? clean.split('@')[0] : 'Supabase User',
        designation: 'Site Personnel',
      });
      setShowResetModal(true);
    }
    setDirectEmailOrId('');
    setShowDirectInput(false);
  };

  const filteredUsers = users.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const emailMatch = u.email?.toLowerCase().includes(q);
    const nameMatch = u.user_metadata?.name?.toLowerCase().includes(q);
    const desigMatch = u.user_metadata?.designation?.toLowerCase().includes(q);
    return emailMatch || nameMatch || desigMatch;
  });

  return (
    <div className="space-y-6 pb-16">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
                User Management
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Admin Portal
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage registered construction site personnel and execute manual password resets
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => setShowDirectInput(!showDirectInput)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-400 transition"
            title="Reset password for any user by email or UUID"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Reset by Email/ID</span>
          </button>

          <button
            onClick={fetchUsers}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Direct User Reset Form (Optional quick drawer) */}
      {showDirectInput && (
        <form
          onSubmit={handleInitiateDirectReset}
          className="p-4 rounded-2xl bg-slate-900 border border-amber-500/30 space-y-2 text-slate-200"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Quick Reset by User Email or UUID
            </span>
            <button
              type="button"
              onClick={() => setShowDirectInput(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Enter the exact email address or Supabase Auth User ID (UUID) of the account to reset:
          </p>
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              required
              placeholder="e.g. engineer@site.com or 1a2b3c4d-..."
              value={directEmailOrId}
              onChange={(e) => setDirectEmailOrId(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Select User</span>
            </button>
          </div>
        </form>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {/* Service Role Key Server Configuration Banner if missing */}
      {!serviceKeyConfigured && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 text-slate-200">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <Key className="w-4 h-4" />
            <span>Supabase Service Role Key Required on Server</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            To use the server-side Admin Auth API for manual password resets and user listing, your Supabase <strong>service_role</strong> key must be present in the server environment. This key is stored strictly on the server and is NEVER sent to client browsers.
          </p>

          <form onSubmit={handleConfigureServiceKey} className="space-y-2 pt-1 max-w-xl">
            <label className="text-[11px] font-semibold text-slate-300 block">
              Enter Supabase Service Role Key (from Supabase Dashboard → Project Settings → API)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                required
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={inputServiceKey}
                onChange={(e) => setInputServiceKey(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={isConfiguringKey}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isConfiguringKey ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <span>Verify &amp; Save on Server</span>
                )}
              </button>
            </div>
            {keyConfigSuccess && (
              <p className="text-xs text-emerald-400 flex items-center gap-1 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{keyConfigSuccess}</span>
              </p>
            )}
          </form>
        </div>
      )}

      {/* Search and stats bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search users by name, email, or designation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="text-xs text-slate-400">
          Showing <strong className="text-white">{filteredUsers.length}</strong> of{' '}
          <strong className="text-white">{users.length}</strong> registered users
        </div>
      </div>

      {/* Users table */}
      {isLoading ? (
        <div className="p-16 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-amber-500 mx-auto" />
          <p className="text-xs text-slate-400">Querying Supabase Auth Admin users...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-3">
          <Users className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Users Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {users.length === 0
              ? 'No users returned from Supabase Auth.'
              : `No users matched "${searchQuery}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => {
            const name = user.user_metadata?.name || user.email.split('@')[0];
            const designation = user.user_metadata?.designation || 'Site Personnel';
            const placement = user.user_metadata?.placement || 'Site Project';
            const isSelf = user.id === currentUser.id;

            return (
              <div
                key={user.id}
                className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* User info */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-400 font-bold flex items-center justify-center text-sm flex-shrink-0">
                    {name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .substring(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-white truncate">{name}</h3>
                      {isSelf && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                          Current Admin (You)
                        </span>
                      )}
                      {(user.user_metadata?.role === 'admin' || user.email === 'elmubaraq69@gmail.com') && !isSelf && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
                          Admin
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                      <Mail className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </p>

                    <p className="text-[11px] text-slate-400 mt-1">
                      <span>{designation}</span> &bull; <span className="text-slate-500">{placement}</span>
                    </p>

                    <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 flex-wrap">
                      <span>Registered: {new Date(user.created_at).toLocaleDateString()}</span>
                      {user.last_sign_in_at && (
                        <span>Last Active: {new Date(user.last_sign_in_at).toLocaleDateString()}</span>
                      )}
                      <span className="font-mono text-slate-600">ID: {user.id.substring(0, 8)}...</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end sm:self-auto flex-shrink-0">
                  <button
                    onClick={() => handleInitiateReset(user)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-bold text-xs shadow-sm transition"
                    title={`Reset password for ${user.email}`}
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Reset Password</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Admin Reset Password Modal */}
      <AdminResetPasswordModal
        isOpen={showResetModal}
        onClose={() => {
          setShowResetModal(false);
          setSelectedUser(null);
        }}
        targetUser={selectedUser}
        adminUser={currentUser}
        onSuccess={() => {
          // Keep modal open to show the required success notice
        }}
      />
    </div>
  );
};
