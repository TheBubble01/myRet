import React, { useState } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  UserPlus,
  Shield,
  Trash2,
  AlertCircle,
  KeyRound,
} from 'lucide-react';
import { Retirement, UserProfile, UserRole } from '../../types';
import { storage } from '../../utils/storage';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  retirement: Retirement;
  currentUser: UserProfile;
  onUpdateRetirement: (updated: Retirement) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  retirement,
  currentUser,
  onUpdateRetirement,
}) => {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('REVIEWER');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOwner = retirement.ownerId === currentUser.id;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(retirement.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGrantAccess = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Please provide an email address.');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    // Check if already in access list
    if (retirement.access.some((a) => a.userEmail.toLowerCase() === cleanEmail)) {
      setError('This user is already granted access to this retirement.');
      return;
    }

    const newAccess = [
      ...retirement.access,
      {
        userId: `usr-${Date.now()}`,
        userEmail: cleanEmail,
        userName: name.trim() || cleanEmail.split('@')[0],
        role,
        grantedAt: new Date().toISOString(),
      },
    ];

    const updated: Retirement = {
      ...retirement,
      access: newAccess,
    };

    storage.saveRetirement(updated);
    storage.logActivity(
      retirement.id,
      'Access Granted',
      `Granted ${role} access to ${cleanEmail}`
    );

    onUpdateRetirement(updated);
    setEmail('');
    setName('');
  };

  const handleRevoke = (userEmail: string) => {
    if (!isOwner) return;
    const updatedAccess = retirement.access.filter(
      (a) => a.userEmail.toLowerCase() !== userEmail.toLowerCase()
    );

    const updated: Retirement = {
      ...retirement,
      access: updatedAccess,
    };

    storage.saveRetirement(updated);
    storage.logActivity(
      retirement.id,
      'Access Revoked',
      `Revoked access for ${userEmail}`
    );

    onUpdateRetirement(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Share &amp; Access Control</h2>
              <p className="text-xs text-slate-400">Collaborate with Site Supervisors and Auditors</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1">
          {/* Retirement Code Share Card */}
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                Human-Readable Retirement Code
              </span>
              <p className="font-mono text-lg font-black text-amber-400 tracking-wider">
                {retirement.code}
              </p>
            </div>
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>

          {/* Invite Form (only if Owner) */}
          {isOwner ? (
            <form onSubmit={handleGrantAccess} className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                <span>Grant Access to Site Supervisor or Auditor</span>
              </h3>

              {error && (
                <div className="p-2 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-200 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Engr. Aliyu Sanusi"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="auditor@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 font-medium">Role:</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-amber-400 font-bold focus:outline-none"
                  >
                    <option value="REVIEWER">REVIEWER (View &amp; Export)</option>
                    <option value="OWNER">OWNER (Full Control)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  Grant Access
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400">
              You are accessing this retirement as a <strong>Reviewer</strong>. Only the Owner ({retirement.ownerName}) can grant or revoke member permissions.
            </div>
          )}

          {/* Current Authorized Users */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Authorized Personnel ({retirement.access.length})
            </h4>

            <div className="space-y-2">
              {retirement.access.map((acc, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{acc.userName}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          acc.role === 'OWNER'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        {acc.role}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{acc.userEmail}</p>
                  </div>

                  {isOwner && acc.userEmail.toLowerCase() !== retirement.access[0]?.userEmail.toLowerCase() && (
                    <button
                      onClick={() => handleRevoke(acc.userEmail)}
                      className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition"
                      title="Revoke access"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
