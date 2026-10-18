import { supabase, isSupabaseConfigured } from './supabaseClient';
import { storage, setSyncTrigger, normalizeDate } from './storage';
import {
  Retirement,
  DailyRecord,
  SupplementaryEntry,
  UserProfile,
  SyncQueueItem,
  SyncOperationType,
  SyncState,
} from '../types';
import { generateUUID } from './codeGenerator';
import { calculateAmount } from './currency';

const SYNC_QUEUE_KEY = 'myret_sync_queue';
const LAST_SYNC_KEY = 'myret_last_synced_at';

type SyncListener = (state: SyncState) => void;

class SyncService {
  private queue: SyncQueueItem[] = [];
  private isProcessing = false;
  private listeners: Set<SyncListener> = new Set();
  private tablesReady: boolean | null = null; // null = unverified, true = ready, false = missing
  private state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
    tablesReady: false,
  };

  constructor() {
    this.loadQueue();
    this.state.lastSyncedAt = this.getStorageItem(LAST_SYNC_KEY);
    this.updateState({ pendingCount: this.queue.length });

    // Listen to network status changes
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncService] Device is back online. Triggering synchronization...');
        this.processQueue();
      });

      window.addEventListener('offline', () => {
        console.log('[SyncService] Device went offline.');
        this.updateState({ status: 'offline' });
      });
    }
  }

  private getStorageItem(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private setStorageItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('[SyncService] LocalStorage set error:', e);
    }
  }

  // --- State & Subscription ---
  getState(): SyncState {
    return { ...this.state };
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<SyncState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => {
      try {
        listener(this.getState());
      } catch (err) {
        console.error('[SyncService] Error in listener callback:', err);
      }
    });
  }

  private isDemoId(id?: string): boolean {
    if (!id || typeof id !== 'string') return false;
    if (id.startsWith('ret-demo-') || id.startsWith('dr-demo-') || id.startsWith('supp-demo-')) {
      return true;
    }
    const localRet = storage.getRetirementById(id);
    return Boolean(localRet?.isDemo);
  }

  // --- Queue Storage & Persistence ---
  private loadQueue(): void {
    try {
      const stored = this.getStorageItem(SYNC_QUEUE_KEY);
      const parsed: SyncQueueItem[] = stored ? JSON.parse(stored) : [];
      // Purge any accidentally queued demo operations from persisted storage
      const filtered = parsed.filter((item) => {
        if (item.payload?.isDemo || item.payload?.retirement?.isDemo) return false;
        if (this.isDemoId(item.entityId) || this.isDemoId(item.retirementId)) return false;
        if (
          this.isDemoId(item.payload?.retirementA) ||
          this.isDemoId(item.payload?.retirementB)
        ) {
          return false;
        }
        return true;
      });
      this.queue = filtered;
      if (filtered.length !== parsed.length) {
        this.setStorageItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
      }
    } catch (e) {
      console.error('[SyncService] Failed to load sync queue from localStorage:', e);
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      this.setStorageItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
      this.updateState({ pendingCount: this.queue.length });
    } catch (e) {
      console.error('[SyncService] Failed to save sync queue to localStorage:', e);
    }
  }

  getQueue(): SyncQueueItem[] {
    return [...this.queue];
  }

  // --- Enqueue Operations ---
  enqueue(type: SyncOperationType, entityId: string, payload: any, retirementId?: string): void {
    // If demo sample, never enqueue for cloud sync
    if (
      payload?.isDemo ||
      payload?.retirement?.isDemo ||
      this.isDemoId(entityId) ||
      this.isDemoId(retirementId) ||
      this.isDemoId(payload?.retirementA) ||
      this.isDemoId(payload?.retirementB)
    ) {
      return;
    }

    // Purge superseded pending upserts when an entity or parent retirement is deleted
    if (type === 'DELETE_RETIREMENT') {
      const existingDeleteItem = this.queue.find(
        (item) => item.type === 'DELETE_RETIREMENT' && item.entityId === entityId
      );
      const localRet = storage.getRetirementById(entityId);
      const queuedHasSynced = this.queue.some(
        (item) =>
          (item.entityId === entityId || item.retirementId === entityId) &&
          (item.payload?.hasSyncedToCloud === true ||
            (item.type === 'UPSERT_RETIREMENT' &&
              item.payload &&
              storage.hasRetirementEverSynced(item.payload)))
      );
      const hasPositiveSyncEvidence =
        payload?.hasSyncedToCloud === true ||
        existingDeleteItem?.payload?.hasSyncedToCloud === true ||
        queuedHasSynced ||
        (localRet ? storage.hasRetirementEverSynced(localRet) : false);

      const hasSyncedToCloud = hasPositiveSyncEvidence
        ? true
        : existingDeleteItem?.payload?.hasSyncedToCloud === false ||
            payload?.hasSyncedToCloud === false ||
            Boolean(localRet)
          ? false
          : true;

      payload = {
        ...(existingDeleteItem?.payload || {}),
        ...payload,
        hasSyncedToCloud,
      };
      this.purgeQueueForRetirement(entityId, true);
    } else if (type === 'REMOVE_IMPORTED_RETIREMENT') {
      const existingRemoveItem = this.queue.find(
        (item) => item.type === 'REMOVE_IMPORTED_RETIREMENT' && item.entityId === entityId
      );
      const localRet = storage.getRetirementById(entityId);
      const queuedHasSynced = this.queue.some(
        (item) =>
          (item.entityId === entityId || item.retirementId === entityId) &&
          (item.payload?.hasSyncedToCloud === true ||
            (item.type === 'UPSERT_RETIREMENT' &&
              item.payload &&
              storage.hasRetirementEverSynced(item.payload)))
      );
      const hasPositiveSyncEvidence =
        payload?.hasSyncedToCloud === true ||
        existingRemoveItem?.payload?.hasSyncedToCloud === true ||
        queuedHasSynced ||
        (localRet ? storage.hasRetirementEverSynced(localRet) : false);

      const hasSyncedToCloud = hasPositiveSyncEvidence
        ? true
        : existingRemoveItem?.payload?.hasSyncedToCloud === false ||
            payload?.hasSyncedToCloud === false ||
            Boolean(localRet)
          ? false
          : true;

      payload = {
        ...(existingRemoveItem?.payload || {}),
        ...payload,
        hasSyncedToCloud,
      };
      this.purgeQueueForRetirement(entityId, false, true);
    } else if (type === 'DELETE_DAILY_RECORD') {
      this.queue = this.queue.filter(
        (item) => !(item.type === 'UPSERT_DAILY_RECORD' && item.entityId === entityId)
      );
    } else if (type === 'DELETE_SUPPLEMENTARY') {
      this.queue = this.queue.filter(
        (item) => !(item.type === 'UPSERT_SUPPLEMENTARY' && item.entityId === entityId)
      );
    }

    // Coalesce updates to the same entity in pending queue
    const existingIndex = this.queue.findIndex(
      (item) =>
        item.entityId === entityId &&
        item.type === type &&
        (item.status === 'pending' ||
          type === 'DELETE_RETIREMENT' ||
          type === 'REMOVE_IMPORTED_RETIREMENT')
    );

    if (existingIndex >= 0) {
      const existingItem = this.queue[existingIndex];
      const mergedPayload =
        type === 'DELETE_RETIREMENT' || type === 'REMOVE_IMPORTED_RETIREMENT'
          ? {
              ...(existingItem.payload || {}),
              ...payload,
              hasSyncedToCloud: payload.hasSyncedToCloud,
            }
          : payload;
      const updatedItem: SyncQueueItem = {
        ...existingItem,
        payload: mergedPayload,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };
      delete updatedItem.lastError;
      this.queue[existingIndex] = updatedItem;
    } else {
      const item: SyncQueueItem = {
        id: generateUUID(),
        type,
        entityId,
        retirementId,
        payload,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        status: 'pending',
      };
      this.queue.push(item);
    }

    this.saveQueue();

    // Trigger processing if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.processQueue();
    } else {
      this.updateState({ status: 'offline' });
    }
  }

  private purgeQueueForRetirement(
    retirementId: string,
    keepDeleteOperation: boolean = false,
    keepRemoveImportedOperation: boolean = false
  ): void {
    const beforeLen = this.queue.length;
    this.queue = this.queue.filter((item) => {
      if (keepDeleteOperation && item.type === 'DELETE_RETIREMENT' && item.entityId === retirementId) {
        return true;
      }
      if (
        keepRemoveImportedOperation &&
        item.type === 'REMOVE_IMPORTED_RETIREMENT' &&
        item.entityId === retirementId
      ) {
        return true;
      }
      if (item.entityId === retirementId || item.retirementId === retirementId) {
        return false;
      }
      if (
        (item.type === 'CONNECT_RETIREMENTS' || item.type === 'DISCONNECT_RETIREMENTS') &&
        (item.payload?.retirementA === retirementId || item.payload?.retirementB === retirementId)
      ) {
        return false;
      }
      return true;
    });
    if (this.queue.length !== beforeLen) {
      this.saveQueue();
    }
  }

  private isPermanentlyDeletedError(err: any): boolean {
    if (!err) return false;
    const code = String(err.code || '');
    const msg = String(err.message || err).toLowerCase();
    return (
      code === 'P0002' ||
      msg.includes('permanently_deleted') ||
      msg.includes('permanently deleted')
    );
  }

  private async isRetirementTombstonedInCloud(
    retirementId: string,
    throwOnError: boolean = false
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('deleted_retirements')
        .select('retirement_id')
        .eq('retirement_id', retirementId)
        .maybeSingle();
      if (error) {
        if (throwOnError) {
          throw error;
        }
        return false;
      }
      return Boolean(data?.retirement_id);
    } catch (err) {
      if (throwOnError) {
        throw err;
      }
      // Ignore if deleted_retirements table is not yet deployed
      return false;
    }
  }

  private async checkAndPurgeIfParentRetirementDeleted(retirementId: string): Promise<boolean> {
    if (!retirementId) return false;
    try {
      if (await this.isRetirementTombstonedInCloud(retirementId)) {
        storage.permanentlyDelete(retirementId, true);
        this.purgeQueueForRetirement(retirementId, false);
        return true;
      }
      const localRet = storage.getRetirementById(retirementId);
      if (localRet && !storage.hasRetirementEverSynced(localRet)) {
        return false;
      }
      const { data, error } = await supabase
        .from('retirements')
        .select('id')
        .eq('id', retirementId)
        .maybeSingle();
      if (!error && !data) {
        storage.permanentlyDelete(retirementId, true);
        this.purgeQueueForRetirement(retirementId, false);
        return true;
      }
    } catch {
      // Ignore network/transient errors
    }
    return false;
  }

  // --- Check if Database Tables are Deployed ---
  async checkTablesReady(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;

    try {
      const { error } = await supabase.from('retirements').select('id').limit(1);
      if (error) {
        // PostgREST 42P01 or PGRST204 = table not found
        if (
          error.code === '42P01' ||
          error.code === 'PGRST204' ||
          error.message.toLowerCase().includes('schema cache') ||
          error.message.toLowerCase().includes('does not exist')
        ) {
          this.tablesReady = false;
          this.updateState({
            tablesReady: false,
            status: 'tables_missing',
            lastError:
              'Cloud database tables have not been created yet in Supabase. Run the provided migration in your Supabase SQL Editor.',
          });
          return false;
        }
      }

      this.tablesReady = true;
      this.updateState({ tablesReady: true });
      return true;
    } catch (err) {
      console.warn('[SyncService] Error checking tables readiness:', err);
      this.tablesReady = false;
      return false;
    }
  }

  // --- Queue Processor (Push Changes to Supabase) ---
  async processQueue(): Promise<void> {
    // Ensure any newly expired trash items are converted into DELETE_RETIREMENT operations
    storage.runExpiredTrashCleanup();

    if (this.isProcessing) return;
    if (!isSupabaseConfigured) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState({ status: 'offline' });
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      // User not signed in; pending queue items will remain until sign in
      return;
    }

    // Check if tables exist
    const ready = await this.checkTablesReady();
    if (!ready) {
      return;
    }

    if (this.queue.length === 0) {
      this.updateState({ status: 'synced', pendingCount: 0, lastError: null });
      return;
    }

    this.isProcessing = true;
    this.updateState({ status: 'syncing', lastError: null });

    const failedItems: SyncQueueItem[] = [];

    // Process queue items in sequence
    for (const item of [...this.queue]) {
      // Skip if a preceding operation already purged this item from the queue
      if (!this.queue.some((q) => q.id === item.id)) {
        continue;
      }
      try {
        await this.executeQueueItem(item, session.user.id);
        // Successful: remove from active queue
        this.queue = this.queue.filter((q) => q.id !== item.id);
        this.saveQueue();
      } catch (err: any) {
        console.error(`[SyncService] Failed operation ${item.type} for entity ${item.entityId}:`, err);
        const errMsg = err?.message || String(err);

        // Check if database error is missing tables
        if (
          errMsg.toLowerCase().includes('schema cache') ||
          errMsg.toLowerCase().includes('does not exist')
        ) {
          this.tablesReady = false;
          this.updateState({
            tablesReady: false,
            status: 'tables_missing',
            lastError: 'Cloud database tables not found. Please apply the migration in Supabase SQL editor.',
          });
          this.isProcessing = false;
          return;
        }

        item.retryCount += 1;
        item.lastError = errMsg;
        item.status = item.retryCount >= 5 ? 'failed' : 'pending';
        failedItems.push(item);
        this.saveQueue();
      }
    }

    this.isProcessing = false;
    const now = new Date().toISOString();
    this.state.lastSyncedAt = now;
    this.setStorageItem(LAST_SYNC_KEY, now);

    if (this.queue.length === 0) {
      this.updateState({
        status: 'synced',
        pendingCount: 0,
        lastSyncedAt: now,
        lastError: null,
      });
    } else {
      this.updateState({
        status: failedItems.some((i) => i.status === 'failed') ? 'error' : 'pending',
        pendingCount: this.queue.length,
        lastSyncedAt: now,
        lastError: failedItems[0]?.lastError || 'Some records could not be synchronized.',
      });
    }
  }

  // --- Execute Single Sync Queue Item ---
  private async executeQueueItem(item: SyncQueueItem, currentUserId: string): Promise<void> {
    switch (item.type) {
      case 'UPSERT_RETIREMENT': {
        const ret: Retirement = item.payload;
        // Verify user is owner before modifying cloud retirement
        if (ret.ownerId && ret.ownerId !== currentUserId) {
          console.warn('[SyncService] Skip upload: user is not owner of retirement', ret.id);
          return;
        }

        // Check cloud tombstone first
        if (await this.isRetirementTombstonedInCloud(ret.id)) {
          console.info('[SyncService] Retirement is tombstoned in cloud; purging stale local copy:', ret.id);
          storage.permanentlyDelete(ret.id, true);
          this.purgeQueueForRetirement(ret.id, false);
          return;
        }

        const localCopy = storage.getRetirementById(ret.id);
        const hasEverSynced =
          storage.hasRetirementEverSynced(ret) ||
          (localCopy ? storage.hasRetirementEverSynced(localCopy) : false);

        if (hasEverSynced) {
          // Previously synced retirement: MUST update existing row only, never re-insert a deleted row
          const { data: updatedRows, error: retError } = await supabase
            .from('retirements')
            .update({
              code: ret.code,
              title: ret.title,
              project: ret.project,
              owner_id: ret.ownerId || currentUserId,
              status: ret.status || 'active',
              deleted_at: ret.deletedAt || null,
              updated_at: ret.updatedAt || new Date().toISOString(),
            })
            .eq('id', ret.id)
            .select('id');

          if (retError) {
            if (this.isPermanentlyDeletedError(retError)) {
              storage.permanentlyDelete(ret.id, true);
              this.purgeQueueForRetirement(ret.id, false);
              return;
            }
            throw retError;
          }

          if (!updatedRows || updatedRows.length === 0) {
            console.info(
              '[SyncService] Previously synced retirement was permanently deleted in cloud; purging local copy:',
              ret.id
            );
            storage.permanentlyDelete(ret.id, true);
            this.purgeQueueForRetirement(ret.id, false);
            return;
          }
        } else {
          // Brand-new local retirement never synced to cloud yet
          const { error: retError } = await supabase.from('retirements').upsert({
            id: ret.id,
            code: ret.code,
            title: ret.title,
            project: ret.project,
            owner_id: ret.ownerId || currentUserId,
            status: ret.status || 'active',
            deleted_at: ret.deletedAt || null,
            updated_at: ret.updatedAt || new Date().toISOString(),
          });

          if (retError) {
            if (this.isPermanentlyDeletedError(retError)) {
              storage.permanentlyDelete(ret.id, true);
              this.purgeQueueForRetirement(ret.id, false);
              return;
            }
            throw retError;
          }
        }

        // Upsert collaborator reviewer access if owner
        if (ret.access && ret.access.length > 0) {
          for (const acc of ret.access) {
            // Collaborators (excluding owner)
            if (acc.userId && acc.userId !== (ret.ownerId || currentUserId) && acc.role === 'REVIEWER') {
              try {
                await supabase.from('retirement_access').upsert(
                  {
                    retirement_id: ret.id,
                    user_id: acc.userId,
                    role: 'REVIEWER',
                    granted_at: acc.grantedAt || new Date().toISOString(),
                  },
                  { onConflict: 'retirement_id, user_id' }
                );
              } catch (accErr) {
                console.warn('[SyncService] Could not sync access for user:', acc.userEmail, accErr);
              }
            }
          }
        }

        // Mark local retirement as synced
        storage.markRetirementSynced(ret.id);
        break;
      }

      case 'DELETE_RETIREMENT': {
        const { id } = item.payload || {};
        if (!id) {
          throw new Error('Cannot delete retirement: missing retirement ID in queue payload');
        }

        const localRet = storage.getRetirementById(id);
        const hasEverSynced =
          item.payload?.hasSyncedToCloud === true ||
          (localRet
            ? storage.hasRetirementEverSynced(localRet)
            : item.payload?.hasSyncedToCloud !== false);

        const { data: deletedRows, error } = await supabase
          .from('retirements')
          .delete()
          .eq('id', id)
          .select('id');
        if (error) {
          throw error;
        }

        const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
        if (deletedCount === 0 && hasEverSynced) {
          const isTombstoned = await this.isRetirementTombstonedInCloud(id, true);
          if (!isTombstoned) {
            throw new Error(
              `Permanent deletion of retirement ${id} could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).`
            );
          }
        }

        this.purgeQueueForRetirement(id, true);
        break;
      }

      case 'REMOVE_IMPORTED_RETIREMENT': {
        const { id } = item.payload || {};
        if (!id) {
          throw new Error('Cannot remove imported retirement: missing retirement ID in queue payload');
        }

        const localRet = storage.getRetirementById(id);
        const hasEverSynced =
          item.payload?.hasSyncedToCloud === true ||
          (localRet
            ? storage.hasRetirementEverSynced(localRet)
            : item.payload?.hasSyncedToCloud !== false);

        const { data: deletedRows, error } = await supabase
          .from('retirement_access')
          .delete()
          .eq('retirement_id', id)
          .eq('user_id', currentUserId)
          .select('id');

        if (error) {
          throw error;
        }

        const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
        if (deletedCount === 0 && hasEverSynced) {
          const { data: remainingRow, error: checkErr } = await supabase
            .from('retirement_access')
            .select('id')
            .eq('retirement_id', id)
            .eq('user_id', currentUserId)
            .maybeSingle();

          if (checkErr) {
            throw checkErr;
          }
          if (remainingRow?.id) {
            throw new Error(
              `Removal of imported retirement ${id} could not be confirmed in cloud (access row still exists; check RLS self-removal policy on retirement_access).`
            );
          }
        }

        this.purgeQueueForRetirement(id, false, true);
        break;
      }

      case 'UPSERT_DAILY_RECORD': {
        const record: DailyRecord = item.payload;
        const normalizedDate = normalizeDate(record.date);
        let authoritativeRecordId = record.id;
        let authoritativeUpdatedAt = record.updatedAt || new Date().toISOString();

        // Try RPC upsert_daily_record_hierarchy first
        let rpcSuccess = false;
        let rpcExecuted = false;

        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('upsert_daily_record_hierarchy', {
            p_record_id: record.id,
            p_retirement_id: record.retirementId,
            p_record_date: normalizedDate,
            p_categories: record.categories,
            p_expected_version: null,
            p_client_updated_at: authoritativeUpdatedAt,
          });

          if (!rpcError) {
            rpcExecuted = true;
            if (rpcData && (rpcData.success === true || rpcData.daily_record_id)) {
              rpcSuccess = true;
              if (rpcData.daily_record_id) {
                authoritativeRecordId = String(rpcData.daily_record_id);
              }
              if (rpcData.updated_at) {
                authoritativeUpdatedAt = String(rpcData.updated_at);
              }
            } else {
              throw new Error(rpcData?.error || 'RPC upsert_daily_record_hierarchy returned unsuccessful response');
            }
          } else {
            // Check if error is specifically missing RPC in schema cache
            const isMissingFn =
              rpcError.code === 'PGRST202' ||
              rpcError.code === '42883' ||
              rpcError.message.toLowerCase().includes('schema cache') ||
              rpcError.message.toLowerCase().includes('could not find the function');

            if (!isMissingFn) {
              if (await this.checkAndPurgeIfParentRetirementDeleted(record.retirementId)) {
                return;
              }
              // Real database / permission / constraint failure:
              // Must NOT swallow or bypass checks with fallback. Throw immediately so operation stays pending in queue.
              throw rpcError;
            }
            console.warn('[SyncService] RPC not found in schema cache, using direct queries fallback');
          }
        } catch (rpcEx: any) {
          if (rpcExecuted || (rpcEx?.code && rpcEx.code !== 'PGRST202' && rpcEx.code !== '42883')) {
            if (await this.checkAndPurgeIfParentRetirementDeleted(record.retirementId)) {
              return;
            }
            throw rpcEx;
          }
          console.warn('[SyncService] RPC call threw, attempting direct table fallback:', rpcEx);
        }

        // Direct table fallback ONLY if RPC function was missing from database
        if (!rpcSuccess) {
          // 1. Recalculate daily total for consistency
          const computedTotal = (record.categories || []).reduce((sum, cat) => {
            const catSub = (cat.items || []).reduce((s, it) => {
              const q = Number(it.quantity) || 0;
              const r = Number(it.rate) || 0;
              return s + (q > 0 && r > 0 ? calculateAmount(q, r) : (Number(it.amount) || 0));
            }, 0);
            return sum + catSub;
          }, 0);

          // 2. Upsert daily_record row
          const { data: upsertedRow, error: dError } = await supabase
            .from('daily_records')
            .upsert(
              {
                id: record.id,
                retirement_id: record.retirementId,
                record_date: normalizedDate,
                daily_total: computedTotal,
                updated_at: authoritativeUpdatedAt,
              },
              { onConflict: 'retirement_id, record_date' }
            )
            .select('id, updated_at')
            .single();

          if (dError) {
            if (await this.checkAndPurgeIfParentRetirementDeleted(record.retirementId)) {
              return;
            }
            throw dError;
          }
          authoritativeRecordId = upsertedRow?.id || record.id;
          if (upsertedRow?.updated_at) {
            authoritativeUpdatedAt = String(upsertedRow.updated_at);
          }

          // 3. Clear old categories and re-insert categories & items
          const { error: delCatError } = await supabase
            .from('categories')
            .delete()
            .eq('daily_record_id', authoritativeRecordId);
          if (delCatError) throw delCatError;

          if (record.categories && record.categories.length > 0) {
            for (let cIdx = 0; cIdx < record.categories.length; cIdx++) {
              const cat = record.categories[cIdx];
              const catId = cat.id || generateUUID();
              const catSub = (cat.items || []).reduce((s, it) => {
                const q = Number(it.quantity) || 0;
                const r = Number(it.rate) || 0;
                return s + (q > 0 && r > 0 ? calculateAmount(q, r) : (Number(it.amount) || 0));
              }, 0);

              const { error: cError } = await supabase.from('categories').insert({
                id: catId,
                daily_record_id: authoritativeRecordId,
                name: cat.name.trim() || 'General',
                subtotal: catSub,
                sort_order: cIdx,
              });
              if (cError) throw cError;

              if (cat.items && cat.items.length > 0) {
                // Generated column 'amount' is strictly omitted from inserts
                const validItems = cat.items
                  .filter((it) => it.description && it.description.trim().length > 0)
                  .map((it) => ({
                    id: it.id || generateUUID(),
                    category_id: catId,
                    description: it.description.trim(),
                    quantity: Math.max(0, Number(it.quantity) || 0),
                    rate: Math.max(0, Number(it.rate) || 0),
                    created_at: new Date().toISOString(),
                  }));

                if (validItems.length > 0) {
                  const { error: itError } = await supabase.from('expense_items').insert(validItems);
                  if (itError) throw itError;
                }
              }
            }
          }
        }

        // Reconcile any queued operations referencing the old or authoritative daily record ID
        for (const qItem of this.queue) {
          if (
            qItem.id !== item.id &&
            (qItem.entityId === record.id || qItem.entityId === authoritativeRecordId)
          ) {
            qItem.entityId = authoritativeRecordId;
            if (qItem.payload && typeof qItem.payload === 'object' && 'id' in qItem.payload) {
              qItem.payload = {
                ...qItem.payload,
                id: authoritativeRecordId,
                baseUpdatedAt: authoritativeUpdatedAt,
              };
            }
          }
        }

        // Mark local daily record synced ONLY upon complete success, updating to authoritative cloud ID and updated_at
        storage.markDailyRecordSynced(record.id, authoritativeRecordId, authoritativeUpdatedAt);
        break;
      }

      case 'DELETE_DAILY_RECORD': {
        const { id, retirementId, date } = item.payload || {};
        if (id) {
          const { error } = await supabase.from('daily_records').delete().eq('id', id);
          if (error && error.code !== 'PGRST116') throw error;
        }
        if (retirementId && date) {
          const { error: keyErr } = await supabase
            .from('daily_records')
            .delete()
            .eq('retirement_id', retirementId)
            .eq('record_date', normalizeDate(date));
          if (keyErr && keyErr.code !== 'PGRST116') throw keyErr;
        }
        break;
      }

      case 'UPSERT_SUPPLEMENTARY': {
        const entry: SupplementaryEntry = item.payload;
        const { error } = await supabase.from('supplementary_entries').upsert({
          id: entry.id,
          retirement_id: entry.retirementId,
          description: entry.description,
          amount: entry.amount,
          created_at: entry.createdAt || new Date().toISOString(),
        });
        if (error) {
          if (await this.checkAndPurgeIfParentRetirementDeleted(entry.retirementId)) {
            return;
          }
          throw error;
        }
        storage.markSupplementarySynced(entry.id);
        break;
      }

      case 'DELETE_SUPPLEMENTARY': {
        const { id } = item.payload;
        const { error } = await supabase.from('supplementary_entries').delete().eq('id', id);
        if (error && error.code !== 'PGRST116') throw error;
        break;
      }

      case 'CONNECT_RETIREMENTS': {
        const { retirementA, retirementB } = item.payload || {};
        if (
          !retirementA ||
          !retirementB ||
          retirementA === retirementB ||
          this.isDemoId(retirementA) ||
          this.isDemoId(retirementB)
        ) {
          return;
        }

        // Try RPC connect_retirements
        let connected = false;
        try {
          const { error: rpcErr } = await supabase.rpc('connect_retirements', {
            p_retirement_a: retirementA,
            p_retirement_b: retirementB,
          });
          if (!rpcErr) connected = true;
        } catch {
          // Fallback to direct insertion
        }

        if (!connected) {
          const first = retirementA < retirementB ? retirementA : retirementB;
          const second = retirementA < retirementB ? retirementB : retirementA;
          const { error: insErr } = await supabase.from('connected_retirements').upsert(
            {
              retirement_id: first,
              connected_id: second,
            },
            { onConflict: 'retirement_id, connected_id' }
          );
          if (insErr) throw insErr;
        }
        break;
      }

      case 'DISCONNECT_RETIREMENTS': {
        const { retirementA, retirementB } = item.payload || {};
        if (
          !retirementA ||
          !retirementB ||
          this.isDemoId(retirementA) ||
          this.isDemoId(retirementB)
        ) {
          return;
        }
        const first = retirementA < retirementB ? retirementA : retirementB;
        const second = retirementA < retirementB ? retirementB : retirementA;
        const { error } = await supabase
          .from('connected_retirements')
          .delete()
          .match({ retirement_id: first, connected_id: second });
        if (error && error.code !== 'PGRST116') throw error;
        break;
      }

      case 'CLAIM_RETIREMENT': {
        const { code } = item.payload;
        await this.claimRetirementByCode(code);
        break;
      }

      case 'UPDATE_PROFILE': {
        const profile: UserProfile = item.payload;
        const { error } = await supabase.from('profiles').upsert({
          id: profile.id,
          name: profile.name,
          designation: profile.designation,
          phone: profile.phone,
          email: profile.email,
          placement: profile.placement,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        break;
      }

      default:
        console.warn('[SyncService] Unknown sync operation:', item.type);
    }
  }

  // --- Pull Data from Cloud (Hydration & Bi-directional Sync) ---
  async pullFromCloud(): Promise<boolean> {
    // Ensure any expired trash items are queued for cloud deletion before pulling
    storage.runExpiredTrashCleanup();

    if (!isSupabaseConfigured) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return false;

    const ready = await this.checkTablesReady();
    if (!ready) return false;

    try {
      const currentUserId = session.user.id;

      // Track entities with pending deletions in the local queue so pullFromCloud never resurrects them
      const pendingDeleteRetIds = new Set(
        this.queue
          .filter(
            (q) => q.type === 'DELETE_RETIREMENT' || q.type === 'REMOVE_IMPORTED_RETIREMENT'
          )
          .map((q) => q.entityId)
      );
      const pendingDeleteDailyIds = new Set(
        this.queue.filter((q) => q.type === 'DELETE_DAILY_RECORD').map((q) => q.entityId)
      );
      const pendingDeleteDailyKeys = new Set(
        this.queue
          .filter((q) => q.type === 'DELETE_DAILY_RECORD' && q.payload?.retirementId && q.payload?.date)
          .map((q) => `${q.payload.retirementId}::${normalizeDate(q.payload.date)}`)
      );
      const pendingDeleteSuppIds = new Set(
        this.queue.filter((q) => q.type === 'DELETE_SUPPLEMENTARY').map((q) => q.entityId)
      );

      // 0. Fetch durable permanent-deletion tombstones from deleted_retirements (if table is deployed)
      const deletedRetIdSet = new Set<string>(pendingDeleteRetIds);
      try {
        const { data: deletedRows, error: delErr } = await supabase
          .from('deleted_retirements')
          .select('retirement_id');
        if (!delErr && Array.isArray(deletedRows)) {
          for (const row of deletedRows) {
            if (row?.retirement_id) {
              deletedRetIdSet.add(String(row.retirement_id));
            }
          }
        }
      } catch {
        // Ignore if deleted_retirements table is not yet deployed
      }

      // 1. Fetch accessible retirements: Owned OR in retirement_access
      const { data: ownedRetirements, error: ownedErr } = await supabase
        .from('retirements')
        .select('*')
        .eq('owner_id', currentUserId);

      if (ownedErr) throw ownedErr;

      const { data: sharedAccess, error: accessErr } = await supabase
        .from('retirement_access')
        .select('retirement_id, role, granted_at')
        .eq('user_id', currentUserId);

      if (accessErr) throw accessErr;

      const sharedIds = (sharedAccess || []).map((a) => a.retirement_id);
      let sharedRetirements: any[] = [];
      if (sharedIds.length > 0) {
        const { data: sData, error: sErr } = await supabase
          .from('retirements')
          .select('*')
          .in('id', sharedIds);
        if (!sErr && sData) {
          sharedRetirements = sData;
        }
      }

      const allCloudRetirements = [...(ownedRetirements || []), ...sharedRetirements].filter(
        (r) => !deletedRetIdSet.has(r.id)
      );
      const allCloudIds = allCloudRetirements.map((r) => r.id);

      let connections: any[] = [];
      let cloudDailyRecords: any[] = [];
      let dailyRecordIds: string[] = [];
      let cloudCategories: any[] = [];
      let cloudItems: any[] = [];
      let cloudSupplementary: any[] = [];
      let profileMap = new Map<string, any>();
      let allAccessRows: any[] = [];

      if (allCloudIds.length > 0) {
        // 2. Fetch associated connected retirements
        const { data: connData } = await supabase
          .from('connected_retirements')
          .select('retirement_id, connected_id');
        connections = connData || [];

        // 3. Fetch all daily records for accessible retirements
        const { data: rawCloudDailyRecords } = await supabase
          .from('daily_records')
          .select('*')
          .in('retirement_id', allCloudIds);

        cloudDailyRecords = (rawCloudDailyRecords || []).filter(
          (d) =>
            !pendingDeleteDailyIds.has(d.id) &&
            !pendingDeleteDailyKeys.has(`${d.retirement_id}::${normalizeDate(d.record_date)}`)
        );

        dailyRecordIds = cloudDailyRecords.map((d) => d.id);

        // 4. Fetch categories & expense items
        if (dailyRecordIds.length > 0) {
          const { data: cats } = await supabase
            .from('categories')
            .select('*')
            .in('daily_record_id', dailyRecordIds)
            .order('sort_order', { ascending: true });
          cloudCategories = cats || [];

          const catIds = cloudCategories.map((c) => c.id);
          if (catIds.length > 0) {
            const { data: items } = await supabase
              .from('expense_items')
              .select('*')
              .in('category_id', catIds);
            cloudItems = items || [];
          }
        }

        // 5. Fetch supplementary entries
        const { data: rawCloudSupplementary } = await supabase
          .from('supplementary_entries')
          .select('*')
          .in('retirement_id', allCloudIds);

        cloudSupplementary = (rawCloudSupplementary || []).filter(
          (s) => !pendingDeleteSuppIds.has(s.id)
        );

        // 6. Fetch profiles for owners
        const ownerIds = Array.from(new Set(allCloudRetirements.map((r) => r.owner_id)));
        const { data: ownerProfiles } = await supabase
          .from('profiles')
          .select('id, name, designation, phone')
          .in('id', ownerIds);
        profileMap = new Map((ownerProfiles || []).map((p) => [p.id, p]));

        // 7. Fetch full access lists for each retirement
        const { data: accessRowsData } = await supabase
          .from('retirement_access')
          .select('retirement_id, user_id, role, granted_at')
          .in('retirement_id', allCloudIds);
        allAccessRows = accessRowsData || [];
      }

      // Build hydrated retirements
      const hydratedRetirements: Retirement[] = allCloudRetirements.map((raw) => {
        const ownerProf = profileMap.get(raw.owner_id);
        const retConnections = (connections || [])
          .filter((c) => c.retirement_id === raw.id || c.connected_id === raw.id)
          .map((c) => (c.retirement_id === raw.id ? c.connected_id : c.retirement_id));

        const retAccess = (allAccessRows || [])
          .filter((a) => a.retirement_id === raw.id)
          .map((a) => ({
            userId: a.user_id,
            userEmail: '', // Cloud RLS hides private emails of other users
            userName: a.user_id === currentUserId ? 'You' : 'Collaborator',
            role: a.role as 'REVIEWER',
            grantedAt: a.granted_at,
          }));

        return {
          id: raw.id,
          code: raw.code,
          title: raw.title,
          project: raw.project,
          ownerId: raw.owner_id,
          ownerName: ownerProf?.name || (raw.owner_id === currentUserId ? 'You' : 'Site Engineer'),
          ownerDesignation: ownerProf?.designation || 'Site Construction Engineer',
          ownerPhone: ownerProf?.phone || '',
          createdAt: raw.created_at,
          updatedAt: raw.updated_at,
          status: raw.status as 'active' | 'in_trash',
          deletedAt: raw.deleted_at || undefined,
          access: retAccess,
          connectedRetirementIds: retConnections,
          hasSyncedToCloud: true,
          syncStatus: 'synced',
        };
      });

      // Assemble structured daily records
      const assembledDailyRecords: DailyRecord[] = cloudDailyRecords.map((dr) => {
        const recCategories = cloudCategories
          .filter((c) => c.daily_record_id === dr.id)
          .map((c) => {
            const catItems = cloudItems
              .filter((it) => it.category_id === c.id)
              .map((it) => ({
                id: it.id,
                description: it.description,
                quantity: Number(it.quantity) || 0,
                rate: Number(it.rate) || 0,
                amount: Number(it.amount) || (Number(it.quantity) || 0) * (Number(it.rate) || 0),
              }));

            return {
              id: c.id,
              name: c.name,
              items: catItems,
              subtotal: Number(c.subtotal) || catItems.reduce((s, i) => s + i.amount, 0),
            };
          });

        return {
          id: dr.id,
          retirementId: dr.retirement_id,
          date: dr.record_date,
          categories: recCategories,
          dailyTotal: Number(dr.daily_total) || 0,
          createdAt: dr.created_at,
          updatedAt: dr.updated_at,
          baseUpdatedAt: dr.updated_at,
          hasSyncedToCloud: true,
          syncStatus: 'synced',
        };
      });

      // Assemble supplementary entries
      const assembledSupplementary: SupplementaryEntry[] = cloudSupplementary.map((s) => ({
        id: s.id,
        retirementId: s.retirement_id,
        description: s.description,
        amount: Number(s.amount) || 0,
        createdAt: s.created_at,
        hasSyncedToCloud: true,
        syncStatus: 'synced',
      }));

      // Merge into local storage, pruning cloud-deleted records while preserving unsynced offline creations
      const { reconciledDailyRecords, prunedRetirementIds } = storage.mergeCloudData(
        hydratedRetirements,
        assembledDailyRecords,
        assembledSupplementary,
        deletedRetIdSet
      );

      // Purge any queued operations referencing retirements that were pruned as permanently deleted
      if (prunedRetirementIds.length > 0) {
        for (const prunedId of prunedRetirementIds) {
          if (!pendingDeleteRetIds.has(prunedId)) {
            this.purgeQueueForRetirement(prunedId, false);
          }
        }
      }

      // Update any existing queue items whose local daily-record ID or payload was reconciled with cloud
      if (reconciledDailyRecords.length > 0) {
        let queueModified = false;
        for (const { oldId, newId, record } of reconciledDailyRecords) {
          let matchedExistingQueueItem = false;
          const keptQueue: SyncQueueItem[] = [];

          for (const qItem of this.queue) {
            if (
              qItem.type === 'UPSERT_DAILY_RECORD' &&
              qItem.status === 'pending' &&
              (qItem.entityId === oldId || qItem.entityId === newId)
            ) {
              if (!matchedExistingQueueItem) {
                qItem.entityId = newId;
                qItem.payload = record;
                qItem.createdAt = new Date().toISOString();
                keptQueue.push(qItem);
                matchedExistingQueueItem = true;
              }
              queueModified = true;
            } else {
              keptQueue.push(qItem);
            }
          }
          this.queue = keptQueue;
        }
        if (queueModified) {
          this.saveQueue();
        }
      }

      const cloudRetIdSet = new Set(allCloudIds);
      const cloudDailyRecIdSet = new Set(dailyRecordIds);
      const cloudSuppIdSet = new Set(cloudSupplementary.map((s) => s.id));

      // Run local-to-cloud initial sync ONLY for genuinely un-synced user-owned local records
      await this.runInitialMigration(
        session.user,
        cloudRetIdSet,
        cloudDailyRecIdSet,
        cloudSuppIdSet,
        deletedRetIdSet
      );

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        this.processQueue();
      }

      return true;
    } catch (err: any) {
      console.error('[SyncService] Pull from cloud error:', err);
      this.updateState({ lastError: err?.message || 'Failed to pull cloud updates' });
      return false;
    }
  }

  // --- Initial Local-to-Cloud Migration ---
  // Safely migrates existing local records created before cloud connection to user account
  async runInitialMigration(
    user: { id: string; email?: string },
    cloudRetirementIds?: Set<string>,
    cloudDailyRecordIds?: Set<string>,
    cloudSupplementaryIds?: Set<string>,
    deletedRetirementIds?: Set<string>
  ): Promise<void> {
    // Positively reconcile legacy user-owned retirements in local storage without claiming other users' or reviewer records
    const eligibleRetirements = storage.reconcileLegacyOwnedRetirements(user);

    for (const ret of eligibleRetirements) {
      if (ret.isDemo) continue;
      if (ret.ownerId !== user.id) continue;
      if (deletedRetirementIds?.has(ret.id)) continue;

      const isKnownInCloud = cloudRetirementIds ? cloudRetirementIds.has(ret.id) : false;
      const hasRetSynced = storage.hasRetirementEverSynced(ret);

      // Upload ONLY if:
      // 1. It is a brand-new / pre-cloud legacy retirement that has NEVER synced to the cloud (!isKnownInCloud && !hasRetSynced), OR
      // 2. It is a known cloud retirement with a pending local modification (isKnownInCloud && ret.syncStatus === 'pending').
      // Never re-upload a previously synced retirement that is now absent from the cloud!
      const needsUpload =
        (!isKnownInCloud && !hasRetSynced) ||
        (isKnownInCloud && ret.syncStatus === 'pending');

      if (!isKnownInCloud && hasRetSynced) {
        continue;
      }

      if (needsUpload) {
        const alreadyQueued = this.queue.some(
          (q) => q.type === 'UPSERT_RETIREMENT' && q.entityId === ret.id && q.status === 'pending'
        );
        if (!alreadyQueued) {
          this.enqueue('UPSERT_RETIREMENT', ret.id, ret);
        }
      }

      // Check daily records belonging to this retirement
      const records = storage.getDailyRecords(ret.id);
      for (const rec of records) {
        const isRecInCloud = cloudDailyRecordIds ? cloudDailyRecordIds.has(rec.id) : false;
        const hasRecSynced = storage.hasDailyRecordEverSynced(rec);
        const recNeedsUpload =
          (!isRecInCloud && !hasRecSynced) ||
          (isRecInCloud && rec.syncStatus === 'pending');

        if (recNeedsUpload) {
          const alreadyQueued = this.queue.some(
            (q) => q.type === 'UPSERT_DAILY_RECORD' && q.entityId === rec.id && q.status === 'pending'
          );
          if (!alreadyQueued) {
            this.enqueue('UPSERT_DAILY_RECORD', rec.id, rec, ret.id);
          }
        }
      }

      // Check supplementary entries belonging to this retirement
      const supplementary = storage.getSupplementaryEntries(ret.id);
      for (const supp of supplementary) {
        const isSuppInCloud = cloudSupplementaryIds ? cloudSupplementaryIds.has(supp.id) : false;
        const hasSuppSynced = storage.hasSupplementaryEverSynced(supp);
        const suppNeedsUpload =
          (!isSuppInCloud && !hasSuppSynced) ||
          (isSuppInCloud && supp.syncStatus === 'pending');

        if (suppNeedsUpload) {
          const alreadyQueued = this.queue.some(
            (q) => q.type === 'UPSERT_SUPPLEMENTARY' && q.entityId === supp.id && q.status === 'pending'
          );
          if (!alreadyQueued) {
            this.enqueue('UPSERT_SUPPLEMENTARY', supp.id, supp, ret.id);
          }
        }
      }
    }
  }

  // --- Claim Shared Retirement by Code ---
  async claimRetirementByCode(code: string): Promise<Retirement | null> {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) throw new Error('Please enter a valid retirement code');

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      throw new Error('You must be signed in to access a shared retirement');
    }

    const currentUserId = session.user.id;

    // Check if tables exist
    const ready = await this.checkTablesReady();
    if (!ready) {
      // Offline fallback: check local storage
      const local = storage.getRetirementByCode(cleanCode);
      if (local) return local;
      throw new Error(
        'Cloud database tables are not ready yet. Please ensure the migration is executed in Supabase.'
      );
    }

    // 1. Try calling claim_retirement_by_code RPC
    let retId: string | null = null;
    try {
      const { data: rpcRetId, error: rpcErr } = await supabase.rpc('claim_retirement_by_code', {
        p_code: cleanCode,
      });

      if (!rpcErr && rpcRetId) {
        retId = rpcRetId;
      }
    } catch {
      // Fallback
    }

    // 2. Direct fallback if RPC is not available
    if (!retId) {
      const { data: retRow, error: findErr } = await supabase
        .from('retirements')
        .select('id, owner_id, status')
        .eq('code', cleanCode)
        .single();

      if (findErr || !retRow) {
        throw new Error(`No retirement found with code "${cleanCode}". Please verify with the site owner.`);
      }

      if (retRow.status === 'in_trash') {
        throw new Error('This retirement is currently in the Trash and cannot be accessed.');
      }

      retId = retRow.id;

      // If user is not the owner, insert reviewer access
      if (retRow.owner_id !== currentUserId) {
        await supabase.from('retirement_access').upsert(
          {
            retirement_id: retId,
            user_id: currentUserId,
            role: 'REVIEWER',
            granted_at: new Date().toISOString(),
          },
          { onConflict: 'retirement_id, user_id' }
        );
      }
    }

    // 3. Clear any pending or failed REMOVE_IMPORTED_RETIREMENT queue items for this retirement so pullFromCloud can hydrate it
    if (retId) {
      const beforeLen = this.queue.length;
      this.queue = this.queue.filter(
        (q) => !(q.type === 'REMOVE_IMPORTED_RETIREMENT' && q.entityId === retId)
      );
      if (this.queue.length !== beforeLen) {
        this.saveQueue();
      }
    }

    // 4. Pull latest cloud data so the claimed retirement is in local storage immediately
    await this.pullFromCloud();
    const result = storage.getRetirementById(retId!);
    return result || null;
  }
}

export const syncService = new SyncService();

// Connect storage mutations to sync queue
setSyncTrigger((type, entityId, payload, retirementId) => {
  syncService.enqueue(type, entityId, payload, retirementId);
});
