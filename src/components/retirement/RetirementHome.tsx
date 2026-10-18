import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Plus,
  Calendar,
  Layers,
  Banknote,
  FileText,
  Share2,
  History,
  Link2,
  Search,
  Filter,
  Edit3,
  Trash2,
  Building,
  User,
  Clock,
  HardHat,
  Tag,
  ChevronDown,
  Sparkles,
  LogOut,
} from 'lucide-react';
import { Retirement, DailyRecord, SupplementaryEntry, UserProfile } from '../../types';
import { storage } from '../../utils/storage';
import { formatNaira } from '../../utils/currency';
import { DailyRecordModal } from './DailyRecordModal';
import { SupplementaryModal } from './SupplementaryModal';
import { SummaryView } from './SummaryView';
import { ExportPdfModal } from './ExportPdfModal';
import { ShareModal } from './ShareModal';
import { ConnectRetirementModal } from './ConnectRetirementModal';
import { ActivityHistoryModal } from './ActivityHistoryModal';
import { CreateRetirementModal } from '../dashboard/CreateRetirementModal';

interface RetirementHomeProps {
  retirement: Retirement;
  currentUser: UserProfile;
  onBack: () => void;
  onRetirementUpdated: (updated: Retirement) => void;
  onRetirementDeleted?: (id: string) => void;
}

export const RetirementHome: React.FC<RetirementHomeProps> = ({
  retirement: initialRetirement,
  currentUser,
  onBack,
  onRetirementUpdated,
  onRetirementDeleted,
}) => {
  const [retirement, setRetirement] = useState<Retirement>(initialRetirement);
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>(() =>
    storage.getDailyRecords(initialRetirement.id)
  );
  const [supplementary, setSupplementary] = useState<SupplementaryEntry[]>(() =>
    storage.getSupplementaryEntries(initialRetirement.id)
  );

  // Modals state
  const [showDailyModal, setShowDailyModal] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<DailyRecord | null>(null);
  const [showSupplementaryModal, setShowSupplementaryModal] = useState(false);
  const [showSummaryView, setShowSummaryView] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRemoveImportedConfirm, setShowRemoveImportedConfirm] = useState(false);
  const [showEditRetirementModal, setShowEditRetirementModal] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<{ id: string; date: string } | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const reloadData = () => {
    const currentRet = storage.getRetirementById(retirement.id) || retirement;
    setRetirement(currentRet);
    setDailyRecords(storage.getDailyRecords(retirement.id));
    setSupplementary(storage.getSupplementaryEntries(retirement.id));
    onRetirementUpdated(currentRet);
  };

  const totals = useMemo(() => {
    return storage.calculateTotals(retirement.id);
  }, [dailyRecords, supplementary, retirement.id]);

  const isOwner = retirement.ownerId === currentUser.id;
  const userAccess = retirement.access.find(
    (a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase()
  );
  const role = isOwner ? 'OWNER' : userAccess?.role || 'REVIEWER';
  const canEdit = role === 'OWNER';
  const canDelete = isOwner;

  const handleDeleteWholeRetirement = () => {
    storage.moveToTrash(retirement.id);
    if (onRetirementDeleted) {
      onRetirementDeleted(retirement.id);
    } else {
      onBack();
    }
  };

  const handleRemoveImportedRetirement = () => {
    storage.removeImportedRetirement(retirement.id);
    if (onRetirementDeleted) {
      onRetirementDeleted(retirement.id);
    } else {
      onBack();
    }
  };

  // Extract distinct category names across all daily records for filter dropdown
  const allCategoryNames = useMemo(() => {
    const names = new Set<string>();
    dailyRecords.forEach((r) => {
      r.categories.forEach((c) => names.add(c.name));
    });
    return Array.from(names);
  }, [dailyRecords]);

  // Filter daily records
  const filteredRecords = useMemo(() => {
    return dailyRecords.filter((record) => {
      // Date filters
      if (startDate && record.date < startDate) return false;
      if (endDate && record.date > endDate) return false;

      // Category filter
      if (filterCategory !== 'all') {
        const hasCategory = record.categories.some(
          (c) => c.name.toLowerCase() === filterCategory.toLowerCase()
        );
        if (!hasCategory) return false;
      }

      // Search query filter (matches description or category name)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCategory = record.categories.some((c) =>
          c.name.toLowerCase().includes(query)
        );
        const matchesItem = record.categories.some((c) =>
          c.items.some((i) => i.description.toLowerCase().includes(query))
        );
        if (!matchesCategory && !matchesItem) return false;
      }

      return true;
    });
  }, [dailyRecords, startDate, endDate, filterCategory, searchQuery]);

  // Record handlers
  const handleSaveDailyRecord = (record: DailyRecord) => {
    storage.saveDailyRecord(record);
    storage.logActivity(
      retirement.id,
      recordToEdit ? 'Daily Record Updated' : 'Daily Record Created',
      `Saved ${record.date} records (${formatNaira(record.dailyTotal)})`
    );
    setRecordToEdit(null);
    reloadData();
  };

  const handleDeleteDailyRecord = (recordId: string, dateStr: string) => {
    setRecordToDelete({ id: recordId, date: dateStr });
  };

  const handleConfirmDeleteDailyRecord = () => {
    if (!recordToDelete) return;
    storage.deleteDailyRecord(recordToDelete.id, retirement.id);
    storage.logActivity(
      retirement.id,
      'Daily Record Deleted',
      `Deleted records for ${recordToDelete.date}`
    );
    setRecordToDelete(null);
    reloadData();
  };

  const handleSaveSupplementary = (entry: SupplementaryEntry) => {
    storage.saveSupplementaryEntry(entry);
    storage.logActivity(
      retirement.id,
      'Supplementary Saved',
      `Saved supplementary entry "${entry.description}" (${formatNaira(entry.amount)})`
    );
    reloadData();
  };

  const handleDeleteSupplementary = (entryId: string) => {
    storage.deleteSupplementaryEntry(entryId, retirement.id);
    storage.logActivity(
      retirement.id,
      'Supplementary Deleted',
      `Deleted supplementary entry ID ${entryId}`
    );
    reloadData();
  };

  const handleRetirementUpdated = (updated: Retirement) => {
    setRetirement(updated);
    onRetirementUpdated(updated);
  };

  if (showSummaryView) {
    return (
      <SummaryView
        totals={totals}
        retirementTitle={retirement.title}
        retirementCode={retirement.code}
        onClose={() => setShowSummaryView(false)}
      />
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Top Breadcrumb & Action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/25">
                {retirement.code}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  role === 'OWNER'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                }`}
              >
                {role}
              </span>
              {retirement.isDemo && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60">
                  Demo
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {retirement.title}
              </h1>
              {canEdit && (
                <button
                  onClick={() => setShowEditRetirementModal(true)}
                  title="Edit Retirement Title / Location"
                  className="p-1 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <Building className="w-3.5 h-3.5 text-slate-500" />
              <span>{retirement.project}</span>
              <span>&bull;</span>
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span>{retirement.ownerName}</span>
            </p>
          </div>
        </div>

        {/* Quick Top Actions: Share, History, Export */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold transition"
            title="Share & Permissions"
          >
            <Share2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden xs:inline">Share</span>
          </button>

          <button
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold transition"
            title="Connected Retirements"
          >
            <Link2 className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden xs:inline">Connect</span>
          </button>

          <button
            onClick={() => setShowActivityModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold transition"
            title="Audit Log"
          >
            <History className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden xs:inline">Audit</span>
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/10 active:scale-95 transition"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Export PDF</span>
          </button>

          {canDelete ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-red-100 border border-red-800/40 text-xs font-semibold transition"
              title="Move entire retirement to Trash (48-hour recovery)"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden xs:inline">Delete Retirement</span>
            </button>
          ) : (
            <button
              onClick={() => setShowRemoveImportedConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-red-100 border border-red-800/40 text-xs font-semibold transition"
              title="Remove imported retirement from your workspace"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden xs:inline">Remove Imported Retirement</span>
            </button>
          )}
        </div>
      </div>

      {/* Financials Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
            Daily Retirement Total
          </span>
          <p className="text-xl font-extrabold text-white font-mono mt-1">
            {formatNaira(totals.dailyRetirementTotal)}
          </p>
          <span className="text-[11px] text-slate-500">
            {dailyRecords.length} recorded site day{dailyRecords.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Supplementary Total
            </span>
            <p className="text-xl font-extrabold text-white font-mono mt-1">
              {formatNaira(totals.supplementaryTotal)}
            </p>
            <span className="text-[11px] text-slate-500">
              {supplementary.length} non-dated item{supplementary.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={() => setShowSupplementaryModal(true)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-amber-400 font-semibold border border-slate-700 transition"
          >
            Manage
          </button>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 border border-amber-500/30 flex items-center justify-between shadow-lg shadow-amber-500/5">
          <div>
            <span className="text-[10px] uppercase font-black text-amber-400 tracking-wider block">
              General Total
            </span>
            <p className="text-2xl font-black text-amber-400 font-mono mt-0.5">
              {formatNaira(totals.generalTotal)}
            </p>
            <span className="text-[10px] text-amber-300/80">Daily + Supplementary</span>
          </div>
          <button
            onClick={() => setShowSummaryView(true)}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
          >
            Summary
          </button>
        </div>
      </div>

      {/* Main Actions Bar: Primary Add Daily Record */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => {
                setRecordToEdit(null);
                setShowDailyModal(true);
              }}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-amber-500/10 active:scale-95 transition"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Daily Record</span>
            </button>
          )}

          <button
            onClick={() => setShowSupplementaryModal(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Banknote className="w-4 h-4 text-amber-400" />
            <span>Supplementary</span>
          </button>

          <button
            onClick={() => setShowSummaryView(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Summary</span>
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search items or categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {allCategoryNames.length > 0 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500"
            >
              <option value="all">All Categories</option>
              {allCategoryNames.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Daily Records List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-500" />
            <span>Daily Site Records ({filteredRecords.length})</span>
          </h2>
          {(startDate || endDate || filterCategory !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setFilterCategory('all');
                setSearchQuery('');
              }}
              className="text-xs text-amber-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {filteredRecords.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white">No Daily Records Yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {dailyRecords.length === 0
                ? 'Start recording daily construction site labour and materials expenditure for this retirement.'
                : 'No records match your active search or date filters.'}
            </p>
            {canEdit && (
              <button
                onClick={() => {
                  setRecordToEdit(null);
                  setShowDailyModal(true);
                }}
                className="mt-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Your First Daily Record</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((record) => (
              <div
                key={record.id}
                className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4"
              >
                {/* Date Header & Record Total */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <h3 className="text-sm sm:text-base font-extrabold text-white">
                      {new Date(record.date).toLocaleDateString('en-GB', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400">({record.date})</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                        Day Subtotal
                      </span>
                      <span className="text-sm sm:text-base font-black text-amber-400 font-mono">
                        {formatNaira(record.dailyTotal)}
                      </span>
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                        <button
                          onClick={() => {
                            setRecordToEdit(record);
                            setShowDailyModal(true);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                          title="Edit daily record"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteDailyRecord(record.id, record.date)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                          title="Delete daily record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Categories & Items Breakdown */}
                <div className="space-y-3">
                  {record.categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="p-3 sm:p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2.5"
                    >
                      {/* Category Header */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Tag className="w-3 h-3 text-amber-500" />
                          <span>{cat.name}</span>
                        </span>
                        <span className="text-xs font-semibold text-slate-300">
                          Subtotal:{' '}
                          <strong className="text-white font-mono">{formatNaira(cat.subtotal)}</strong>
                        </span>
                      </div>

                      {/* Items Table */}
                      <div className="space-y-1.5">
                        {cat.items.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-12 gap-2 text-xs py-1 px-2 rounded-lg bg-slate-900/60 border border-slate-850"
                          >
                            <div className="col-span-6 sm:col-span-6 font-medium text-slate-200">
                              {item.description}
                            </div>
                            <div className="col-span-2 text-center text-slate-400 font-mono">
                              {item.quantity}
                            </div>
                            <div className="col-span-2 text-right text-slate-400 font-mono">
                              {formatNaira(item.rate)}
                            </div>
                            <div className="col-span-2 text-right font-mono font-bold text-slate-100">
                              {formatNaira(item.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Button for Mobile Outdoors usage */}
      {canEdit && (
        <button
          onClick={() => {
            setRecordToEdit(null);
            setShowDailyModal(true);
          }}
          className="sm:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 shadow-2xl flex items-center justify-center font-bold"
          title="Add Daily Record"
        >
          <Plus className="w-7 h-7 stroke-[2.5]" />
        </button>
      )}

      {/* Modals */}
      {showDailyModal && (
        <DailyRecordModal
          key={recordToEdit ? `edit-${recordToEdit.id}` : 'new-record'}
          isOpen={showDailyModal}
          onClose={() => {
            setShowDailyModal(false);
            setRecordToEdit(null);
          }}
          recordToEdit={recordToEdit}
          retirementId={retirement.id}
          onSave={handleSaveDailyRecord}
        />
      )}

      {/* Delete Whole Retirement Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete Entire Retirement</h3>
                <p className="text-xs text-slate-400">Move to Trash with 48-Hour Recovery</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to move <strong className="text-white">{retirement.title}</strong> ({retirement.code}) to the Trash Bin?
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p>• The entire retirement and all associated daily &amp; supplementary records will be moved to Trash.</p>
              <p>• It will disappear from active retirements immediately.</p>
              <p>• You can restore it intact at any time within 48 hours from the Trash Bin.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteWholeRetirement}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/20 transition"
              >
                Yes, Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Imported Retirement Confirmation Modal */}
      {showRemoveImportedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remove Imported Retirement</h3>
                <p className="text-xs text-slate-400">Remove from Your Workspace Only</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Remove <strong className="text-white">{retirement.title}</strong> ({retirement.code}) from your workspace?
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p>• This only removes the retirement from your workspace.</p>
              <p>• The original owner&apos;s retirement, daily records, and supplementary entries remain completely untouched.</p>
              <p>• You can re-import it later using its code ({retirement.code}) if you still have access.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowRemoveImportedConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveImportedRetirement}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/20 transition"
              >
                Remove from Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Daily Record Confirmation Modal */}
      {recordToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-9 h-9 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Daily Record</h3>
                <p className="text-[11px] text-slate-400">Date: {recordToDelete.date}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300">
              Are you sure you want to delete all entries recorded for{' '}
              <strong className="text-white">{recordToDelete.date}</strong>?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                className="px-3.5 py-1.5 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDailyRecord}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-600/20 transition"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      <SupplementaryModal
        isOpen={showSupplementaryModal}
        onClose={() => setShowSupplementaryModal(false)}
        retirementId={retirement.id}
        entries={supplementary}
        onSaveEntry={handleSaveSupplementary}
        onDeleteEntry={handleDeleteSupplementary}
      />

      <ExportPdfModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        retirement={retirement}
        dailyRecords={dailyRecords}
        supplementary={supplementary}
      />

      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        retirement={retirement}
        currentUser={currentUser}
        onUpdateRetirement={handleRetirementUpdated}
      />

      <ConnectRetirementModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        retirement={retirement}
        onUpdateRetirement={handleRetirementUpdated}
      />

      <ActivityHistoryModal
        isOpen={showActivityModal}
        onClose={() => setShowActivityModal(false)}
        logs={storage.getActivityLogs(retirement.id)}
        retirementCode={retirement.code}
      />

      <CreateRetirementModal
        isOpen={showEditRetirementModal}
        onClose={() => setShowEditRetirementModal(false)}
        currentUser={currentUser}
        retirementToEdit={retirement}
        onUpdated={(updated) => {
          handleRetirementUpdated(updated);
          reloadData();
        }}
      />
    </div>
  );
};
