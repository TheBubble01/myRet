import React, { useState } from 'react';
import { X, User, Phone, Mail, Building, Briefcase, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { UserProfile } from '../../types';
import { supabase, formatSupabaseUser } from '../../utils/supabaseClient';
import { storage } from '../../utils/storage';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onProfileUpdated: (user: UserProfile) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
}) => {
  const [formData, setFormData] = useState({
    name: currentUser.name || '',
    designation: currentUser.designation || '',
    phone: currentUser.phone || '',
    email: currentUser.email || '',
    placement: currentUser.placement || '',
  });

  const [saved, setSaved] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    setError(null);

    try {
      // 1. Update user metadata in Supabase Auth
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: {
          name: formData.name.trim(),
          designation: formData.designation.trim(),
          phone: formData.phone.trim(),
          placement: formData.placement.trim(),
        },
      });

      if (updateError) {
        console.error('Supabase updateUser error:', updateError);
        setError(updateError.message);
        setIsUpdating(false);
        return;
      }

      // Also try to update public.profiles if table exists
      try {
        await supabase.from('profiles').upsert({
          id: currentUser.id,
          name: formData.name.trim(),
          designation: formData.designation.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          placement: formData.placement.trim(),
          updated_at: new Date().toISOString(),
        });
      } catch (dbErr) {
        // Table might not be deployed yet; auth metadata is primary
        console.log('Profiles table sync skipped/unreachable:', dbErr);
      }

      const updatedUser: UserProfile = data.user
        ? formatSupabaseUser(data.user)
        : {
            ...currentUser,
            name: formData.name.trim(),
            designation: formData.designation.trim(),
            phone: formData.phone.trim(),
            placement: formData.placement.trim(),
          };

      storage.updateProfile(updatedUser);
      onProfileUpdated(updatedUser);
      setSaved(true);
      setIsUpdating(false);

      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 700);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile in Supabase';
      setError(message);
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold flex items-center justify-center text-sm">
              {currentUser.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Site Engineer Profile</h2>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Verified
                </span>
              </div>
              <p className="text-xs text-slate-400">Official signatory on generated retirement and audit reports</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5 text-amber-400" /> Full Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Mubarak Jibril Dederi"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
              <Briefcase className="w-3.5 h-3.5 text-amber-400" /> Designation / Role *
            </label>
            <input
              type="text"
              required
              value={formData.designation}
              onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
              placeholder="e.g. Site Construction Engineer"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email Address
              </label>
              <input
                type="email"
                disabled
                value={formData.email}
                className="w-full px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-400 cursor-not-allowed"
                title="Account email cannot be modified"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                <Phone className="w-3.5 h-3.5 text-amber-400" /> Phone Number
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+234 803 123 4567"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
              <Building className="w-3.5 h-3.5 text-amber-400" /> Current Placement / Project Site *
            </label>
            <input
              type="text"
              required
              value={formData.placement}
              onChange={(e) => setFormData({ ...formData, placement: e.target.value })}
              placeholder="e.g. Borno State Specialist Hospital Renovation - Phase II"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>

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
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
            >
              {isUpdating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Profile...</span>
                </>
              ) : saved ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Profile</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
