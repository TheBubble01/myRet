import React, { useState } from 'react';
import { X, Info, ShieldCheck, Database, Check, Copy } from 'lucide-react';
import { storage } from '../../utils/storage';
import { isUserAdmin } from '../../utils/supabaseClient';
import { UserProfile } from '../../types';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserProfile | null;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [copied, setCopied] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(storage.getSupabaseConfig().url);
  const [supabaseKey, setSupabaseKey] = useState(storage.getSupabaseConfig().anonKey);
  const [savedSettings, setSavedSettings] = useState(false);

  const activeUser = currentUser !== undefined ? currentUser : storage.getCurrentUser();
  const isAdmin = isUserAdmin(activeUser);

  if (!isOpen) return null;

  const handleSaveSupabase = (e: React.FormEvent) => {
    e.preventDefault();
    storage.setSupabaseConfig({
      url: supabaseUrl,
      anonKey: supabaseKey,
      connected: !!(supabaseUrl && supabaseKey),
    });
    setSavedSettings(true);
    setTimeout(() => setSavedSettings(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">About myRet</h2>
              <p className="text-xs text-amber-400 font-mono">myRet Version 0.1.0 (Production-Ready Field Edition)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 overflow-y-auto space-y-4 pr-1 text-xs sm:text-sm text-slate-300">
          <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/60">
            <h3 className="font-semibold text-white text-sm mb-1">Product Mission</h3>
            <p className="text-slate-300 leading-relaxed text-xs">
              <strong>myRet</strong> is engineered to liberate construction project teams from tedious, error-prone manual physical retirement notebooks. By streamlining daily labour and materials logging, automated arithmetic calculations, non-dated supplementary disbursements, and instant audit-ready PDF report generation, myRet bridges the gap between field site operations and corporate accounting.
            </p>
          </div>

          <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/60">
            <h3 className="font-semibold text-white text-sm mb-1">Architecture &amp; Reliability</h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span><strong>Progressive Web App (PWA):</strong> Fully installable on iOS, Android, and desktop browsers.</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span><strong>Offline-First Resilience:</strong> Works uninterrupted on remote jobsites without network signal.</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span><strong>48-Hour Trash Recovery:</strong> Safety margin preventing accidental jobsite data loss.</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span><strong>Currency:</strong> Native Nigerian Naira (₦) formatting with high-precision arithmetic.</span>
              </li>
            </ul>
          </div>

          {/* Cloud backend config panel */}
          {isAdmin && (
            <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/60">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
                  <Database className="w-4 h-4" />
                  <span>Cloud Database Sync (Optional)</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  Cloud Sync
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                The application runs out of the box with persistent offline storage. If connecting to a live cloud database, provide your connection details below:
              </p>
              <form onSubmit={handleSaveSupabase} className="space-y-2">
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">Project URL</label>
                  <input
                    type="text"
                    placeholder="https://xyzcompany.supabase.co"
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">Public Access Key</label>
                  <input
                    type="password"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={supabaseKey}
                    onChange={(e) => setSupabaseKey(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-400">
                    Cloud synchronization configuration
                  </span>
                  <button
                    type="submit"
                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                  >
                    {savedSettings ? 'Saved!' : 'Save Config'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="p-3.5 bg-slate-800/40 rounded-xl border border-slate-800 text-xs text-slate-400">
            <p className="font-semibold text-slate-300 mb-0.5">Designed &amp; Developed by MJ Dederi</p>
            <p>For MGK Global Limited</p>
            <p className="mt-1 text-[11px] text-slate-500">&copy; 2026 MGK Global Limited. All rights reserved.</p>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
