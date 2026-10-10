import React, { useState } from 'react';
import {
  X,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  User,
  Mail,
  Lock,
} from 'lucide-react';
import { supabase } from '../../utils/supabaseClient';
import { storage } from '../../utils/storage';
import { UserProfile } from '../../types';

export interface AdminTargetUser {
  id: string;
  email: string;
  name?: string;
  designation?: string;
  created_at?: string;
}

interface AdminResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: AdminTargetUser | null;
  adminUser: UserProfile;
  onSuccess?: () => void;
}

export const AdminResetPasswordModal: React.FC<AdminResetPasswordModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  adminUser,
  onSuccess,
}) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen || !targetUser) return null;

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setIsConfirming(false);
    setError(null);
    setSuccessMessage(null);
    onClose();
  };

  const handleInitialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || !confirmPassword) {
      setError('Please enter and confirm the new temporary password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please ensure both fields are identical.');
      return;
    }

    // Move to explicit confirmation step
    setIsConfirming(true);
  };

  const handleExecuteReset = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Your administrative session has expired. Please sign in again.');
        setIsSubmitting(false);
        return;
      }

      // Call secure server-side endpoint
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          newPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Server rejected password reset request.');
      }

      // Record administrative activity audit log (WITHOUT the password)
      storage.logActivity(
        'admin-audit',
        'Admin Password Reset',
        `Administrator (${adminUser.email}) manually reset password for user ${targetUser.email}`
      );

      // Clean up sensitive state immediately
      setNewPassword('');
      setConfirmPassword('');
      setIsConfirming(false);
      setSuccessMessage(
        result.message ||
          'Password reset successfully. Give the temporary password to the user through a secure channel.'
      );

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error('Password reset failure:', err);
      setError(err?.message || 'Failed to execute password reset on server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Manual Password Reset</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Admin Action
                </span>
              </div>
              <p className="text-xs text-slate-400">Server-side manual password override for forgotten accounts</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected User Verification Details */}
        <div className="mt-4 p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 block">
            Target User Information
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-slate-500 block">Email Address:</span>
                <span className="font-semibold text-white truncate block">{targetUser.email}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-slate-500 block">Full Name:</span>
                <span className="font-semibold text-white truncate block">{targetUser.name || 'Not provided'}</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-900 truncate">
            UUID: {targetUser.id}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Success message view */}
        {successMessage ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Password Reset Successful</h3>
              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto mt-2 p-3 bg-emerald-950/40 rounded-xl border border-emerald-800/60 font-medium">
                {successMessage}
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
              >
                Close &amp; Return to User Management
              </button>
            </div>
          </div>
        ) : isConfirming ? (
          /* Confirmation Step */
          <div className="mt-4 space-y-4">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm text-amber-400">
                <ShieldAlert className="w-4 h-4" />
                <span>Confirm Password Reset</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to update the password for <strong className="text-white">{targetUser.email}</strong> in Supabase Auth?
              </p>
              <p className="text-[11px] text-slate-400">
                Their previous password will become invalid immediately. You will need to relay the temporary password to the user.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirming(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleExecuteReset}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-md shadow-amber-500/10 active:scale-95 transition disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing Reset...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Apply Reset</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Form Entry Step */
          <form onSubmit={handleInitialSubmit} className="mt-4 space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" /> New Temporary Password *
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-slate-400 hover:text-amber-400 flex items-center gap-1"
                >
                  {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Enter at least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-0.5">Minimum 6 characters. Alphanumeric recommended.</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Confirm Temporary Password *
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Re-enter temporary password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300">Security Notice:</p>
              <p>
                The new password will be committed directly to Supabase Auth via secure server-side Admin API. Never share credentials over public channels.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition"
              >
                <KeyRound className="w-4 h-4" />
                <span>Continue to Confirmation</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
