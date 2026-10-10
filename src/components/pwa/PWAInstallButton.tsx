import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed, hide
  if (isInstalled) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded-lg">
        <CheckCircle2 className="w-3.5 h-3.5" /> Installed PWA
      </span>
    );
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 px-3 py-1.5 text-xs font-semibold shadow-sm transition"
        title="Install myRet on your device"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
        >
          <Smartphone className="w-3.5 h-3.5 text-amber-400" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl bg-slate-800 border border-slate-700 p-6 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between pb-3 border-b border-slate-700">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-amber-400" />
                  Install myRet on iPhone / iPad
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-xs text-slate-300">
                <div className="flex items-start gap-2.5 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs">
                    1
                  </span>
                  <p>
                    Tap the <strong>Share</strong> button (box with an arrow pointing up) in Safari’s navigation bar.
                  </p>
                </div>
                <div className="flex items-start gap-2.5 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs">
                    2
                  </span>
                  <p>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-2.5 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs">
                    3
                  </span>
                  <p>
                    Tap <strong>Add</strong> in the top-right corner to launch myRet as a standalone mobile app on the jobsite!
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-amber-500 hover:bg-amber-400 py-2 text-xs font-bold text-slate-950"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback desktop / browser banner button (shows manual install tip)
  return (
    <button
      onClick={() => setShowIOSGuide(true)}
      className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
      title="Add to homescreen or install app"
    >
      <Download className="w-3.5 h-3.5 text-amber-400" />
      <span>Install PWA</span>
    </button>
  );
};
