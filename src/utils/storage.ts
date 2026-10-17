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
    this.cleanupExpiredTrash();
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
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const currentUser = this.getCurrentUser();
    if (!currentUser) return [];

    // Check permissions: Owner OR Access list contains user ID or email
    const accessible = all.filter((r) => {
      if (r.ownerId === currentUser.id) return true;
      return r.access.some((a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase());
    });

    if (includeTrash) {
      return accessible;
    }
    return accessible.filter((r) => r.status === 'active');
  }

  getTrashRetirements(): Retirement[] {
    this.cleanupExpiredTrash();
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const currentUser = this.getCurrentUser();
    if (!currentUser) return [];
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
    
    if (!retirement.isDemo && !skipSync) {
      retirement.syncStatus = 'pending';
    }

    if (index >= 0) {
      all[index] = { ...retirement, updatedAt: new Date().toISOString() };
    } else {
      all.unshift(retirement);
    }
    this.setItem(STORAGE_KEYS.RETIREMENTS, all);

    if (!skipSync && !retirement.isDemo && globalSyncTrigger) {
      globalSyncTrigger('UPSERT_RETIREMENT', retirement.id, retirement);
    }
  }

  moveToTrash(id: string, skipSync: boolean = false): boolean {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      all[index].status = 'in_trash';
      all[index].deletedAt = new Date().toISOString();
      if (!all[index].isDemo && !skipSync) {
        all[index].syncStatus = 'pending';
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
      all[index].status = 'active';
      delete all[index].deletedAt;
      if (!all[index].isDemo && !skipSync) {
        all[index].syncStatus = 'pending';
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
    const filtered = all.filter((r) => r.id !== id);
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

    if (!skipSync && target && !target.isDemo && globalSyncTrigger) {
      globalSyncTrigger('DELETE_RETIREMENT', id, { id });
    }

    return true;
  }

  private cleanupExpiredTrash(): void {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const now = Date.now();
    const expired: Retirement[] = [];
    const surviving = all.filter((r) => {
      if (r.status === 'in_trash' && r.deletedAt) {
        const deletedTime = new Date(r.deletedAt).getTime();
        if (now - deletedTime > TRASH_RETENTION_MS) {
          expired.push(r);
          return false; // Prune expired item
        }
      }
      return true;
    });

    if (surviving.length !== all.length) {
      this.setItem(STORAGE_KEYS.RETIREMENTS, surviving);

      // Clean up child daily records and supplementary for expired items
      const expiredIds = new Set(expired.map((e) => e.id));
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

      // Trigger cloud deletion for expired non-demo retirements so they are not stranded
      if (globalSyncTrigger) {
        for (const item of expired) {
          if (!item.isDemo) {
            globalSyncTrigger('DELETE_RETIREMENT', item.id, { id: item.id });
          }
        }
      }
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

    if (sameDateIndex >= 0) {
      // An entry for this date already exists! Combine into that single Daily Retirement
      const targetRecord = rawRecords[sameDateIndex];
      this.mergeRecordCategories(targetRecord, record);
      if (!skipSync) {
        targetRecord.syncStatus = 'pending';
      }
      savedRecord = targetRecord;

      // If the incoming record was already in rawRecords with a different ID/date, remove it
      if (existingByIdIndex >= 0 && existingByIdIndex !== sameDateIndex) {
        rawRecords.splice(existingByIdIndex, 1);
      }
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    } else if (existingByIdIndex >= 0) {
      // In-place edit of existing record
      rawRecords[existingByIdIndex] = record;
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    } else {
      // Brand new calendar date entry
      rawRecords.push(record);
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, rawRecords);
    }

    // Update retirement updatedAt
    const retirement = this.getRetirementById(record.retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      globalSyncTrigger('UPSERT_DAILY_RECORD', savedRecord.id, savedRecord, savedRecord.retirementId);
    }
  }

  deleteDailyRecord(id: string, retirementId: string, skipSync: boolean = false): void {
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const filtered = records.filter((r) => r.id !== id);
    this.setItem(STORAGE_KEYS.DAILY_RECORDS, filtered);

    const retirement = this.getRetirementById(retirementId);
    if (retirement) {
      this.saveRetirement(retirement, skipSync);
    }

    if (!skipSync && globalSyncTrigger) {
      globalSyncTrigger('DELETE_DAILY_RECORD', id, { id, retirementId }, retirementId);
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
    if (!skipSync) {
      entry.syncStatus = 'pending';
    }
    const index = entries.findIndex((e) => e.id === entry.id);
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
  markRetirementSynced(id: string): void {
    const all = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      all[index].syncStatus = 'synced';
      this.setItem(STORAGE_KEYS.RETIREMENTS, all);
    }
  }

  markDailyRecordSynced(id: string): void {
    const records = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) {
      records[index].syncStatus = 'synced';
      this.setItem(STORAGE_KEYS.DAILY_RECORDS, records);
    }
  }

  markSupplementarySynced(id: string): void {
    const entries = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const index = entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      entries[index].syncStatus = 'synced';
      this.setItem(STORAGE_KEYS.SUPPLEMENTARY, entries);
    }
  }

  mergeCloudData(
    cloudRetirements: Retirement[],
    cloudDailyRecords: DailyRecord[],
    cloudSupplementary: SupplementaryEntry[]
  ): void {
    // 1. Merge Retirements
    const localRetirements = this.getItem<Retirement[]>(STORAGE_KEYS.RETIREMENTS, []);
    const demoRetirements = localRetirements.filter((r) => r.isDemo);
    const nonDemoLocal = localRetirements.filter((r) => !r.isDemo);

    const mergedRetirements: Retirement[] = [...demoRetirements];

    // Build map of non-demo local
    const localMap = new Map<string, Retirement>(nonDemoLocal.map((r) => [r.id, r]));

    for (const cloudRet of cloudRetirements) {
      const existingLocal = localMap.get(cloudRet.id);
      if (existingLocal) {
        // If locally modified & pending sync, preserve local changes!
        if (existingLocal.syncStatus === 'pending') {
          mergedRetirements.push(existingLocal);
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

    // Keep any remaining local retirements (e.g. created offline)
    localMap.forEach((local) => {
      mergedRetirements.push(local);
    });

    this.setItem(STORAGE_KEYS.RETIREMENTS, mergedRetirements);

    // 2. Merge Daily Records (Enforcing 1 record per retirement per calendar date)
    const localRecords = this.getItem<DailyRecord[]>(STORAGE_KEYS.DAILY_RECORDS, []);
    const mergedRecords: DailyRecord[] = [];
    
    // Index local records by ID and by canonical key: `${retirementId}::${normalizeDate(date)}`
    const localRecById = new Map<string, DailyRecord>();
    const localRecByKey = new Map<string, DailyRecord>();
    for (const r of localRecords) {
      localRecById.set(r.id, r);
      localRecByKey.set(`${r.retirementId}::${normalizeDate(r.date)}`, r);
    }

    const processedLocalIds = new Set<string>();

    for (const cloudRec of cloudDailyRecords) {
      const key = `${cloudRec.retirementId}::${normalizeDate(cloudRec.date)}`;
      const existingLocal = localRecById.get(cloudRec.id) || localRecByKey.get(key);

      if (existingLocal) {
        processedLocalIds.add(existingLocal.id);
        if (existingLocal.syncStatus === 'pending') {
          // Preserve local pending modifications
          mergedRecords.push(existingLocal);
        } else {
          // Cloud record takes precedence
          mergedRecords.push(cloudRec);
        }
      } else {
        // New record from cloud
        mergedRecords.push(cloudRec);
      }
    }

    // Keep any remaining local daily records that were created locally/offline
    for (const local of localRecords) {
      if (!processedLocalIds.has(local.id)) {
        mergedRecords.push(local);
      }
    }

    this.setItem(STORAGE_KEYS.DAILY_RECORDS, mergedRecords);

    // 3. Merge Supplementary Entries
    const localSupp = this.getItem<SupplementaryEntry[]>(STORAGE_KEYS.SUPPLEMENTARY, []);
    const mergedSupp: SupplementaryEntry[] = [];
    const localSuppMap = new Map<string, SupplementaryEntry>(localSupp.map((s) => [s.id, s]));

    for (const cloudS of cloudSupplementary) {
      const existing = localSuppMap.get(cloudS.id);
      if (existing) {
        if (existing.syncStatus === 'pending') {
          mergedSupp.push(existing);
        } else {
          mergedSupp.push(cloudS);
        }
        localSuppMap.delete(cloudS.id);
      } else {
        mergedSupp.push(cloudS);
      }
    }

    localSuppMap.forEach((local) => {
      mergedSupp.push(local);
    });

    this.setItem(STORAGE_KEYS.SUPPLEMENTARY, mergedSupp);
  }
}

export const storage = new StorageService();
