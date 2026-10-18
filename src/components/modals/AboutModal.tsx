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
              <p className="text-xs text-amber-400 font-mono">myRet Version 0.1.0</p>
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
              myRet is designed to simplify construction site expenditure recording by replacing tedious, error-prone paper retirement notebooks with a digital solution. By streamlining daily labour and materials logging, automating arithmetic calculations, recording supplementary disbursements, and generating audit-ready PDF reports, myRet bridges the gap between site operations and corporate accounting.
            </p>
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

          <div className="p-3.5 bg-slate-800/40 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-2">
            <p className="font-semibold text-white">Designed &amp; Developed by MJ Dederi</p>
            <p className="text-slate-300">
              Have questions, feedback, or suggestions? Feel free to get in touch.
            </p>
            <p className="text-slate-300">
              Email:{' '}
              <a
                href="mailto:dederimubarak@gmail.com"
                className="text-amber-400 hover:underline font-medium"
              >
                dederimubarak@gmail.com
              </a>
            </p>
            <p className="text-slate-300">
              Facebook:{' '}
              <a
                href="https://www.facebook.com/mubarak.jibrildederi.1"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:underline font-medium"
              >
                Message the creator on Facebook.
              </a>
            </p>
            <p className="pt-1 text-slate-300">For MGK Global Services ltd</p>
            <p className="text-[11px] text-slate-500">
              &copy; 2026 MGK Global Services Ltd. All rights reserved.
            </p>
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
