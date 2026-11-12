import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sliders,
  Building2,
  ListChecks,
  Upload,
  Trash2,
  RotateCcw,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import {
  UserProfile,
  CompanyHeaderConfig,
  ReportMetadataConfig,
  ReportMetadataFieldId,
} from '../../types';
import {
  storage,
  DEFAULT_COMPANY_HEADER_CONFIG,
  DEFAULT_REPORT_METADATA_FIELDS,
} from '../../utils/storage';
import { isUserAdmin } from '../../utils/supabaseClient';
import {
  compressCompanyLogo,
  MAX_LOGO_WIDTH_PX,
  MAX_LOGO_HEIGHT_PX,
} from '../../utils/pdfGenerator';

interface CustomisationModalProps {
  isOpen: boolean;
  currentUser: UserProfile | null;
  onClose: () => void;
  onSaved?: () => void;
}

type CustomisationTab = 'company_header' | 'report_metadata';

const SAMPLE_METADATA_VALUES: Record<ReportMetadataFieldId, string> = {
  retirement: 'Phase 2 Structural Concrete Works',
  project_site: 'Lekki Commercial Tower — Block B',
  period: '01/11/2026 to 12/11/2026',
  site_engineer_owner: 'Engr. Musa Ibrahim',
  designation: 'Senior Site Engineer',
  date_generated: new Date().toLocaleDateString('en-GB'),
};

const FIELD_DESCRIPTIONS: Record<ReportMetadataFieldId, string> = {
  retirement: 'Displays the title of the exported retirement record.',
  project_site: 'Displays the construction project or site location.',
  period: 'Displays the date span covered by the retirement report.',
  site_engineer_owner: 'Displays the full name of the retirement owner / site engineer.',
  designation: 'Displays the official role or job title of the owner.',
  date_generated: 'Displays the date on which the PDF report was generated.',
};

export const CustomisationModal: React.FC<CustomisationModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onSaved,
}) => {
  const isAdmin = isUserAdmin(currentUser);
  const [activeTab, setActiveTab] = useState<CustomisationTab>('company_header');

  const [headerConfig, setHeaderConfig] = useState<CompanyHeaderConfig>(() =>
    storage.getCompanyHeaderConfig()
  );
  const [metadataConfig, setMetadataConfig] = useState<ReportMetadataConfig>(() =>
    storage.getReportMetadataConfig()
  );

  const [isCompressingLogo, setIsCompressingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate latest stored configurations whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setHeaderConfig(storage.getCompanyHeaderConfig());
    setMetadataConfig(storage.getReportMetadataConfig());
    setLogoError(null);
    setSaveMessage(null);
  }, [isOpen]);

  // Enforce Admin-only access
  if (!isOpen || !isAdmin) return null;

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (!file) return;

    setLogoError(null);
    setSaveMessage(null);
    setIsCompressingLogo(true);

    try {
      const compressed = await compressCompanyLogo(file);
      setHeaderConfig((prev) => ({
        ...prev,
        logoDataUrl: compressed.dataUrl,
        logoMimeType: compressed.mimeType,
        logoWidth: compressed.width,
        logoHeight: compressed.height,
      }));
    } catch (err: any) {
      setLogoError(err?.message || 'Could not process logo image.');
    } finally {
      setIsCompressingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoError(null);
    setSaveMessage(null);
    setHeaderConfig((prev) => ({
      ...prev,
      logoDataUrl: '',
      logoMimeType: undefined,
      logoWidth: undefined,
      logoHeight: undefined,
    }));
  };

  const handleMetadataLabelChange = (id: ReportMetadataFieldId, newLabel: string) => {
    setSaveMessage(null);
    setMetadataConfig((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, label: newLabel } : f)),
    }));
  };

  const handleMetadataToggle = (id: ReportMetadataFieldId) => {
    setSaveMessage(null);
    setMetadataConfig((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)),
    }));
  };

  const handleResetCurrentTab = () => {
    setLogoError(null);
    setSaveMessage(null);
    if (activeTab === 'company_header') {
      setHeaderConfig({
        ...DEFAULT_COMPANY_HEADER_CONFIG,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.id,
      });
    } else {
      setMetadataConfig({
        fields: DEFAULT_REPORT_METADATA_FIELDS.map((f) => ({ ...f })),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.id,
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setLogoError(null);

    const { companyHeader: savedHeader, reportMetadata: savedMetadata } =
      storage.saveGlobalCustomisation(headerConfig, metadataConfig, false);

    setHeaderConfig(savedHeader);
    setMetadataConfig(savedMetadata);
    setSaveMessage('Global PDF customisation saved locally and queued for cloud sync.');
    if (onSaved) {
      onSaved();
    }
  };

  // Live preview computed values for Company Header
  const previewCompanyName =
    (headerConfig.companyName || '').trim() || DEFAULT_COMPANY_HEADER_CONFIG.companyName;
  const previewAddress = (headerConfig.address || '').trim();
  const previewContactParts: string[] = [];
  if (headerConfig.phone?.trim()) previewContactParts.push(`Tel: ${headerConfig.phone.trim()}`);
  if (headerConfig.email?.trim()) previewContactParts.push(`Email: ${headerConfig.email.trim()}`);
  if (headerConfig.website?.trim()) previewContactParts.push(`Web: ${headerConfig.website.trim()}`);
  const previewContactLine = previewContactParts.join('  |  ');
  const previewSubtitle =
    (headerConfig.subtitle || '').trim() ||
    DEFAULT_COMPANY_HEADER_CONFIG.subtitle ||
    'Your Site Expenditure, Digitized. | Official Audit Record';

  const enabledMetadataFields = metadataConfig.fields.filter((f) => f.enabled);
  const leftPreviewCount = Math.ceil(enabledMetadataFields.length / 2);
  const leftPreviewFields = enabledMetadataFields.slice(0, leftPreviewCount);
  const rightPreviewFields = enabledMetadataFields.slice(leftPreviewCount);

  const logoSizeKb = headerConfig.logoDataUrl
    ? Math.round((headerConfig.logoDataUrl.length / 1024) * 10) / 10
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customisation-modal-title"
        className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden text-slate-100 my-auto max-h-[92vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 flex-shrink-0">
              <Sliders className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="customisation-modal-title"
                  className="text-base sm:text-lg font-black text-white tracking-tight"
                >
                  PDF Report Customisation
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                  Global Admin Settings
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Configure company header and metadata fields for all single and combined PDF reports
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customisation modal"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-3 bg-slate-950/40 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('company_header');
              setSaveMessage(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold border-b-2 transition ${
              activeTab === 'company_header'
                ? 'border-amber-500 text-amber-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Company Header</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('report_metadata');
              setSaveMessage(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold border-b-2 transition ${
              activeTab === 'report_metadata'
                ? 'border-amber-500 text-amber-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <ListChecks className="w-4 h-4" />
            <span>Report Metadata</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px]">
              {enabledMetadataFields.length}/6
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status / Error Alerts */}
          {logoError && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/70 text-red-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{logoError}</span>
            </div>
          )}

          {saveMessage && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/70 text-emerald-300 text-xs flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{saveMessage}</span>
            </div>
          )}

          {/* TAB A: COMPANY HEADER */}
          {activeTab === 'company_header' && (
            <div className="space-y-5">
              {/* Live PDF Header Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    Live PDF Header Preview
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Applies to Single &amp; Combined Reports
                  </span>
                </div>

                {/* Simulated PDF Dark Slate Banner */}
                <div
                  style={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                  className="rounded-xl p-4 border shadow-inner flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {headerConfig.logoDataUrl && (
                      <div className="flex-shrink-0 rounded-lg overflow-hidden bg-slate-900/50 p-1 border border-slate-700/60">
                        <img
                          src={headerConfig.logoDataUrl}
                          alt="Company Logo Preview"
                          className="max-h-12 max-w-[110px] w-auto h-auto object-contain"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span
                          style={{ color: '#f59e0b' }}
                          className="text-base sm:text-lg font-black tracking-tight break-words"
                        >
                          {previewCompanyName}
                        </span>
                        {!headerConfig.logoDataUrl &&
                          previewCompanyName === 'myRet' &&
                          !previewAddress &&
                          !previewContactLine && (
                            <span
                              style={{ color: '#ffffff' }}
                              className="text-[11px] font-semibold tracking-wide"
                            >
                              CONSTRUCTION SITE EXPENDITURE &amp; RETIREMENT REPORT
                            </span>
                          )}
                      </div>

                      {(headerConfig.logoDataUrl ||
                        previewCompanyName !== 'myRet' ||
                        previewAddress ||
                        previewContactLine) && (
                        <p
                          style={{ color: '#ffffff' }}
                          className="text-[11px] font-bold tracking-wide"
                        >
                          CONSTRUCTION SITE EXPENDITURE &amp; RETIREMENT REPORT
                        </p>
                      )}

                      {previewAddress && (
                        <p
                          style={{ color: '#cbd5e1' }}
                          className="text-[11px] leading-snug break-words"
                        >
                          {previewAddress}
                        </p>
                      )}

                      {previewContactLine && (
                        <p
                          style={{ color: '#cbd5e1' }}
                          className="text-[11px] leading-snug break-words"
                        >
                          {previewContactLine}
                        </p>
                      )}

                      <p
                        style={{ color: '#94a3b8' }}
                        className="text-[11px] leading-snug break-words pt-0.5"
                      >
                        {previewSubtitle}
                      </p>
                    </div>
                  </div>

                  {/* Simulated Right Retirement Code Badge */}
                  <div className="flex-shrink-0 self-start sm:self-center">
                    <div
                      style={{ backgroundColor: '#f59e0b', color: '#0f172a' }}
                      className="px-3.5 py-1.5 rounded-md font-black text-xs tracking-wider text-center shadow"
                    >
                      RET-7K4M2P
                    </div>
                  </div>
                </div>
              </div>

              {/* Company Logo Upload Section */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-amber-400" />
                      <span>Company Logo</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      PNG, JPEG, or WebP. Automatically optimised (max {MAX_LOGO_WIDTH_PX}×
                      {MAX_LOGO_HEIGHT_PX}px, ≤ 40 KB) for offline PDF generation.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isCompressingLogo}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {isCompressingLogo
                          ? 'Optimising...'
                          : headerConfig.logoDataUrl
                            ? 'Change Logo'
                            : 'Upload Logo'}
                      </span>
                    </button>

                    {headerConfig.logoDataUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="px-3 py-2 rounded-xl bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-800/60 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                {headerConfig.logoDataUrl && (
                  <div className="flex items-center gap-3 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-semibold">
                      Optimised for Offline Export
                    </span>
                    {headerConfig.logoWidth && headerConfig.logoHeight && (
                      <span>
                        • Dimensions: {headerConfig.logoWidth}×{headerConfig.logoHeight}px
                      </span>
                    )}
                    <span>• Cached Size: {logoSizeKb} KB</span>
                  </div>
                )}
              </div>

              {/* Company Details Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Company / Organisation Name <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={headerConfig.companyName}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, companyName: e.target.value }));
                    }}
                    placeholder="e.g. MGK Global Services Ltd"
                    maxLength={120}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Company Address
                  </label>
                  <input
                    type="text"
                    value={headerConfig.address}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, address: e.target.value }));
                    }}
                    placeholder="e.g. Plot 14 Engineering Close, Victoria Island, Lagos"
                    maxLength={200}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={headerConfig.phone}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, phone: e.target.value }));
                    }}
                    placeholder="e.g. +234 800 000 0000"
                    maxLength={60}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={headerConfig.email}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, email: e.target.value }));
                    }}
                    placeholder="e.g. info@company.com"
                    maxLength={100}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Website
                  </label>
                  <input
                    type="text"
                    value={headerConfig.website}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, website: e.target.value }));
                    }}
                    placeholder="e.g. www.company.com"
                    maxLength={100}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Report Subtitle / Tagline
                  </label>
                  <input
                    type="text"
                    value={headerConfig.subtitle || ''}
                    onChange={(e) => {
                      setSaveMessage(null);
                      setHeaderConfig((prev) => ({ ...prev, subtitle: e.target.value }));
                    }}
                    placeholder="Your Site Expenditure, Digitized. | Official Audit Record"
                    maxLength={140}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB B: REPORT METADATA */}
          {activeTab === 'report_metadata' && (
            <div className="space-y-5">
              {/* Live PDF Metadata Box Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    Live PDF Metadata Box Preview
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {enabledMetadataFields.length} of 6 fields visible
                  </span>
                </div>

                {enabledMetadataFields.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-dashed border-slate-700 text-center text-xs text-slate-400">
                    All metadata fields are currently disabled. The metadata box will be cleanly omitted from exported PDFs.
                  </div>
                ) : (
                  <div
                    style={{ backgroundColor: '#f8fafc', borderColor: '#cbd5e1' }}
                    className="rounded-xl p-4 border shadow-inner grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2"
                  >
                    <div className="space-y-2">
                      {leftPreviewFields.map((field) => {
                        const cleanLabel =
                          (field.label || '').trim() || field.id.toUpperCase();
                        const displayLabel = cleanLabel.endsWith(':')
                          ? cleanLabel
                          : `${cleanLabel}:`;
                        return (
                          <div
                            key={field.id}
                            className="grid grid-cols-12 gap-2 items-baseline text-xs"
                          >
                            <span
                              style={{ color: '#64748b' }}
                              className="col-span-5 font-bold uppercase text-[11px] break-words"
                            >
                              {displayLabel}
                            </span>
                            <span
                              style={{ color: '#0f172a' }}
                              className="col-span-7 font-medium text-[11px] break-words"
                            >
                              {SAMPLE_METADATA_VALUES[field.id]}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      {rightPreviewFields.map((field) => {
                        const cleanLabel =
                          (field.label || '').trim() || field.id.toUpperCase();
                        const displayLabel = cleanLabel.endsWith(':')
                          ? cleanLabel
                          : `${cleanLabel}:`;
                        return (
                          <div
                            key={field.id}
                            className="grid grid-cols-12 gap-2 items-baseline text-xs"
                          >
                            <span
                              style={{ color: '#64748b' }}
                              className="col-span-5 font-bold uppercase text-[11px] break-words"
                            >
                              {displayLabel}
                            </span>
                            <span
                              style={{ color: '#0f172a' }}
                              className="col-span-7 font-medium text-[11px] break-words"
                            >
                              {SAMPLE_METADATA_VALUES[field.id]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Metadata Fields Editor */}
              <div className="space-y-2.5">
                {metadataConfig.fields.map((field) => {
                  const defaultField = DEFAULT_REPORT_METADATA_FIELDS.find(
                    (d) => d.id === field.id
                  );
                  return (
                    <div
                      key={field.id}
                      className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        field.enabled
                          ? 'bg-slate-950/60 border-slate-800'
                          : 'bg-slate-950/30 border-slate-800/50 opacity-75'
                      }`}
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {field.id}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Default: <strong className="text-slate-300">{defaultField?.label}</strong>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {FIELD_DESCRIPTIONS[field.id]}
                        </p>
                        <div>
                          <label className="sr-only">
                            Display label for {field.id}
                          </label>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) =>
                              handleMetadataLabelChange(field.id, e.target.value)
                            }
                            placeholder={defaultField?.label || field.id.toUpperCase()}
                            maxLength={45}
                            className="w-full sm:max-w-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/60">
                        <span
                          className={`text-xs font-semibold flex items-center gap-1.5 ${
                            field.enabled ? 'text-emerald-400' : 'text-slate-400'
                          }`}
                        >
                          {field.enabled ? (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Visible in PDF</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Hidden in PDF</span>
                            </>
                          )}
                        </span>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={field.enabled}
                          aria-label={`Toggle visibility for ${field.label || field.id}`}
                          onClick={() => handleMetadataToggle(field.id)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            field.enabled ? 'bg-amber-500' : 'bg-slate-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                              field.enabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleResetCurrentTab}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {activeTab === 'company_header'
                  ? 'Reset Header to Default'
                  : 'Reset Metadata to Default'}
              </span>
            </button>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isCompressingLogo}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Save Customisation</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
