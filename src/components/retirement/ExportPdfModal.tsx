import React, { useState } from 'react';
import {
  X,
  FileText,
  Download,
  Calendar,
  Layers,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileDown,
} from 'lucide-react';
import { Retirement, DailyRecord, SupplementaryEntry } from '../../types';
import { generateRetirementPDF } from '../../utils/pdfGenerator';
import { loadPDFFonts } from '../../utils/pdfFonts';
import { storage } from '../../utils/storage';
import { formatNaira } from '../../utils/currency';

interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  retirement: Retirement;
  dailyRecords: DailyRecord[];
  supplementary: SupplementaryEntry[];
}

export const ExportPdfModal: React.FC<ExportPdfModalProps> = ({
  isOpen,
  onClose,
  retirement,
  dailyRecords,
  supplementary,
}) => {
  const [exportScope, setExportScope] = useState<'entire' | 'range'>('entire');

  // Dates in retirement
  const availableDates = dailyRecords.map((r) => r.date).sort();
  const defaultStart = availableDates.length > 0 ? availableDates[0] : '';
  const defaultEnd = availableDates.length > 0 ? availableDates[availableDates.length - 1] : '';

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [includeConnected, setIncludeConnected] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Prefetch fonts when modal opens so export is instantaneous
  React.useEffect(() => {
    if (isOpen) {
      loadPDFFonts();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const connectedList = (retirement.connectedRetirementIds || []).map((id) => {
    const connRet = storage.getRetirementById(id);
    const connDaily = connRet ? storage.getDailyRecords(connRet.id) : [];
    const connSupp = connRet ? storage.getSupplementaryEntries(connRet.id) : [];
    return { retirement: connRet, dailyRecords: connDaily, supplementary: connSupp };
  }).filter((c) => c.retirement !== undefined) as {
    retirement: Retirement;
    dailyRecords: DailyRecord[];
    supplementary: SupplementaryEntry[];
  }[];

  const handleDownloadPDF = async () => {
    setIsExporting(true);
    setDownloadSuccess(false);

    try {
      const doc = await generateRetirementPDF({
        retirement,
        dailyRecords,
        supplementary,
        startDate: exportScope === 'range' ? startDate : undefined,
        endDate: exportScope === 'range' ? endDate : undefined,
        connectedRetirements: includeConnected ? connectedList : undefined,
      });

      const fileName = `${retirement.code}_${retirement.title.replace(/\s+/g, '_')}_Report.pdf`;
      doc.save(fileName);

      storage.logActivity(
        retirement.id,
        'PDF Export Generated',
        `Generated ${exportScope === 'range' ? 'date-range' : 'full'} PDF report (${fileName})`
      );

      setDownloadSuccess(true);
      setTimeout(() => {
        setIsExporting(false);
      }, 1000);
    } catch (e) {
      console.error('PDF Generation failed:', e);
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <FileDown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Export Audit-Ready PDF</h2>
              <p className="text-xs text-slate-400">Official site expenditure retirement statement</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-4 overflow-y-auto pr-1">
          {/* Metadata preview card */}
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Retirement Title:</span>
              <span className="font-bold text-white">{retirement.title}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Retirement Code:</span>
              <span className="font-mono text-amber-400 font-bold">{retirement.code}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Engineer / Signatory:</span>
              <span className="text-slate-200">{retirement.ownerName} ({retirement.ownerDesignation})</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Site Placement:</span>
              <span className="text-slate-200">{retirement.project}</span>
            </div>
          </div>

          {/* Scope Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">
              Select Export Duration:
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setExportScope('entire')}
                className={`p-3 rounded-xl border text-left transition ${
                  exportScope === 'entire'
                    ? 'bg-amber-500/15 border-amber-500 text-white font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs">Entire Retirement</div>
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                  All recorded days ({dailyRecords.length} dates)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExportScope('range')}
                className={`p-3 rounded-xl border text-left transition ${
                  exportScope === 'range'
                    ? 'bg-amber-500/15 border-amber-500 text-white font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs">Selected Date Range</div>
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                  Custom calendar period window
                </div>
              </button>
            </div>
          </div>

          {/* Date Range Inputs */}
          {exportScope === 'range' && (
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">From Date:</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">To Date:</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500 italic">
                Supplementary payments are automatically appended at the end before reconciliation.
              </p>
            </div>
          )}

          {/* Connected Retirements Checkbox (if any) */}
          {connectedList.length > 0 && (
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    Include {connectedList.length} Connected Retirement(s)
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Outputs consolidated statement while preserving individual source tags
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeConnected}
                onChange={(e) => setIncludeConnected(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 border-slate-700 bg-slate-900"
              />
            </div>
          )}

          {downloadSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Official PDF Report downloaded successfully to your device!</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownloadPDF}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'Generating PDF...' : 'Download Official PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
