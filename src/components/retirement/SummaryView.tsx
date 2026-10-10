import React from 'react';
import { Layers, Calendar, Calculator, ArrowLeft, BarChart2 } from 'lucide-react';
import { RetirementTotals } from '../../types';
import { formatNaira } from '../../utils/currency';

interface SummaryViewProps {
  totals: RetirementTotals;
  retirementTitle: string;
  retirementCode: string;
  onClose: () => void;
}

export const SummaryView: React.FC<SummaryViewProps> = ({
  totals,
  retirementTitle,
  retirementCode,
  onClose,
}) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {retirementCode}
              </span>
              <h2 className="text-lg font-bold text-white">Expenditure Reconciliation Summary</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{retirementTitle}</p>
          </div>
        </div>
      </div>

      {/* C. TOTAL SUMMARY CARDS (Top Overview) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
            Daily Retirement Total
          </span>
          <p className="text-xl font-extrabold text-white font-mono">
            {formatNaira(totals.dailyRetirementTotal)}
          </p>
          <span className="text-[10px] text-slate-500">Sum of all calendar site entries</span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
            Supplementary Total
          </span>
          <p className="text-xl font-extrabold text-white font-mono">
            {formatNaira(totals.supplementaryTotal)}
          </p>
          <span className="text-[10px] text-slate-500">Non-dated site disbursements</span>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 space-y-1 shadow-lg shadow-amber-500/5">
          <span className="text-[11px] font-black uppercase tracking-wider text-amber-400 block">
            General Total
          </span>
          <p className="text-2xl font-black text-amber-400 font-mono">
            {formatNaira(totals.generalTotal)}
          </p>
          <span className="text-[10px] text-amber-300/80">Daily Total + Supplementary</span>
        </div>
      </div>

      {/* Dual Tables Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* A. CATEGORY SUMMARY */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              A. Category Breakdown
            </h3>
          </div>

          {totals.categorySummaries.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4 text-center">No category entries found.</p>
          ) : (
            <div className="space-y-2">
              {totals.categorySummaries.map((cat, i) => {
                const percent = totals.generalTotal > 0 ? (cat.total / totals.generalTotal) * 100 : 0;
                return (
                  <div key={i} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">{cat.category}</span>
                      <span className="font-mono font-bold text-amber-400">{formatNaira(cat.total)}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 text-right">
                      {percent.toFixed(1)}% of general total
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* B. DAILY SUMMARY */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              B. Daily Expenditure Timeline
            </h3>
          </div>

          {totals.dailySummaries.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4 text-center">No daily logs recorded.</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {totals.dailySummaries.map((d, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <span className="font-medium text-slate-300">
                    {new Date(d.date).toLocaleDateString('en-GB', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="font-mono font-bold text-white">{formatNaira(d.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
