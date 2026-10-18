import React, { useState } from 'react';
import { X, Search, KeyRound, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Retirement, UserProfile } from '../../types';
import { storage } from '../../utils/storage';
import { syncService } from '../../utils/syncService';

interface AddExistingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onAdded: (retirement: Retirement) => void;
}

export const AddExistingModal: React.FC<AddExistingModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAdded,
}) => {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setError('Please enter a valid Retirement Code.');
      return;
    }

    setIsLoading(true);

    try {
      let retirement: Retirement | undefined = undefined;

      // 1. When online, claim in cloud first so retirement_access is recorded and any pending removal is cleared
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const claimed = await syncService.claimRetirementByCode(cleanCode);
          if (claimed) {
            retirement = claimed;
          }
        } catch (cloudErr: any) {
          console.warn('[AddExistingModal] Cloud claim error:', cloudErr);
          const localMatch = storage.getRetirementByCode(cleanCode);
          if (!localMatch && cloudErr?.message && !cloudErr.message.includes('schema cache')) {
            setError(cloudErr.message);
            setIsLoading(false);
            return;
          }
        }
      }

      // 2. Fallback to local storage if offline or not yet synced to cloud
      if (!retirement) {
        retirement = storage.getRetirementByCode(cleanCode);
      }

      if (!retirement) {
        setError(`No retirement found with code "${cleanCode}". Please verify the code with the site owner.`);
        setIsLoading(false);
        return;
      }

      if (retirement.status === 'in_trash') {
        setError('This retirement is currently in the Trash and cannot be accessed.');
        setIsLoading(false);
        return;
      }

      // Check if user already has access
      const isOwner = retirement.ownerId === currentUser.id;
      const hasAccess = retirement.access.some(
        (a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase()
      );

      if (isOwner || hasAccess) {
        setSuccess('Retirement linked successfully!');
        setIsLoading(false);
        setTimeout(() => {
          onAdded(retirement!);
          onClose();
        }, 500);
        return;
      }

      // Grant Reviewer access for matching shared code
      retirement.access.push({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userName: currentUser.name,
        role: 'REVIEWER',
        grantedAt: new Date().toISOString(),
      });
      storage.saveRetirement(retirement);
      storage.logActivity(
        retirement.id,
        'Access Granted via Code',
        `${currentUser.name} added retirement ${retirement.code} as Reviewer`
      );

      setSuccess(`Successfully linked to ${retirement.title} as Reviewer!`);
      setIsLoading(false);
      setTimeout(() => {
        onAdded(retirement!);
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err?.message || 'Failed to claim retirement. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Add Existing Retirement</h2>
              <p className="text-xs text-slate-400">Access a shared site retirement using its code</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Retirement Code (Format: RET-XXXXXX)
            </label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="e.g. RET-7K4M2P"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full pl-3.5 pr-10 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono uppercase text-amber-400 font-bold tracking-wider focus:outline-none focus:border-amber-500 placeholder:text-slate-600"
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute right-3.5 top-3 pointer-events-none" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Obtain the 6-character code from the site engineer or owner.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-xs text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Find &amp; Add</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
