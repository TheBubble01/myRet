import React from 'react';
import { X, HelpCircle } from 'lucide-react';

interface FAQModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FAQModal: React.FC<FAQModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const faqs = [
    {
      q: 'What is myRet?',
      a: 'myRet (My Retirement) is a digital construction-site expenditure and retirement management application designed specifically for site engineers, quantity surveyors, project supervisors, and site accountants. It eliminates messy physical retirement notebooks and calculation mistakes.',
    },
    {
      q: 'What is a "retirement" in construction?',
      a: 'A retirement is the formal operational account and physical proof presented by site personnel reconciling cash advances and site disbursements against actual physical materials purchased and site labour deployed.',
    },
    {
      q: 'How do I create a retirement?',
      a: 'From your main dashboard, tap "Create New Retirement", input your project/site title, and a unique Retirement Code (e.g. RET-7K4M2P) is issued immediately.',
    },
    {
      q: 'Can I add more categories?',
      a: 'Yes! Categories in myRet are 100% dynamic. You can use standard presets (Excavation, Blockwork, Casting, Supply, Other Works) or create any custom category matching your project bill of quantities (BOQ).',
    },
    {
      q: 'Can I edit an expense later?',
      a: 'Yes. Every daily expense record is completely editable. You can update quantities, change rates, add forgotten line items, or remove lines. Subtotals, daily totals, and general totals automatically update.',
    },
    {
      q: 'What is Supplementary?',
      a: 'Supplementary captures non-dated or independent site disbursements—such as emergency transport, unexpected machine rental, special site additives, or supervisor cash advances that occur outside standard daily labour logs.',
    },
    {
      q: 'Can my supervisor or auditor view my retirement?',
      a: 'Yes. As the owner, you can invite supervisors or auditors using their email, granting them "REVIEWER" access. They can inspect entries and generate PDF reports without altering your field records.',
    },
    {
      q: 'Can I export a PDF?',
      a: 'Yes. myRet produces an audit-ready, beautifully formatted PDF report containing complete item breakdowns, category subtotals, supplementary payments, summaries, and verification signature boxes.',
    },
    {
      q: 'Can I export only a selected date range?',
      a: 'Yes! When exporting, you can choose "Selected Date Range" and specify the start and end dates (e.g. 01/10/2026 to 15/10/2026). The PDF will contain only those days, plus supplementary entries and a recalculated date-range summary.',
    },
    {
      q: 'Can I combine multiple retirements?',
      a: 'Yes. With "Connected Retirements", you can link related project phases (e.g. Substructure Part 1 and Part 2) to compute combined expenditure and output a joint consolidated statement while keeping original records distinct.',
    },
    {
      q: 'What happens when I delete a retirement?',
      a: 'Deleted retirements are sent to the Trash and kept recoverable for 48 hours. If accidentally deleted on the site, you can restore it within 48 hours with all items intact.',
    },
    {
      q: 'Does myRet work without internet on remote jobsites?',
      a: 'Yes! myRet is an offline-capable Progressive Web App (PWA). If mobile network drops on remote sites, your entries remain safely saved on your device and can be synchronized when connectivity returns.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Frequently Asked Questions</h2>
              <p className="text-xs text-slate-400">Everything you need to know about using myRet on site</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 overflow-y-auto space-y-3 pr-1 text-sm">
          {faqs.map((f, i) => (
            <div key={i} className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <h3 className="font-semibold text-amber-400 text-xs sm:text-sm mb-1">{f.q}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
          >
            Close FAQ
          </button>
        </div>
      </div>
    </div>
  );
};
