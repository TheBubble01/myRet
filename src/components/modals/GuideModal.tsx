import React from 'react';
import { X, BookOpen, CheckCircle, ArrowRight } from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const steps = [
    {
      num: 1,
      title: 'How to create a retirement',
      desc: 'Tap "Create New Retirement" on your dashboard. Give it a descriptive name (e.g. "Block B Substructure") and enter your current project/site placement. The app generates a human-friendly Retirement Code (e.g. RET-7K4M2P).',
    },
    {
      num: 2,
      title: 'How to add daily expenses',
      desc: 'Open your retirement and tap "Add Daily Record". Pick the expenditure date. You can add one or more categories for that day and enter individual labour and materials entries.',
    },
    {
      num: 3,
      title: 'How categories work',
      desc: 'Categories are completely dynamic. Use suggested standards (Excavation, Blockwork, Casting, Supply, Other Works) or create custom categories tailored to your site activity.',
    },
    {
      num: 4,
      title: 'How batch expense items calculate',
      desc: 'For each item, simply enter Description, Quantity, and Rate. The system automatically computes Amount = Quantity × Rate. Category subtotals and Daily Totals are calculated instantly without manual arithmetic.',
    },
    {
      num: 5,
      title: 'How to add Supplementary payments',
      desc: 'For site payments not tied to a specific date (e.g. emergency generator repair, urgent hardener purchase, or supervisor cash advances), use the "Supplementary" button. Enter Description and Amount.',
    },
    {
      num: 6,
      title: 'How to edit previously entered records',
      desc: 'Forgot an expense or need to adjust a rate? Click "Edit" on any daily card. Add missing items, modify numbers, or delete rows. Totals and category summaries recalculate immediately.',
    },
    {
      num: 7,
      title: 'How to share with a Supervisor or Auditor',
      desc: 'Click "Share / Access". Give other site personnel Reviewer (view/export) or Owner access using their email. They can also use "Add Existing Retirement" with your Retirement Code.',
    },
    {
      num: 8,
      title: 'How to export a professional PDF',
      desc: 'Tap "Export PDF". Choose either "Entire Retirement" or specify a "Selected Date Range". Download a publication-grade, audit-ready PDF formatted with your company placement, daily tables, supplementary section, and reconciliation summary.',
    },
    {
      num: 9,
      title: 'How connected retirements work',
      desc: 'Working on consecutive fortnights or linked phases? Connect Retirement A to Retirement B to review combined totals and generate joint consolidated expenditure statements without duplicating data.',
    },
    {
      num: 10,
      title: 'How Trash & 48-Hour Retention works',
      desc: 'Deleted retirements are safely held in the Trash for 48 hours. You can restore them at any time during this grace period, or permanently delete them when finished.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">myRet Site Engineer Field Manual</h2>
              <p className="text-xs text-slate-400">Step-by-step practical guide for construction-site expenditure management</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 overflow-y-auto space-y-3.5 pr-1 text-sm">
          {steps.map((s) => (
            <div key={s.num} className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center gap-2 font-semibold text-amber-400 mb-1">
                <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">
                  {s.num}
                </span>
                <span>{s.title}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed pl-7">{s.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
