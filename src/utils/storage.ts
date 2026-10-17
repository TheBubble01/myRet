import {
  Retirement,
  DailyRecord,
  SupplementaryEntry,
  ActivityLog,
  UserProfile,
  RetirementTotals,
  SyncOperationType,
} from '../types';
import { DEMO_USER, createDemoRetirement, createConnectedDemoRetirement } from './demoData';
import { generateUUID } from './codeGenerator';
import { calculateAmount } from './currency';

type SyncTrigger = (type: SyncOperationType, entityId: string, payload: any, retirementId?: string) => void;
let globalSyncTrigger: SyncTrigger | null = null;
export function setSyncTrigger(fn: SyncTrigger) {
  globalSyncTrigger = fn;
  storage.runExpiredTrashCleanup();
}

/**
 * Normalizes any date string or Date representation to canonical YYYY-MM-DD.
 * Ensures consistent day-level comparison regardless of time formatting or timestamps.
 */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();

  // Match YYYY-MM-DD format (including if followed by T or whitespace)
  const ymdMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Parse via standard Date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fallback
  }

  return trimmed;
}

/**
 * Compares two ISO timestamp strings for logical instant equality,
 * handling differences in timezone representation (e.g. +00:00 vs Z).
 */
function areTimestampsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  return !Number.isNaN(parsedA) && !Number.isNaN(parsedB) && parsedA === parsedB;
}

const STORAGE_KEYS = {
  CURRENT_USER: 'myret_current_user',
  ALL_USERS: 'myret_users_list',
  RETIREMENTS: 'myret_retirements',
  DAILY_RECORDS: 'myret_daily_records',
  SUPPLEMENTARY: 'myret_supplementary',
  ACTIVITY_LOGS: 'myret_activity_logs',
  SUPABASE_CONFIG: 'myret_supabase_config',
  SYNC_QUEUE: 'myret_sync_queue',
};

// 48 hours in milliseconds
export const TRASH_RETENTION_MS = 48 * 60 * 60 * 1000;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  connected: boolean;
}

class StorageService {
  constructor() {
    this.initDefaults();
  }

  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      if (!data) return defaultValue;
      return JSON.parse(data) as T;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }
  }

  private initDefaults() {
    // No automatic mock user assignment
  }

  // --- Auth / User Management ---
  getCurrentUser(): UserProfile | null {
    return this.getItem<UserProfile | null>(STORAGE_KEYS.CURRENT_USER, null);
  }

  setCurrentUser(user: UserProfile | null): void {
    if (!user) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      return;
    }
    this.setItem(STORAGE_KEYS.CURRENT_USER, user);
    const users = this.getAllUsers();
    const existingIndex = users.findIndex((u) => u.id === user.id);
    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }
    this.setItem(STORAGE_KEYS.ALL_USERS, users);
  }

  clearCurrentUser(): void {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }

  getAllUsers(): UserProfile[] {
    return this.getItem<UserProfile[]>(STORAGE_KEYS.ALL_USERS, []);
  }

  updateProfile(profile: Partial<UserProfile>): UserProfile | null {
    const current = this.getCurrentUser();
    if (!current) return null;
    const updated: UserProfile = { ...current, ...profile };
    this.setCurrentUser(updated);

    // Also update ownerName on active retirements owned by this user
    const retirements = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    let modified = false;
    const updatedRetirements = retirements.map((r) => {
      if (r.ownerId === updated.id) {
        modified = true;
        return {
          ...r,
          ownerName: updated.name,
          ownerDesignation: updated.designation,
          ownerPhone: updated.phone,
        };
      }
      return r;
    });
    if (modified) {
      this.setItem(STORAGE_KEYS.RETIREMENTS, updatedRetirements);
    }

    return updated;
  }

  // --- Supabase Config ---
  getSupabaseConfig(): SupabaseConfig {
    return this.getItem<SupabaseConfig>(STORAGE_KEYS.SUPABASE_CONFIG, {
      url: (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL || '',
      anonKey: (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY || '',
      connected: false,
    });
  }

  setSupabaseConfig(config: SupabaseConfig): void {
    this.setItem(STORAGE_KEYS.SUPABASE_CONFIG, config);
  }

  // --- Retirements ---
  getRetirements(includeTrash: boolean = false): Retirement[] {
    this.cleanupExpiredTrash();
    const currentUser = this.getCurrentUser();
    if (!currentUser) return [];

    // Safely reconcile any legacy owned retirements for currentUser before filtering
    this.reconcileLegacyOwnedRetirements(currentUser);

    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const normEmail = (currentUser.email || '').trim().toLowerCase();

    // Check permissions: Owner OR Access list contains user ID or email
    const accessible = all.filter((r) => {
      if (r.ownerId === currentUser.id) return true;
      return (r.access || []).some(
        (a) =>
          a.userId === currentUser.id ||
          (normEmail !== '' && (a.userEmail || '').trim().toLowerCase() === normEmail)
      );
    });

    if (includeTrash) {
      return accessible;
    }
    return accessible.filter((r) => r.status === 'active');
  }

  /**
   * Inspects raw local retirements and recovers legacy records only when ownership
   * by the authenticated user can be positively established from existing local account data.
   * Unverified records or records belonging to other accounts are preserved locally untouched.
   */
  reconcileLegacyOwnedRetirements(user: { id: string; email?: string }): Retirement[] {
    this.cleanupExpiredTrash();
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const knownUsers = this.getAllUsers();
    const normUserEmail = (user.email || '').trim().toLowerCase();
    let modified = false;
    const ownedByUser: Retirement[] = [];

    for (const r of all) {
      if (r.isDemo) continue;

      if (r.ownerId === user.id) {
        ownedByUser.push(r);
        continue;
      }

      const accessList = Array.isArray(r.access) ? r.access : [];

      // If the user is explicitly listed ONLY as a REVIEWER, never claim ownership
      const isReviewerOnly =
        accessList.some(
          (a) =>
            a.role === 'REVIEWER' &&
            (a.userId === user.id ||
              (normUserEmail !== '' && (a.userEmail || '').trim().toLowerCase() === normUserEmail))
        ) &&
        !accessList.some(
          (a) =>
            a.role === 'OWNER' &&
            (a.userId === user.id ||
              (normUserEmail !== '' && (a.userEmail || '').trim().toLowerCase() === normUserEmail))
        );

      if (isReviewerOnly) {
        continue;
      }

      // Check if an OWNER access entry exists
      const ownerAccess = accessList.find((a) => a.role === 'OWNER');
      const ownerAccessEmail = (ownerAccess?.userEmail || '').trim().toLowerCase();

      // If OWNER access explicitly specifies a different user's email, exclude it
      if (ownerAccessEmail !== '' && normUserEmail !== '' && ownerAccessEmail !== normUserEmail) {
        continue;
      }

      // Check positive ownership criteria:
      // 1. OWNER access entry matches user.id or user.email
      const matchedViaOwnerAccess =
        Boolean(ownerAccess) &&
        (ownerAccess!.userId === user.id ||
          (normUserEmail !== '' && ownerAccessEmail === normUserEmail));

      // 2. Legacy r.ownerId maps to a local UserProfile in myret_users_list with the exact same email
      const legacyOwnerProfile = r.ownerId ? knownUsers.find((u) => u.id === r.ownerId) : undefined;
      const legacyOwnerEmail = (legacyOwnerProfile?.email || '').trim().toLowerCase();
      const matchedViaLegacyProfile =
        Boolean(legacyOwnerProfile) &&
        normUserEmail !== '' &&
        legacyOwnerEmail !== '' &&
        legacyOwnerEmail === normUserEmail;

      // If legacyOwnerProfile exists with a different email, it belongs to another account
      if (legacyOwnerProfile && legacyOwnerEmail !== '' && legacyOwnerEmail !== normUserEmail) {
        continue;
      }

      // 3. Pre-auth legacy retirement with no ownerId on a single-user device (and no conflicting owner access)
      const hasOtherLocalUsers = knownUsers.some((u) => {
        const uEmail = (u.email || '').trim().toLowerCase();
        if (u.id === user.id) return false;
        if (normUserEmail !== '' && uEmail !== '' && uEmail === normUserEmail) return false;
        return true;
      });
      const hasConflictingOwnerAccess =
        Boolean(ownerAccess) &&
        ((ownerAccess!.userId && ownerAccess!.userId !== user.id && ownerAccessEmail !== normUserEmail) ||
          (ownerAccessEmail !== '' && ownerAccessEmail !== normUserEmail));
      const matchedSingleUserUnownedLegacy =
        (!r.ownerId || r.ownerId.trim() === '') &&
        !hasOtherLocalUsers &&
        !hasConflictingOwnerAccess;

      if (matchedViaOwnerAccess || matchedViaLegacyProfile || matchedSingleUserUnownedLegacy) {
        r.ownerId = user.id;
        r.syncStatus = 'pending';
        if (r.hasSyncedToCloud === undefined) {
          r.hasSyncedToCloud = false;
        }
        if (ownerAccess) {
          ownerAccess.userId = user.id;
          if (user.email && !ownerAccess.userEmail) {
            ownerAccess.userEmail = user.email;
          }
        } else {
          r.access = [
            {
              userId: user.id,
              userEmail: user.email || '',
              userName: r.ownerName || 'Site Engineer',
              role: 'OWNER',
              grantedAt: r.createdAt || new Date().toISOString(),
            },
            ...accessList,
          ];
        }
        modified = true;
        ownedByUser.push(r);
      }
    }

    if (modified) {
      this.setItem(STORAGE_KEYS.RETIREMENTS, all);
    }

    return ownedByUser;
  }

  getTrashRetirements(): Retirement[] {
    this.cleanupExpiredTrash();
    const currentUser = this.getCurrentUser();
    if (!currentUser) return [];
    this.reconcileLegacyOwnedRetirements(currentUser);
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const isAdmin =
      currentUser.role === 'admin' ||
      currentUser.role === 'tech-admin' ||
      currentUser.email?.toLowerCase() === 'elmubaraq69@gmail.com';
    return all.filter((r) => r.status === 'in_trash' && (r.ownerId === currentUser.id || isAdmin));
  }

  getRetirementById(id: string): Retirement | undefined {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    return all.find((r) => r.id === id);
  }

  getRetirementByCode(code: string): Retirement | undefined {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const cleanCode = code.trim().toUpperCase();
    return all.find((r) => r.code.toUpperCase() === cleanCode);
  }

  saveRetirement(retirement: Retirement, skipSync: boolean = false): void {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === retirement.id);

    let hasSynced = Boolean(retirement.hasSyncedToCloud);
    if (index >= 0) {
      hasSynced = this.hasRetirementEverSynced(all[index]) || hasSynced;
    } else if (!retirement.isDemo) {
      hasSynced = skipSync && retirement.syncStatus === 'synced' ? true : Boolean(retirement.hasSyncedToCloud);
    }

    if (!retirement.isDemo && !skipSync) {
      retirement.syncStatus = 'pending';
    }
    if (!retirement.isDemo) {
      retirement.hasSyncedToCloud = hasSynced;
    }

    let savedRetirement = retirement;
    if (index >= 0) {
      savedRetirement = {
        ...retirement,
        hasSyncedToCloud: retirement.isDemo ? undefined : hasSynced,
        updatedAt: new Date().toISOString(),
      };
      all[index] = savedRetirement;
    } else {
      all.unshift(savedRetirement);
    }
    this.setItem(STORAGE_KEYS.RETIREMENTS, all);

    if (!skipSync && !savedRetirement.isDemo && globalSyncTrigger) {
      globalSyncTrigger('UPSERT_RETIREMENT', savedRetirement.id, savedRetirement);
    }
  }

  moveToTrash(id: string, skipSync: boolean = false): boolean {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      const hasSynced = this.hasRetirementEverSynced(all[index]);
      all[index].status = 'in_trash';
      all[index].deletedAt = new Date().toISOString();
      if (!all[index].isDemo) {
        all[index].hasSyncedToCloud = hasSynced;
        if (!skipSync) {
          all[index].syncStatus = 'pending';
        }
      }
      this.setItem(STORAGE_KEYS.RETIREMENTS, all);
      this.logActivity(id, 'Moved to Trash', 'Retirement moved to trash (48-hour recovery window)');

      if (!skipSync && !all[index].isDemo && globalSyncTrigger) {
        globalSyncTrigger('UPSERT_RETIREMENT', id, all[index]);
      }
      return true;
    }
    return false;
  }

  restoreFromTrash(id: string, skipSync: boolean = false): boolean {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      const hasSynced = this.hasRetirementEverSynced(all[index]);
      all[index].status = 'active';
      delete all[index].deletedAt;
      if (!all[index].isDemo) {
        all[index].hasSyncedToCloud = hasSynced;
        if (!skipSync) {
          all[index].syncStatus = 'pending';
        }
      }
      this.setItem(STORAGE_KEYS.RETIREMENTS, all);
      this.logActivity(id, 'Restored from Trash', 'Retirement restored back to active state');

      if (!skipSync && !all[index].isDemo && globalSyncTrigger) {
        globalSyncTrigger('UPSERT_RETIREMENT', id, all[index]);
      }
      return true;
    }
    return false;
  }

  permanentlyDelete(id: string, skipSync: boolean = false): boolean {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const target = all.find((r) => r.id === id);

    // Record cloud deletion operation first before removing local data
    if (!skipSync && target && !target.isDemo) {
      if (!globalSyncTrigger) {
        return false;
      }
      globalSyncTrigger(
        'DELETE_RETIREMENT',
        id,
        { id, code: target.code, ownerId: target.ownerId },
        id
      );
    }

    const filtered = all
      .filter((r) => r.id !== id)
      .map((r) =>
        Array.isArray(r.connectedRetirementIds) && r.connectedRetirementIds.includes(id)
          ? {
              ...r,
              connectedRetirementIds: r.connectedRetirementIds.filter((cid) => cid !== id),
            }
          : r
      );
    this.setItem(STORAGE_KEYS.RETIREMENTS, filtered);

    // Also delete associated daily records and supplementary
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    this.setItem(
      STORAGE_KEYS.DAILY_RECORDS,
      records.filter((r) => r.retirementId !== id)
    );

    const supplementary = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    this.setItem(
      STORAGE_KEYS.SUPPLEMENTARY,
      supplementary.filter((s) => s.retirementId !== id)
    );

    const logs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
    this.setItem(
      STORAGE_KEYS.ACTIVITY_LOGS,
      logs.filter((l) => l.retirementId !== id)
    );

    return true;
  }

  runExpiredTrashCleanup(): void {
    this.cleanupExpiredTrash();
  }

  private cleanupExpiredTrash(): void {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const now = Date.now();
    const expiredToRemove: Retirement[] = [];
    const surviving: Retirement[] = [];

    for (const r of all) {
      if (r.status === 'in_trash' && r.deletedAt) {
        const deletedTime = new Date(r.deletedAt).getTime();
        if (!isNaN(deletedTime) && now - deletedTime > TRASH_RETENTION_MS) {
          if (r.isDemo) {
            expiredToRemove.push(r);
            continue;
          }
          // Do not remove non-demo expired items until globalSyncTrigger is available to record DELETE_RETIREMENT
          if (globalSyncTrigger) {
            globalSyncTrigger(
              'DELETE_RETIREMENT',
              r.id,
              { id: r.id, code: r.code, ownerId: r.ownerId },
              r.id
            );
            expiredToRemove.push(r);
            continue;
          }
        }
      }
      surviving.push(r);
    }

    if (expiredToRemove.length > 0) {
      const expiredIds = new Set(expiredToRemove.map((e) => e.id));
      const cleanedSurviving = surviving.map((r) =>
        Array.isArray(r.connectedRetirementIds) && r.connectedRetirementIds.some((cid) => expiredIds.has(cid))
          ? {
              ...r,
              connectedRetirementIds: r.connectedRetirementIds.filter((cid) => !expiredIds.has(cid)),
            }
          : r
      );
      this.setItem(STORAGE_KEYS.RETIREMENTS, cleanedSurviving);

      // Clean up child daily records, supplementary entries, and activity logs for expired items
      const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
      this.setItem(
        STORAGE_KEYS.DAILY_RECORDS,
        records.filter((r) => !expiredIds.has(r.retirementId))
      );

      const supp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
      this.setItem(
        STORAGE_KEYS.SUPPLEMENTARY,
        supp.filter((s) => !expiredIds.has(s.retirementId))
      );

      const logs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
      this.setItem(
        STORAGE_KEYS.ACTIVITY_LOGS,
        logs.filter((l) => !expiredIds.has(l.retirementId))
      );
    }
  }

  // Helper: Combines categories and items from an incoming daily record into a target daily record
  private mergeRecordCategories(target: DailyRecord, incoming: DailyRecord): void {
    if (!incoming.categories || incoming.categories.length === 0) return;

    if (!target.categories) {
      target.categories = [];
    }

    incoming.categories.forEach((incomingCat) => {
      const trimmedName = incomingCat.name.trim();
      const existingCat = target.categories.find(
        (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingCat) {
        // Append or update items inside the matching category
        incomingCat.items.forEach((item) => {
          const qty = Number(item.quantity) || 0;
          const rt = Number(item.rate) || 0;
          const itemAmount = (qty > 0 && rt > 0) ? calculateAmount(qty, rt) : (Number(item.amount) || 0);
          const existingItemIndex = existingCat.items.findIndex(
            (i) =>
              i.id === item.id ||
              (i.description.trim() === item.description.trim() &&
                i.description.trim() !== '' &&
                i.rate === item.rate &&
                i.quantity === item.quantity)
          );

          if (existingItemIndex >= 0) {
            existingCat.items[existingItemIndex] = {
              ...item,
              quantity: qty,
              rate: rt,
              amount: itemAmount,
            };
          } else {
            existingCat.items.push({
              ...item,
              id: item.id || generateUUID(),
              quantity: qty,
              rate: rt,
              amount: itemAmount,
            });
          }
        });

        // Recalculate subtotal
        existingCat.subtotal = existingCat.items.reduce(
          (sum, i) => sum + (Number(i.amount) || 0),
          0
        );
      } else {
        // Add as a new category within this daily record
        const clonedCat = {
          ...incomingCat,
          id: incomingCat.id || generateUUID(),
          items: incomingCat.items.map((i) => {
            const qty = Number(i.quantity) || 0;
            const rt = Number(i.rate) || 0;
            const amt = (qty > 0 && rt > 0) ? calculateAmount(qty, rt) : (Number(i.amount) || 0);
            return {
              ...i,
              id: i.id || generateUUID(),
              quantity: qty,
              rate: rt,
              amount: amt,
            };
          }),
          subtotal: incomingCat.items.reduce((sum, i) => {
            const qty = Number(i.quantity) || 0;
            const rt = Number(i.rate) || 0;
            const amt = (qty > 0 && rt > 0) ? calculateAmount(qty, rt) : (Number(i.amount) || 0);
            return sum + amt;
          }, 0),
        };
        target.categories.push(clonedCat);
      }
    });

    target.dailyTotal = target.categories.reduce((sum, cat) => sum + cat.subtotal, 0);
    target.updatedAt = new Date().toISOString();
  }

  // --- Daily Records ---
  getDailyRecords(retirementId: string): DailyRecord[] {
    const rawRecords = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const retirementRecords = rawRecords.filter((r) => r.retirementId === retirementId);

    // Group and consolidate records by normalized calendar date (one calendar date = one Daily Retirement)
    let hadDuplicates = false;
    const consolidatedMap = new Map<string, DailyRecord>();

    for (const record of retirementRecords) {
      const normDate = normalizeDate(record.date);
      const normalizedRecord: DailyRecord = {
        ...record,
        date: normDate,
      };

      if (!consolidatedMap.has(normDate)) {
        consolidatedMap.set(normDate, normalizedRecord);
      } else {
        // Multiple entries share the same date -> combine them into one Daily Retirement
        hadDuplicates = true;
        const target = consolidatedMap.get(normDate)!;
        this.mergeRecordCategories(target, normalizedRecord);
      }
    }

    const result = Array.from(consolidatedMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    // Persist consolidated records back to storage if duplicates were merged
    if (hadDuplicates) {
      const otherRecords = rawRecords.filter((r) => r.retirementId !== retirementId);
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, [...otherRecords, ...result]);
    }

    return result;
  }

  saveDailyRecord(record: DailyRecord, skipSync: boolean = false): void {
    const rawRecords = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const normalizedDate = normalizeDate(record.date);
    record.date = normalizedDate;
    if (!skipSync) {
      record.syncStatus = 'pending';
    }

    // Recalculate category subtotals and daily total
    record.categories.forEach((cat) => {
      cat.subtotal = cat.items.reduce((sum, item) => {
        const qty = Number(item.quantity) || 0;
        const rt = Number(item.rate) || 0;
        const amt = (qty > 0 && rt > 0) ? calculateAmount(qty, rt) : (Number(item.amount) || 0);
        item.amount = amt;
        return sum + amt;
      }, 0);
    });
    record.dailyTotal = record.categories.reduce((sum, cat) => sum + cat.subtotal, 0);
    record.updatedAt = new Date().toISOString();

    const existingByIdIndex = rawRecords.findIndex((r) => r.id === record.id);
    const sameDateIndex = rawRecords.findIndex(
      (r) =>
        r.retirementId === record.retirementId &&
        normalizeDate(r.date) === normalizedDate &&
        r.id !== record.id
    );

    let savedRecord = record;
    let oldRecordToDeleteFromCloud: { id: string; retirementId: string; date: string } | null = null;

    if (sameDateIndex >= 0) {
      // An entry for this date already exists! Combine into that single Daily Retirement
      const targetRecord = rawRecords[sameDateIndex];
      const hasSynced = this.hasDailyRecordEverSynced(targetRecord) || Boolean(record.hasSyncedToCloud);
      if (targetRecord.syncStatus !== 'pending') {
        targetRecord.baseUpdatedAt = targetRecord.baseUpdatedAt || targetRecord.updatedAt;
      }
      this.mergeRecordCategories(targetRecord, record);
      targetRecord.hasSyncedToCloud = hasSynced;
      if (!skipSync) {
        targetRecord.syncStatus = 'pending';
      }
      savedRecord = targetRecord;

      // If the incoming record was already in rawRecords with a different ID/date, remove it
      if (existingByIdIndex >= 0 && existingByIdIndex !== sameDateIndex) {
        const prev = rawRecords[existingByIdIndex];
        const prevDate = normalizeDate(prev.date);
        if (prevDate !== normalizedDate) {
          oldRecordToDeleteFromCloud = {
            id: prev.id,
            retirementId: prev.retirementId,
            date: prevDate,
          };
        }
        rawRecords.splice(existingByIdIndex, 1);
      }
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    } else if (existingByIdIndex >= 0) {
      // In-place edit of existing record
      const prev = rawRecords[existingByIdIndex];
      const prevDate = normalizeDate(prev.date);
      if (prevDate !== normalizedDate) {
        // Date changed on an existing record: delete old date row in cloud and assign fresh ID for new date
        oldRecordToDeleteFromCloud = {
          id: prev.id,
          retirementId: prev.retirementId,
          date: prevDate,
        };
        record.id = generateUUID();
        record.hasSyncedToCloud = false;
        delete record.baseUpdatedAt;
        delete record.deletedItemIds;
      } else {
        record.hasSyncedToCloud = this.hasDailyRecordEverSynced(prev) || Boolean(record.hasSyncedToCloud);
        record.baseUpdatedAt =
          prev.syncStatus !== 'pending'
            ? prev.baseUpdatedAt || prev.updatedAt
            : prev.baseUpdatedAt || record.baseUpdatedAt;

        // Track expense item IDs deleted locally so cloud reconciliation never restores them before sync
        const currentItemIds = new Set<string>();
        for (const cat of record.categories || []) {
          for (const it of cat.items || []) {
            if (it.id) currentItemIds.add(it.id);
          }
        }
        const removedIds = new Set<string>(
          prev.syncStatus === 'pending' ? prev.deletedItemIds || [] : []
        );
        for (const cat of prev.categories || []) {
          for (const it of cat.items || []) {
            if (it.id && !currentItemIds.has(it.id)) {
              removedIds.add(it.id);
            }
          }
        }
        currentItemIds.forEach((id) => removedIds.delete(id));
        if (removedIds.size > 0) {
          record.deletedItemIds = Array.from(removedIds);
        } else {
          delete record.deletedItemIds;
        }
      }
      rawRecords[existingByIdIndex] = record;
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    } else {
      // Brand new calendar date entry
      if (record.hasSyncedToCloud === undefined) {
        record.hasSyncedToCloud = skipSync && record.syncStatus === 'synced' ? true : false;
      }
      rawRecords.push(record);
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    }

    // Update retirement updatedAt
    const retirement = this.getRetirementById(record.retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      if (oldRecordToDeleteFromCloud) {
        globalSyncTrigger(
          'DELETE_DAILY_RECORD',
          oldRecordToDeleteFromCloud.id,
          oldRecordToDeleteFromCloud,
          oldRecordToDeleteFromCloud.retirementId
        );
      }
      globalSyncTrigger('UPSERT_DAILY_RECORD', savedRecord.id, savedRecord, savedRecord.retirementId);
    }
  }

  deleteDailyRecord(id: string, retirementId: string, skipSync: boolean = false): void {
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const target = records.find((r) => r.id === id);
    const targetDate = target ? normalizeDate(target.date) : undefined;
    const filtered = records.filter((r) => r.id !== id);
    this.setItem(STORAGE_KEYS.DAILY_RECORDS, filtered);

    const retirement = this.getRetirementById(retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      globalSyncTrigger(
        'DELETE_DAILY_RECORD',
        id,
        { id, retirementId, date: targetDate },
        retirementId
      );
    }
  }

  // --- Supplementary ---
  getSupplementaryEntries(retirementId: string): SupplementaryEntry[] {
    const entries = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    return entries
      .filter((e) => e.retirementId === retirementId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  saveSupplementaryEntry(entry: SupplementaryEntry, skipSync: boolean = false): void {
    const entries = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const index = entries.findIndex((e) => e.id === entry.id);
    if (index >= 0) {
      entry.hasSyncedToCloud =
        this.hasSupplementaryEverSynced(entries[index]) || Boolean(entry.hasSyncedToCloud);
    } else if (entry.hasSyncedToCloud === undefined) {
      entry.hasSyncedToCloud = skipSync && entry.syncStatus === 'synced' ? true : false;
    }
    if (!skipSync) {
      entry.syncStatus = 'pending';
    }
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
    this.setItem(STORAGE_KEYS.SUPPLEMENTARY, entries);

    const retirement = this.getRetirementById(entry.retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      globalSyncTrigger('UPSERT_SUPPLEMENTARY', entry.id, entry, entry.retirementId);
    }
  }

  deleteSupplementaryEntry(id: string, retirementId: string, skipSync: boolean = false): void {
    const entries = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const filtered = entries.filter((e) => e.id !== id);
    this.setItem(STORAGE_KEYS.SUPPLEMENTARY, filtered);

    const retirement = this.getRetirementById(retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      globalSyncTrigger('DELETE_SUPPLEMENTARY', id, { id, retirementId }, retirementId);
    }
  }

  // --- Calculations & Totals ---
  calculateTotals(retirementId: string, startDate?: string, endDate?: string): RetirementTotals {
    let dailyRecords = this.getDailyRecords(retirementId);
    if (startDate) {
      dailyRecords = dailyRecords.filter((r) => r.date >= startDate);
    }
    if (endDate) {
      dailyRecords = dailyRecords.filter((r) => r.date <= endDate);
    }

    const supplementary = this.getSupplementaryEntries(retirementId);

    let dailyRetirementTotal = 0;
    const categoryTotalsMap = new Map<string, number>();
    const dailySummaries: { date: string; total: number }[] = [];

    dailyRecords.forEach((record) => {
      let recTotal = 0;
      record.categories.forEach((cat) => {
        let catSubtotal = 0;
        cat.items.forEach((item) => {
          const itemAmount = Math.round(Math.max(0, item.quantity) * Math.max(0, item.rate) * 100) / 100;
          catSubtotal += itemAmount;
        });
        recTotal += catSubtotal;

        const currentCatTotal = categoryTotalsMap.get(cat.name) || 0;
        categoryTotalsMap.set(cat.name, currentCatTotal + catSubtotal);
      });

      dailyRetirementTotal += recTotal;
      dailySummaries.push({ date: record.date, total: recTotal });
    });

    let supplementaryTotal = 0;
    supplementary.forEach((item) => {
      supplementaryTotal += Math.max(0, Number(item.amount) || 0);
    });

    const categorySummaries = Array.from(categoryTotalsMap.entries()).map(([category, total]) => ({
      category,
      total,
    }));

    if (supplementaryTotal > 0) {
      categorySummaries.push({
        category: 'Supplementary',
        total: supplementaryTotal,
      });
    }

    const generalTotal = dailyRetirementTotal + supplementaryTotal;

    return {
      dailyRetirementTotal,
      supplementaryTotal,
      generalTotal,
      categorySummaries,
      dailySummaries,
    };
  }

  // --- Activity History ---
  getActivityLogs(retirementId: string): ActivityLog[] {
    const logs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
    return logs
      .filter((l) => l.retirementId === retirementId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  logActivity(retirementId: string, action: string, details?: string): void {
    const logs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
    const currentUser = this.getCurrentUser();
    const log: ActivityLog = {
      id: generateUUID(),
      retirementId,
      userId: currentUser?.id || 'anonymous',
      userName: currentUser?.name || 'Site User',
      action,
      details,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(log);
    // Keep max 200 logs per storage
    this.setItem(STORAGE_KEYS.ACTIVITY_LOGS, logs.slice(0, 200));
  }

  // --- Demo Data Management ---
  loadDemoData(activeUser?: UserProfile | null): void {
    const currentUser = activeUser || this.getCurrentUser();
    const demo1 = createDemoRetirement();
    const demo2 = createConnectedDemoRetirement();

    if (currentUser) {
      demo1.retirement.ownerId = currentUser.id;
      demo1.retirement.ownerName = currentUser.name;
      demo1.retirement.ownerDesignation = currentUser.designation;
      demo1.retirement.ownerPhone = currentUser.phone;
      if (demo1.retirement.access[0]) {
        demo1.retirement.access[0].userId = currentUser.id;
        demo1.retirement.access[0].userName = currentUser.name;
        demo1.retirement.access[0].userEmail = currentUser.email;
      }

      demo2.retirement.ownerId = currentUser.id;
      demo2.retirement.ownerName = currentUser.name;
      demo2.retirement.ownerDesignation = currentUser.designation;
      demo2.retirement.ownerPhone = currentUser.phone;
      if (demo2.retirement.access[0]) {
        demo2.retirement.access[0].userId = currentUser.id;
        demo2.retirement.access[0].userName = currentUser.name;
        demo2.retirement.access[0].userEmail = currentUser.email;
      }
    }

    const allRetirements = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    // Remove previous demo if any
    const nonDemoRetirements = allRetirements.filter((r) => !r.isDemo);
    this.setItem(STORAGE_KEYS.RETIREMENTS, [demo1.retirement, demo2.retirement, ...nonDemoRetirements]);

    const allDaily = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const nonDemoDaily = allDaily.filter((d) => d.retirementId !== demo1.retirement.id && d.retirementId !== demo2.retirement.id);
    this.setItem(STORAGE_KEYS.DAILY_RECORDS, [...demo1.dailyRecords, ...demo2.dailyRecords, ...nonDemoDaily]);

    const allSupp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const nonDemoSupp = allSupp.filter((s) => s.retirementId !== demo1.retirement.id && s.retirementId !== demo2.retirement.id);
    this.setItem(STORAGE_KEYS.SUPPLEMENTARY, [...demo1.supplementary, ...demo2.supplementary, ...nonDemoSupp]);

    const allLogs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
    const nonDemoLogs = allLogs.filter((l) => l.retirementId !== demo1.retirement.id && l.retirementId !== demo2.retirement.id);
    this.setItem(STORAGE_KEYS.ACTIVITY_LOGS, [...demo1.logs, ...demo2.logs, ...nonDemoLogs]);
  }

  clearDemoData(): void {
    const allRetirements = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const demoIds = allRetirements.filter((r) => r.isDemo).map((r) => r.id);
    this.setItem(
      STORAGE_KEYS.RETIREMENTS,
      allRetirements.filter((r) => !r.isDemo)
    );

    const allDaily = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    this.setItem(
      STORAGE_KEYS.DAILY_RECORDS,
      allDaily.filter((d) => !demoIds.includes(d.retirementId))
    );

    const allSupp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    this.setItem(
      STORAGE_KEYS.SUPPLEMENTARY,
      allSupp.filter((s) => !demoIds.includes(s.retirementId))
    );

    const allLogs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
    this.setItem(
      STORAGE_KEYS.ACTIVITY_LOGS,
      allLogs.filter((l) => !demoIds.includes(l.retirementId))
    );
  }

  hasDemoData(): boolean {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    return all.some((r) => r.isDemo);
  }

  // --- Cloud Sync State & Data Merging ---
  hasRetirementEverSynced(ret: Retirement): boolean {
    if (ret.hasSyncedToCloud === true || ret.syncStatus === 'synced') {
      return true;
    }
    if (ret.hasSyncedToCloud === false) {
      return false;
    }
    // For pre-existing local records created before hasSyncedToCloud was introduced:
    // 1. Cloud-hydrated retirements only store REVIEWER rows in access (no OWNER row in access)
    const accessList = Array.isArray(ret.access) ? ret.access : [];
    const hasLocalOwnerAccessRow = accessList.some((a) => a.role === 'OWNER');
    if (!hasLocalOwnerAccessRow) {
      return true;
    }
    // 2. Or any child daily record / supplementary entry was already synced with the cloud
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    if (
      records.some(
        (r) =>
          r.retirementId === ret.id &&
          (r.syncStatus === 'synced' || Boolean(r.baseUpdatedAt) || r.hasSyncedToCloud)
      )
    ) {
      return true;
    }
    const supp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    if (supp.some((s) => s.retirementId === ret.id && (s.syncStatus === 'synced' || s.hasSyncedToCloud))) {
      return true;
    }
    return false;
  }

  hasDailyRecordEverSynced(rec: DailyRecord): boolean {
    if (rec.hasSyncedToCloud === true || rec.syncStatus === 'synced' || Boolean(rec.baseUpdatedAt)) {
      return true;
    }
    return false;
  }

  hasSupplementaryEverSynced(supp: SupplementaryEntry): boolean {
    if (supp.hasSyncedToCloud === true || supp.syncStatus === 'synced') {
      return true;
    }
    return false;
  }

  markRetirementSynced(id: string): void {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      all[index].syncStatus = 'synced';
      all[index].hasSyncedToCloud = true;
      this.setItem(STORAGE_KEYS.RETIREMENTS, all);
    }
  }

  markDailyRecordSynced(id: string, authoritativeCloudId?: string, cloudUpdatedAt?: string): void {
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const index = records.findIndex(
      (r) => r.id === id || (authoritativeCloudId && r.id === authoritativeCloudId)
    );
    if (index >= 0) {
      if (authoritativeCloudId && authoritativeCloudId !== records[index].id) {
        records[index].id = authoritativeCloudId;
      }
      records[index].syncStatus = 'synced';
      records[index].hasSyncedToCloud = true;
      const effectiveUpdatedAt = cloudUpdatedAt || records[index].updatedAt;
      records[index].updatedAt = effectiveUpdatedAt;
      records[index].baseUpdatedAt = effectiveUpdatedAt;
      delete records[index].deletedItemIds;
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, records);
    }
  }

  markSupplementarySynced(id: string): void {
    const entries = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const index = entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      entries[index].syncStatus = 'synced';
      entries[index].hasSyncedToCloud = true;
      this.setItem(STORAGE_KEYS.SUPPLEMENTARY, entries);
    }
  }

  /**
   * Reconciles a local DailyRecord and a cloud DailyRecord that share the same
   * canonical identity (retirementId, normalized calendar date).
   * - Adopts the authoritative cloud record ID (cloudRec.id).
   * - Preserves local pending modifications and item deletions without duplicating edits.
   * - Deduplicates identical logical expenses across distinct-ID records.
   * - Preserves legitimate expense items that share descriptions with different quantities/rates.
   */
  private reconcileDailyRecordWithCloud(
    localRec: DailyRecord,
    cloudRec: DailyRecord
  ): {
    record: DailyRecord;
    needsCloudPush: boolean;
    conflictMessages: string[];
  } {
    const conflictMessages: string[] = [];
    const normDate = normalizeDate(cloudRec.date);

    // 1. If local record is already synced with the exact same cloud ID, cloud is authoritative
    if (localRec.syncStatus !== 'pending' && localRec.id === cloudRec.id) {
      return {
        record: {
          ...cloudRec,
          date: normDate,
          baseUpdatedAt: cloudRec.updatedAt,
          hasSyncedToCloud: true,
          syncStatus: 'synced',
        },
        needsCloudPush: false,
        conflictMessages,
      };
    }

    // 2. If local record is pending, shares the same ID, and cloud has not changed since baseUpdatedAt,
    //    then localRec is a clean descendant of cloudRec (user's own pending edit, addition, or deletion).
    if (
      localRec.syncStatus === 'pending' &&
      localRec.id === cloudRec.id &&
      (!localRec.baseUpdatedAt || areTimestampsEqual(localRec.baseUpdatedAt, cloudRec.updatedAt))
    ) {
      return {
        record: {
          ...localRec,
          id: cloudRec.id,
          date: normDate,
          baseUpdatedAt: cloudRec.updatedAt,
          hasSyncedToCloud: true,
          syncStatus: 'pending',
        },
        needsCloudPush: true,
        conflictMessages,
      };
    }

    // 3. Divergent versions (different local vs. cloud IDs for the same date, or concurrent updates):
    //    Reconcile categories and expense items while adopting cloudRec.id.
    let needsCloudPush = localRec.syncStatus === 'pending' || localRec.id !== cloudRec.id;
    const deletedItemIds = new Set<string>(
      localRec.syncStatus === 'pending' ? localRec.deletedItemIds || [] : []
    );

    const reconciledCategories = (localRec.categories || []).map((cat) => ({
      ...cat,
      id: cat.id || generateUUID(),
      name: cat.name.trim() || 'General',
      items: (cat.items || []).map((item) => {
        const qty = Number(item.quantity) || 0;
        const rt = Number(item.rate) || 0;
        const amt = qty > 0 && rt > 0 ? calculateAmount(qty, rt) : Number(item.amount) || 0;
        return {
          ...item,
          id: item.id || generateUUID(),
          description: item.description.trim(),
          quantity: qty,
          rate: rt,
          amount: amt,
        };
      }),
      subtotal: 0,
    }));

    for (const cloudCat of cloudRec.categories || []) {
      const cCatName = (cloudCat.name || 'General').trim();
      const rawCloudItems = cloudCat.items || [];
      const survivingCloudItems = rawCloudItems.filter((it) => {
        if (it.id && deletedItemIds.has(it.id)) {
          needsCloudPush = true;
          return false;
        }
        return true;
      });

      const localCat = reconciledCategories.find(
        (c) => c.name.trim().toLowerCase() === cCatName.toLowerCase()
      );

      if (!localCat) {
        if (survivingCloudItems.length === 0) {
          continue;
        }
        // Cloud category does not exist locally -> preserve cloud category and its non-deleted items
        const clonedItems = survivingCloudItems.map((it) => {
          const qty = Number(it.quantity) || 0;
          const rt = Number(it.rate) || 0;
          const amt = qty > 0 && rt > 0 ? calculateAmount(qty, rt) : Number(it.amount) || 0;
          return {
            id: it.id || generateUUID(),
            description: (it.description || '').trim(),
            quantity: qty,
            rate: rt,
            amount: amt,
          };
        });
        reconciledCategories.push({
          id: cloudCat.id || generateUUID(),
          name: cCatName,
          items: clonedItems,
          subtotal: clonedItems.reduce((s, i) => s + i.amount, 0),
        });
        needsCloudPush = true;
      } else {
        // Category exists in both -> reconcile expense items
        const cloudCatItemIds = new Set<string>(
          survivingCloudItems.map((it) => it.id).filter(Boolean)
        );
        const matchedLocalItemIds = new Set<string>();

        for (const cloudItem of survivingCloudItems) {
          const cDesc = (cloudItem.description || '').trim();
          const cQty = Number(cloudItem.quantity) || 0;
          const cRate = Number(cloudItem.rate) || 0;
          const cAmt = cQty > 0 && cRate > 0 ? calculateAmount(cQty, cRate) : Number(cloudItem.amount) || 0;

          // Match 1: Same item ID -> update or preserve in place without creating duplicate items
          const sameIdItem = localCat.items.find((i) => i.id === cloudItem.id);
          if (sameIdItem) {
            matchedLocalItemIds.add(sameIdItem.id);
            const isIdentical =
              sameIdItem.description.trim().toLowerCase() === cDesc.toLowerCase() &&
              Number(sameIdItem.quantity) === cQty &&
              Number(sameIdItem.rate) === cRate;

            if (!isIdentical) {
              if (localRec.syncStatus === 'pending') {
                // Keep the pending local edit in-place on sameIdItem and push to cloud
                needsCloudPush = true;
              } else {
                // Local record is not pending; adopt authoritative cloud item values in-place
                sameIdItem.description = cDesc;
                sameIdItem.quantity = cQty;
                sameIdItem.rate = cRate;
                sameIdItem.amount = cAmt;
              }
            }
            continue;
          }

          // Match 2: Identical logical expense across distinct item IDs (same description, quantity, and rate)
          const sameLogicalItem = localCat.items.find(
            (i) =>
              !matchedLocalItemIds.has(i.id) &&
              !cloudCatItemIds.has(i.id) &&
              cDesc !== '' &&
              i.description.trim().toLowerCase() === cDesc.toLowerCase() &&
              Number(i.quantity) === cQty &&
              Number(i.rate) === cRate
          );
          if (sameLogicalItem) {
            // Reconcile item ID to cloud item ID and avoid duplicate expense
            sameLogicalItem.id = cloudItem.id || sameLogicalItem.id;
            matchedLocalItemIds.add(sameLogicalItem.id);
            continue;
          }

          // Match 3: Distinct cloud-side expense item not present locally -> preserve it as a normal item
          const newItemId = cloudItem.id || generateUUID();
          localCat.items.push({
            id: newItemId,
            description: cDesc,
            quantity: cQty,
            rate: cRate,
            amount: cAmt,
          });
          matchedLocalItemIds.add(newItemId);
          needsCloudPush = true;
        }
      }
    }

    // Recalculate all category subtotals and dailyTotal
    reconciledCategories.forEach((cat) => {
      cat.subtotal = cat.items.reduce((sum, it) => {
        const q = Number(it.quantity) || 0;
        const r = Number(it.rate) || 0;
        const amt = q > 0 && r > 0 ? calculateAmount(q, r) : Number(it.amount) || 0;
        it.amount = amt;
        return sum + amt;
      }, 0);
    });
    const dailyTotal = reconciledCategories.reduce((sum, cat) => sum + cat.subtotal, 0);

    const reconciledRecord: DailyRecord = {
      id: cloudRec.id, // Always adopt authoritative cloud UUID for (retirementId, date)
      retirementId: cloudRec.retirementId,
      date: normDate,
      categories: reconciledCategories,
      dailyTotal,
      createdAt: cloudRec.createdAt || localRec.createdAt,
      updatedAt: needsCloudPush ? new Date().toISOString() : cloudRec.updatedAt,
      baseUpdatedAt: cloudRec.updatedAt,
      hasSyncedToCloud: true,
      ...(needsCloudPush && deletedItemIds.size > 0
        ? { deletedItemIds: Array.from(deletedItemIds) }
        : {}),
      syncStatus: needsCloudPush ? 'pending' : 'synced',
    };

    return {
      record: reconciledRecord,
      needsCloudPush,
      conflictMessages,
    };
  }

  mergeCloudData(
    cloudRetirements: Retirement[],
    cloudDailyRecords: DailyRecord[],
    cloudSupplementary: SupplementaryEntry[],
    deletedRetirementIds?: Set<string>
  ): {
    reconciledDailyRecords: { oldId: string; newId: string; record: DailyRecord }[];
    conflicts: string[];
    prunedRetirementIds: string[];
  } {
    const reconciledDailyRecords: { oldId: string; newId: string; record: DailyRecord }[] = [];
    const conflicts: string[] = [];
    const prunedRetirementIdSet = new Set<string>(deletedRetirementIds ? Array.from(deletedRetirementIds) : []);

    // 1. Merge Retirements
    const localRetirements = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const demoRetirements = localRetirements.filter((r) => r.isDemo);
    const nonDemoLocal = localRetirements.filter((r) => !r.isDemo);

    const mergedRetirements: Retirement[] = [...demoRetirements];

    // Build map of non-demo local
    const localMap = new Map<string, Retirement>(nonDemoLocal.map((r) => [r.id, r]));

    for (const rawCloudRet of cloudRetirements) {
      if (prunedRetirementIdSet.has(rawCloudRet.id)) {
        localMap.delete(rawCloudRet.id);
        continue;
      }
      const cloudRet: Retirement = { ...rawCloudRet, hasSyncedToCloud: true };
      const existingLocal = localMap.get(cloudRet.id);
      if (existingLocal) {
        // If locally modified & pending sync, preserve local changes while marking hasSyncedToCloud
        if (existingLocal.syncStatus === 'pending') {
          mergedRetirements.push({ ...existingLocal, hasSyncedToCloud: true });
        } else {
          // Cloud takes precedence if newer or synced
          mergedRetirements.push(cloudRet);
        }
        localMap.delete(cloudRet.id);
      } else {
        // Brand new cloud retirement
        mergedRetirements.push(cloudRet);
      }
    }

    // Evaluate remaining local retirements absent from cloudRetirements:
    // - If tombstoned in cloud OR previously synchronized with cloud, it was permanently deleted (or access revoked) -> prune it!
    // - Keep ONLY genuinely unsynced local creations (created offline / pre-cloud legacy pending initial upload).
    localMap.forEach((local) => {
      if (prunedRetirementIdSet.has(local.id) || this.hasRetirementEverSynced(local)) {
        prunedRetirementIdSet.add(local.id);
      } else {
        mergedRetirements.push(local);
      }
    });

    // Remove any pruned retirement IDs from surviving retirements' connectedRetirementIds
    const cleanedMergedRetirements = mergedRetirements.map((r) =>
      Array.isArray(r.connectedRetirementIds) &&
      r.connectedRetirementIds.some((cid) => prunedRetirementIdSet.has(cid))
        ? {
            ...r,
            connectedRetirementIds: r.connectedRetirementIds.filter(
              (cid) => !prunedRetirementIdSet.has(cid)
            ),
          }
        : r
    );

    this.setItem(STORAGE_KEYS.RETIREMENTS, cleanedMergedRetirements);

    const survivingRetirementIds = new Set<string>(cleanedMergedRetirements.map((r) => r.id));
    const cloudRetirementIdSet = new Set<string>(cloudRetirements.map((r) => r.id));
    // Track retirements that are currently in Trash (either in cloud or local) so child records are preserved
    // during the 48-hour recovery window even if legacy RLS restricted fetching child rows for in_trash retirements
    const trashedRetirementIds = new Set<string>();
    for (const r of cloudRetirements) {
      if (r.status === 'in_trash') trashedRetirementIds.add(r.id);
    }
    for (const r of cleanedMergedRetirements) {
      if (r.status === 'in_trash') trashedRetirementIds.add(r.id);
    }

    // Clean up activity logs for pruned retirements
    if (prunedRetirementIdSet.size > 0) {
      const logs = this.getItem<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
      this.setItem(
        STORAGE_KEYS.ACTIVITY_LOGS,
        logs.filter((l) => !prunedRetirementIdSet.has(l.retirementId))
      );
    }

    // 2. Merge Daily Records (Enforcing 1 record per retirement per calendar date)
    const rawLocalRecords = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);

    // First consolidate rawLocalRecords by canonical key `${retirementId}::${normalizeDate(date)}`
    // excluding records belonging to pruned or non-existent retirements
    const consolidatedLocalByKey = new Map<string, DailyRecord>();
    for (const r of rawLocalRecords) {
      if (prunedRetirementIdSet.has(r.retirementId) || !survivingRetirementIds.has(r.retirementId)) {
        continue;
      }
      const normDate = normalizeDate(r.date);
      const key = `${r.retirementId}::${normDate}`;
      const normalizedRec: DailyRecord = { ...r, date: normDate };
      if (!consolidatedLocalByKey.has(key)) {
        consolidatedLocalByKey.set(key, normalizedRec);
      } else {
        const target = consolidatedLocalByKey.get(key)!;
        const wasPending = target.syncStatus === 'pending' || normalizedRec.syncStatus === 'pending';
        const hadSynced =
          this.hasDailyRecordEverSynced(target) || this.hasDailyRecordEverSynced(normalizedRec);
        this.mergeRecordCategories(target, normalizedRec);
        target.hasSyncedToCloud = hadSynced;
        if (wasPending) {
          target.syncStatus = 'pending';
        }
      }
    }

    const localRecords = Array.from(consolidatedLocalByKey.values());
    const localRecById = new Map<string, DailyRecord>();
    for (const r of localRecords) {
      localRecById.set(r.id, r);
    }

    const mergedRecords: DailyRecord[] = [];
    const processedLocalIds = new Set<string>();
    const processedKeys = new Set<string>();

    for (const rawCloudRec of cloudDailyRecords) {
      if (
        prunedRetirementIdSet.has(rawCloudRec.retirementId) ||
        !survivingRetirementIds.has(rawCloudRec.retirementId)
      ) {
        continue;
      }
      const normCloudDate = normalizeDate(rawCloudRec.date);
      const cloudRec: DailyRecord = {
        ...rawCloudRec,
        date: normCloudDate,
        baseUpdatedAt: rawCloudRec.updatedAt,
        hasSyncedToCloud: true,
      };
      const key = `${cloudRec.retirementId}::${normCloudDate}`;
      if (processedKeys.has(key)) continue;
      processedKeys.add(key);

      // Match by canonical (retirementId, date) key first
      const byKey = consolidatedLocalByKey.get(key);
      let existingLocal: DailyRecord | undefined =
        byKey && !processedLocalIds.has(byKey.id) ? byKey : undefined;

      // If no local record exists for this date, check if an unmodified local record shares cloudRec.id
      if (!existingLocal) {
        const byId = localRecById.get(cloudRec.id);
        if (byId && !processedLocalIds.has(byId.id) && byId.syncStatus !== 'pending') {
          processedLocalIds.add(byId.id);
        }
        mergedRecords.push(cloudRec);
        continue;
      }

      processedLocalIds.add(existingLocal.id);

      const { record: reconciled, needsCloudPush, conflictMessages } =
        this.reconcileDailyRecordWithCloud(existingLocal, cloudRec);

      mergedRecords.push(reconciled);

      if (existingLocal.id !== cloudRec.id || needsCloudPush) {
        reconciledDailyRecords.push({
          oldId: existingLocal.id,
          newId: cloudRec.id,
          record: reconciled,
        });
      }

      if (conflictMessages.length > 0) {
        conflicts.push(...conflictMessages);
        for (const msg of conflictMessages) {
          this.logActivity(cloudRec.retirementId, 'Sync Conflict Preserved', msg);
        }
      }
    }

    // Evaluate remaining local daily records absent from cloudDailyRecords:
    // - Preserve if parent retirement is in Trash (48-hour recovery safeguard)
    // - If parent retirement is active in cloud and this daily record was already synced, prune it (deleted in cloud)
    // - Otherwise (unsynced local creation), keep it
    for (const local of localRecords) {
      const key = `${local.retirementId}::${normalizeDate(local.date)}`;
      if (!processedLocalIds.has(local.id) && !processedKeys.has(key)) {
        processedLocalIds.add(local.id);
        processedKeys.add(key);

        const isParentInTrash = trashedRetirementIds.has(local.retirementId);
        const isParentInCloud = cloudRetirementIdSet.has(local.retirementId);
        if (isParentInCloud && !isParentInTrash && this.hasDailyRecordEverSynced(local) && local.syncStatus === 'synced') {
          // Previously synced daily record absent from active cloud retirement -> deleted in cloud
          continue;
        }
        mergedRecords.push(local);
      }
    }

    this.setItem(STORAGE_KEYS.DAILY_RECORDS, mergedRecords);

    // 3. Merge Supplementary Entries
    const localSupp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []).filter(
      (s) => !prunedRetirementIdSet.has(s.retirementId) && survivingRetirementIds.has(s.retirementId)
    );
    const mergedSupp: SupplementaryEntry[] = [];
    const localSuppMap = new Map<string, SupplementaryEntry>(localSupp.map((s) => [s.id, s]));

    for (const rawCloudS of cloudSupplementary) {
      if (
        prunedRetirementIdSet.has(rawCloudS.retirementId) ||
        !survivingRetirementIds.has(rawCloudS.retirementId)
      ) {
        continue;
      }
      const cloudS: SupplementaryEntry = { ...rawCloudS, hasSyncedToCloud: true };
      const existing = localSuppMap.get(cloudS.id);
      if (existing) {
        if (existing.syncStatus === 'pending') {
          mergedSupp.push({ ...existing, hasSyncedToCloud: true });
        } else {
          mergedSupp.push(cloudS);
        }
        localSuppMap.delete(cloudS.id);
      } else {
        mergedSupp.push(cloudS);
      }
    }

    localSuppMap.forEach((local) => {
      const isParentInTrash = trashedRetirementIds.has(local.retirementId);
      const isParentInCloud = cloudRetirementIdSet.has(local.retirementId);
      if (isParentInCloud && !isParentInTrash && this.hasSupplementaryEverSynced(local) && local.syncStatus === 'synced') {
        // Previously synced supplementary entry absent from active cloud retirement -> deleted in cloud
        return;
      }
      mergedSupp.push(local);
    });

    this.setItem(STORAGE_KEYS.SUPPLEMENTARY, mergedSupp);

    return {
      reconciledDailyRecords,
      conflicts,
      prunedRetirementIds: Array.from(prunedRetirementIdSet),
    };
  }
}

export const storage = new StorageService();
