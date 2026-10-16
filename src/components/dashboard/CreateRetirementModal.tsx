import React, { useState, useEffect } from 'react';
import { X, Plus, HardHat, Building, Sparkles, Edit3, Save } from 'lucide-react';
import { Retirement, UserProfile } from '../../types';
import { generateRetirementCode, generateUUID } from '../../utils/codeGenerator';
import { storage } from '../../utils/storage';

interface CreateRetirementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  retirementToEdit?: Retirement | null;
  onCreated?: (retirement: Retirement) => void;
  onUpdated?: (retirement: Retirement) => void;
}

export const CreateRetirementModal: React.FC<CreateRetirementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  retirementToEdit,
  onCreated,
  onUpdated,
}) => {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (retirementToEdit) {
        setTitle(retirementToEdit.title || '');
        setProject(retirementToEdit.project || '');
      } else {
        setTitle('');
        setProject(currentUser.placement || '');
      }
    }
  }, [isOpen, retirementToEdit, currentUser]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project.trim()) return;

    setIsSubmitting(true);
    const now = new Date().toISOString();

    if (retirementToEdit) {
      // Edit existing retirement - preserve all existing IDs, access, records, and metadata
      const updatedRetirement: Retirement = {
        ...retirementToEdit,
        title: title.trim(),
        project: project.trim(),
        updatedAt: now,
      };

      storage.saveRetirement(updatedRetirement);
      storage.logActivity(
        updatedRetirement.id,
        'Retirement Details Updated',
        `Updated details for ${updatedRetirement.code} ("${updatedRetirement.title}")`
      );

      setIsSubmitting(false);
      if (onUpdated) onUpdated(updatedRetirement);
      onClose();
      return;
    }

    const id = generateUUID();
    const code = generateRetirementCode();

    const newRetirement: Retirement = {
      id,
      code,
      title: title.trim(),
      project: project.trim(),
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerDesignation: currentUser.designation,
      ownerPhone: currentUser.phone,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      access: [
        {
          userId: currentUser.id,
          userEmail: currentUser.email,
          userName: currentUser.name,
          role: 'OWNER',
          grantedAt: now,
        },
      ],
      connectedRetirementIds: [],
      syncStatus: 'pending',
    };

    storage.saveRetirement(newRetirement);
    storage.logActivity(
      newRetirement.id,
      'Retirement Created',
      `Created retirement ${newRetirement.code} ("${newRetirement.title}")`
    );

    setIsSubmitting(false);
    if (onCreated) onCreated(newRetirement);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {retirementToEdit ? 'Edit Retirement' : 'Create New Retirement'}
              </h2>
              <p className="text-xs text-slate-400">
                {retirementToEdit
                  ? `Modify details for ${retirementToEdit.code}`
                  : 'Initialize a new construction-site expenditure ledger'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Retirement Title / Milestone Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Block B Substructure & Ground Floor Casting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 placeholder:text-slate-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Descriptive activity name or construction trade milestone
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Project / Site Location *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Borno State Specialist Hospital Renovation - Phase II"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 placeholder:text-slate-500"
            />
          </div>

          <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span>Owner &amp; Site Engineer:</span>
              <span className="font-semibold text-white">
                {retirementToEdit ? retirementToEdit.ownerName : currentUser.name}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Designation:</span>
              <span className="text-amber-400">
                {retirementToEdit ? retirementToEdit.ownerDesignation : currentUser.designation}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>System Identifier:</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {retirementToEdit ? retirementToEdit.code : 'Auto-Generated (e.g. RET-XXXXXX)'}
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-95 transition disabled:opacity-50"
            >
              {retirementToEdit ? (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Changes</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Create Retirement</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
