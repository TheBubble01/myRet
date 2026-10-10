import React, { useState } from 'react';
import {
  FileSpreadsheet,
  ShieldCheck,
  Smartphone,
  WifiOff,
  Calculator,
  Share2,
  FileText,
  Clock,
  ArrowRight,
  CheckCircle2,
  BookOpen,
  HelpCircle,
  HardHat,
  Layers,
  Sparkles,
} from 'lucide-react';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface LandingPageProps {
  onStartRetirement: () => void;
  onLogin: () => void;
  onOpenGuide: () => void;
  onOpenFAQ: () => void;
  onOpenAbout: () => void;
  onLoadDemo: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartRetirement,
  onLogin,
  onOpenGuide,
  onOpenFAQ,
  onOpenAbout,
  onLoadDemo,
}) => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <HardHat className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight text-white flex items-center gap-1.5">
                myRet
              </span>
              <p className="text-[10px] text-slate-400 hidden sm:block">Site Expenditure &amp; Retirement Management</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-300">
            <a href="#what-it-does" className="hover:text-amber-400 transition">What It Does</a>
            <a href="#benefits" className="hover:text-amber-400 transition">Key Benefits</a>
            <a href="#how-it-works" className="hover:text-amber-400 transition">How It Works</a>
            <a href="#features" className="hover:text-amber-400 transition">Features</a>
            <button onClick={onOpenGuide} className="hover:text-amber-400 transition">Site Manual</button>
            <button onClick={onOpenFAQ} className="hover:text-amber-400 transition">FAQ</button>
            <button onClick={onOpenAbout} className="hover:text-amber-400 transition">About</button>
          </nav>

          <div className="flex items-center gap-2.5">
            <PWAInstallButton />
            <button
              onClick={onLogin}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition"
            >
              Sign In
            </button>
            <button
              onClick={onStartRetirement}
              className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/10 active:scale-95 transition"
            >
              Create a Retirement
            </button>
          </div>
        </div>
      </header>

      {/* 1. Hero Section */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />
        
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Site Expenditure &amp; Retirement Management</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-tight">
            Your Site Expenditure,{' '}
            <span className="text-amber-500 underline decoration-amber-500/40">Digitized.</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            Replace the physical retirement book with a simpler digital way to record, organize, and report construction site expenditures.
            <br className="hidden sm:inline" /><br className="hidden sm:inline" />
            Record daily labour and material expenses, organize them by category, calculate amounts automatically, manage supplementary disbursements, and generate professional PDF retirement reports ready for review and auditing.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onStartRetirement}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition"
            >
              <span>Create a Retirement</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onLoadDemo}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-amber-400" />
              <span>Try Demo Data</span>
            </button>
          </div>

          {/* Quick Metrics / Key highlights */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-left">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <Calculator className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-xs font-semibold text-slate-400">Automatic Calculations</p>
              <p className="text-xs sm:text-sm font-medium text-slate-200 mt-1 leading-snug">
                Quantity × Rate, category subtotals, daily totals, and overall expenditure are calculated automatically.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <FileText className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-xs font-semibold text-slate-400">Professional PDF Reports</p>
              <p className="text-xs sm:text-sm font-medium text-slate-200 mt-1 leading-snug">
                Generate clear, structured retirement reports with detailed expenditure records, summaries, reconciliation, and approval spaces.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <Smartphone className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-xs font-semibold text-slate-400">Works on Site</p>
              <p className="text-xs sm:text-sm font-medium text-slate-200 mt-1 leading-snug">
                Use myRet conveniently on your phone or computer, including in locations where internet connectivity may be limited.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <Clock className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-xs font-semibold text-slate-400">48-Hour Recovery</p>
              <p className="text-xs sm:text-sm font-medium text-slate-200 mt-1 leading-snug">
                Accidentally deleted a retirement? Deleted records remain available for recovery for 48 hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. What myRet Does */}
      <section id="what-it-does" className="py-16 bg-slate-900 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">The Construction Record-Keeping Problem</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">What myRet Does</h2>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Paper retirement books can become difficult to maintain as site activities grow. Manual calculations, scattered expenditure records, misplaced paperwork, and repeated preparation of summaries can make financial reporting unnecessarily time-consuming.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">1</div>
              <h3 className="text-base font-bold text-white">Record Daily Expenditure</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Record labour, materials, transportation, supplies, and other construction expenses under flexible categories for each date.
                <br /><br />
                Enter descriptions, quantities, and rates, and let myRet calculate the amounts automatically.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">2</div>
              <h3 className="text-base font-bold text-white">Manage Supplementary Expenses</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Record supplementary site disbursements such as emergency repairs, additional purchases, or other payments that are not tied to a specific daily expenditure record.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">3</div>
              <h3 className="text-base font-bold text-white">Connect Related Retirements</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Large or continuing projects can be divided into separate retirement records and connected when necessary.
                <br /><br />
                Each retirement keeps its original records while connected records can be included in a consolidated report.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold">4</div>
              <h3 className="text-base font-bold text-white">Generate Retirement Reports</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Generate a professional PDF report containing detailed expenditure records, category summaries, reconciliation totals, supplementary expenses, and spaces for review and approval.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Key Benefits */}
      <section id="benefits" className="py-16 bg-slate-950 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Why Use myRet?</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">Benefits for Site &amp; Office</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'Less Manual Calculation',
                desc: 'Amounts, category subtotals, daily totals, and overall expenditure are calculated automatically.',
              },
              {
                title: 'Clearer Records',
                desc: 'Every expenditure can be recorded with its description, quantity, rate, date, and category.',
              },
              {
                title: 'Easier Review',
                desc: 'Retirement records can be reviewed and shared using their unique retirement codes.',
              },
              {
                title: 'Professional Reports',
                desc: 'Generate structured PDF reports suitable for project review, record keeping, auditing, and approval.',
              },
              {
                title: 'Convenient on Site',
                desc: "Designed with everyday construction-site use in mind, whether you're working from an office or directly from the site.",
              },
              {
                title: 'Added Protection',
                desc: 'Deleted retirement records remain recoverable for 48 hours before permanent removal.',
              },
            ].map((b, i) => (
              <div key={i} className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <CheckCircle2 className="w-5 h-5 text-amber-400 mb-2.5" />
                <h4 className="text-sm font-bold text-white">{b.title}</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. How It Works */}
      <section id="how-it-works" className="py-16 bg-slate-900 border-t border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Simple 4-Step Site Workflow</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">How myRet Works</h2>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                step: '01',
                title: 'Create a Retirement',
                desc: 'Enter your project or work title and create a retirement record with a unique retirement code.',
              },
              {
                step: '02',
                title: 'Record Daily Expenses',
                desc: 'Select the date, choose or create an expense category, and enter the expenditure details.',
              },
              {
                step: '03',
                title: 'Add Supplementary Expenses',
                desc: 'Record additional disbursements separately whenever necessary.',
              },
              {
                step: '04',
                title: 'Generate Your Report',
                desc: 'Review your records and generate a professional PDF retirement report for submission, review, or auditing.',
              },
            ].map((s, i) => (
              <div key={i} className="p-5 rounded-xl bg-slate-950 border border-slate-800 relative">
                <span className="text-2xl font-black text-amber-500/30">{s.step}</span>
                <h4 className="text-sm font-bold text-white mt-1">{s.title}</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Features Grid */}
      <section id="features" className="py-16 bg-slate-950 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Engineered for Construction</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">Features</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <Calculator className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">Flexible Expense Categories</h4>
              <p className="text-xs text-slate-400">
                Use common construction categories such as Excavation, Blockwork, Casting, Supply, and other works—or create categories that suit your project.
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <FileText className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">Detailed Reports</h4>
              <p className="text-xs text-slate-400">
                Generate reports for an entire retirement or a selected date range, with detailed records and expenditure summaries.
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <Layers className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">Connected Retirements</h4>
              <p className="text-xs text-slate-400">
                Connect related retirement records and generate consolidated reports while keeping each retirement individually identifiable.
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <Clock className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">48-Hour Recovery</h4>
              <p className="text-xs text-slate-400">
                Deleted retirement records remain in the recovery area for 48 hours before permanent removal.
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <Smartphone className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">Convenient Access</h4>
              <p className="text-xs text-slate-400">
                Use myRet from your phone, tablet, or computer and continue working even when internet connectivity is limited.
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <Share2 className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white">Role-Based Sharing</h4>
              <p className="text-xs text-slate-400">
                Retirement records can be reviewed and shared securely using their unique retirement codes with Owner or Reviewer permissions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-16 bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-4xl font-black tracking-tight">
            Ready to Replace Your Paper Retirement Book?
          </h2>
          <p className="mt-3 text-sm sm:text-base font-medium opacity-90 max-w-xl mx-auto">
            Start recording your site expenditures with a simpler, more organized digital workflow.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onStartRetirement}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-slate-950 text-white font-extrabold text-sm shadow-xl hover:bg-slate-900 active:scale-95 transition"
            >
              Create a Retirement
            </button>
            <button
              onClick={onLoadDemo}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-amber-400/50 hover:bg-amber-400/70 border border-slate-900/20 text-slate-950 font-bold text-sm active:scale-95 transition"
            >
              Try Demo Data
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto bg-slate-950 border-t border-slate-800/80 py-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <HardHat className="w-4 h-4 text-amber-500" />
              <span className="font-bold text-slate-300">myRet</span>
              <span>&bull;</span>
              <span>Version 0.1.0</span>
              <span>&bull;</span>
              <span>Your Site Expenditure, Digitized.</span>
            </div>

            <div className="flex items-center gap-4 text-slate-400">
              <button onClick={onOpenGuide} className="hover:text-amber-400">Field Manual</button>
              <button onClick={onOpenFAQ} className="hover:text-amber-400">FAQ</button>
              <button onClick={onOpenAbout} className="hover:text-amber-400">About</button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-600">
            <div>
              <p className="font-medium text-slate-400">myRet &bull; Site Expenditure &amp; Retirement Management &bull; Version 0.1.0</p>
              <p>Designed &amp; Developed by MJ Dederi &bull; For MGK Global Limited</p>
            </div>
            <p>&copy; 2026 MGK Global Limited. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
