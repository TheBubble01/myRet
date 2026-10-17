# Final Read-Only Verification: Initial Synchronization, Expired Trash Deletion, and Cloud Merge

**Project**: myRet — Site Expenditure & Retirement PWA  
**Date**: October 16, 2026  
**Verification Scope**: Read-only verification of current implementations in `src/utils/syncService.ts` and `src/utils/storage.ts`

---

## 1. INITIAL SYNCHRONIZATION

### Current Code in `src/utils/syncService.ts`

**Calls inside `pullFromCloud()` (lines 614–624 and 761–775):**
```typescript
      const allCloudRetirements = [...(ownedRetirements || []), ...sharedRetirements];
      const allCloudIds = allCloudRetirements.map((r) => r.id);

      if (allCloudIds.length === 0) {
        // Run initial local-to-cloud migration if user has existing local retirements
        await this.runInitialMigration(session.user, new Set(), new Set(), new Set());
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          this.processQueue();
        }
        return true;
      }
```
```typescript
      // Merge into local storage preserving locally pending changes
      storage.mergeCloudData(hydratedRetirements, assembledDailyRecords, assembledSupplementary);

      const cloudRetIdSet = new Set(allCloudIds);
      const cloudDailyRecIdSet = new Set(dailyRecordIds);
      const cloudSuppIdSet = new Set((cloudSupplementary || []).map((s) => s.id));

      // Run local-to-cloud initial sync for any un-synced user-owned local records
      await this.runInitialMigration(session.user, cloudRetIdSet, cloudDailyRecIdSet, cloudSuppIdSet);

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        this.processQueue();
      }

      return true;
```

**Complete `runInitialMigration()` implementation (lines 785–853):**
```typescript
  async runInitialMigration(
    user: { id: string; email?: string },
    cloudRetirementIds?: Set<string>,
    cloudDailyRecordIds?: Set<string>,
    cloudSupplementaryIds?: Set<string>
  ): Promise<void> {
    const localRetirements = storage.getRetirements(true); // include trash

    // Identify local retirements owned by current user (or created locally without ownerId), excluding demo
    const eligibleRetirements = localRetirements.filter((r) => {
      if (r.isDemo) return false;
      // Do not upload another user's records
      if (r.ownerId && r.ownerId !== user.id) return false;
      return true;
    });

    for (const ret of eligibleRetirements) {
      // Assign ownerId if missing locally
      if (!ret.ownerId) {
        ret.ownerId = user.id;
        storage.saveRetirement(ret, true);
      }

      // If record is not known in cloud OR is marked pending, it needs upload
      const isKnownInCloud = cloudRetirementIds ? cloudRetirementIds.has(ret.id) : false;
      const needsUpload = !isKnownInCloud || ret.syncStatus === 'pending';

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
        const recNeedsUpload = !isRecInCloud || rec.syncStatus === 'pending';

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
        const suppNeedsUpload = !isSuppInCloud || supp.syncStatus === 'pending';

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
```

### Verification of Behaviour & Concrete Risks

1. **Legacy local retirements without `ownerId` (Skipped-Upload / Incorrect-Ownership Risk)**:
   * **Verified Code Behaviour**: `runInitialMigration()` fetches local records via `storage.getRetirements(true)` (`src/utils/storage.ts` lines 172–188), which filters `myret_retirements` as follows:
     ```typescript
     const accessible = all.filter((r) => {
       if (r.ownerId === currentUser.id) return true;
       return r.access.some((a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase());
     });
     ```
   * **Concrete Issue 1A (Skipped Upload for Legacy Records)**:
     * If a legacy local retirement has no `ownerId` (`undefined`/`""`) **and** its `access` array does not contain the signed-in user's `id` or `email`, `storage.getRetirements(true)` filters it out before `runInitialMigration()` is ever reached. Thus, `if (!ret.ownerId)` at line 803 is unreachable for any retirement that does not already have the user in `r.access`.
     * Furthermore, if a pre-existing local retirement was created under an offline/local user ID (`r.ownerId = "old-local-id"`) with the user's matching email in `r.access`, `storage.getRetirements(true)` returns it, **but** line 797 (`if (r.ownerId && r.ownerId !== user.id) return false;`) treats `"old-local-id"` as belonging to a different user and skips uploading it.
   * **Concrete Issue 1B (Incorrect Ownership on Shared Record Missing `ownerId`)**:
     * Conversely, if a shared retirement where the current user is only in `r.access` with `role === 'REVIEWER'` ever lacked `r.ownerId`, lines 803–805 (`if (!ret.ownerId) { ret.ownerId = user.id; ... }`) would claim ownership for the reviewer without checking `r.access.some(a => a.role === 'OWNER' && ...)`.

2. **Exclusion of records belonging to other users**:
   * **Verified Code Behaviour**: Records with `r.ownerId && r.ownerId !== user.id` are excluded by line 797 in `runInitialMigration()` and guarded again in `executeQueueItem()` (`UPSERT_RETIREMENT`, line 288). Demo records (`r.isDemo`) are excluded at line 795 and in `enqueue()` (line 120).

3. **Association of daily records and supplementary entries with their retirement**:
   * **Verified Code Behaviour**: For each eligible retirement `ret`, `storage.getDailyRecords(ret.id)` filters `myret_daily_records` by `r.retirementId === ret.id`, and `storage.getSupplementaryEntries(ret.id)` filters `myret_supplementary` by `e.retirementId === ret.id`. Each child record is queued with `ret.id` as `retirementId`.

---

## 2. EXPIRED TRASH DELETION

### Current Code in `src/utils/storage.ts` and `src/utils/syncService.ts`

**Complete `cleanupExpiredTrash()` implementation (`src/utils/storage.ts`, lines 305–346):**
```typescript
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
```

**`DELETE_RETIREMENT` processing implementation (`src/utils/syncService.ts`, lines 334–341):**
```typescript
      case 'DELETE_RETIREMENT': {
        const { id } = item.payload;
        const { error } = await supabase.from('retirements').delete().eq('id', id);
        if (error && error.code !== 'PGRST116') {
          throw error;
        }
        break;
      }
```

### Verification of Behaviour & Concrete Risks

1. **Database Foreign-Key Cascade Behaviour**:
   * **Verified Code Behaviour**: In `supabase/migrations/20261016000100_myret_cloud_persistence.sql`, deleting a row from `public.retirements` cascades automatically in PostgreSQL (`ON DELETE CASCADE`) to `retirement_access` (line 68), `daily_records` (line 78) $\rightarrow$ `categories` (line 92) $\rightarrow$ `expense_items` (line 103), `supplementary_entries` (line 114), and `connected_retirements` (lines 123–124).

2. **Concrete Issue 2A (Initialization Order — `cleanupExpiredTrash()` Runs Before `globalSyncTrigger` Is Registered)**:
   * **Verified Code Behaviour**:
     * In `src/utils/storage.ts`, `this.cleanupExpiredTrash()` is called inside `StorageService.constructor()` (line 76) when `export const storage = new StorageService();` (line 899) executes at module load time.
     * In `src/utils/syncService.ts`, `import { storage, setSyncTrigger } from './storage'` (line 2) evaluates `storage.ts` **before** `setSyncTrigger(...)` is called at line 883 of `syncService.ts`.
   * **Impact**: When the application loads, `cleanupExpiredTrash()` runs inside the `StorageService` constructor while `globalSyncTrigger` is still `null`. Any trashed retirement that expired while the app was closed is deleted from `localStorage` during constructor initialization **without** queuing `DELETE_RETIREMENT`. Because it was not queued for deletion, the next `pullFromCloud()` downloads the expired retirement from Supabase again and re-inserts it into `localStorage` (until a subsequent `getRetirements()` or `getTrashRetirements()` call runs after `setSyncTrigger` has been registered).

3. **Concrete Issue 2B (Stale Queue Items Not Purged on Retirement Deletion)**:
   * **Verified Code Behaviour**: Neither `cleanupExpiredTrash()` nor `permanentlyDelete()` removes pre-existing pending queue items (`UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, `UPSERT_SUPPLEMENTARY`) for the deleted retirement from `this.queue`. If an `UPSERT_DAILY_RECORD` for that retirement is already in `this.queue` and fails/retries after `DELETE_RETIREMENT` executes, it will fail with a foreign-key violation (`23503`) until it exhausts 5 retries and transitions the sync state to `'error'`.

---

## 3. CLOUD MERGE

### Current Code in `src/utils/storage.ts`

**Complete `mergeCloudData()` implementation (`src/utils/storage.ts`, lines 791–896):**
```typescript
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
```

### Verification of Behaviour & Concrete Risks

1. **Same `(retirementId, date)` with Different Local and Cloud IDs (Data-Loss Risk)**:
   * **Verified Code Behaviour**: `mergeCloudData()` does **not** merge categories or expense items between `existingLocal` and `cloudRec` (it never calls `this.mergeRecordCategories()`). Instead, it performs a whole-record replacement based on `existingLocal.syncStatus === 'pending'`:
     * **If `existingLocal.syncStatus === 'pending'`**: `mergedRecords.push(existingLocal)` keeps only `existingLocal` and discards `cloudRec`. When `UPSERT_DAILY_RECORD` subsequently runs, `upsert_daily_record_hierarchy` executes `DELETE FROM public.categories WHERE daily_record_id = v_daily_record_id;` (migration line 612) and replaces the cloud record's categories/items with `existingLocal.categories`. Any expense items that existed in `cloudRec` (e.g., created on another device for the same date) are permanently overwritten.
     * **If `existingLocal.syncStatus !== 'pending'`**: `mergedRecords.push(cloudRec)` overwrites `existingLocal` with `cloudRec`, discarding any local categories/items on that record that were not in `cloudRec`.

2. **Local ID vs. Cloud ID Desynchronization After Same-Date Upsert**:
   * **Verified Code Behaviour**: When a local daily record (`id: local-id`) is uploaded for a `(retirement_id, record_date)` that already exists in Supabase with `id: cloud-id`, `upsert_daily_record_hierarchy` preserves `v_existing_id` (`cloud-id`) in the database and returns `'daily_record_id': v_daily_record_id` in its JSONB response (migration lines 591–592, 672). However, `UPSERT_DAILY_RECORD` in `syncService.ts` (line 470) only calls `storage.markDailyRecordSynced(record.id)` and does not update the local record's `id` to `rpcData.daily_record_id`.
   * **Impact**: In `pullFromCloud()`, `cloudDailyRecIdSet` only contains `cloud-id`. Immediately after `mergeCloudData()` keeps a pending `existingLocal` (`local-id`), `runInitialMigration()` checks `cloudDailyRecordIds.has(rec.id)` (`false` for `local-id`). Furthermore, if the user deletes that daily record locally before the next cloud pull, `DELETE_DAILY_RECORD` deletes `.eq('id', 'local-id')`, which does not match `cloud-id` in Supabase.

3. **Duplicate Entry When Editing a Record's Date Locally**:
   * **Verified Code Behaviour**: In `mergeCloudData()` (lines 844–861), `localRecById.get(cloudRec.id) || localRecByKey.get(key)` does not check whether `existingLocal.id` is already in `processedLocalIds`. If a user changed an existing synced record's date locally from `D1` to `D2` (while `D2` also exists in the cloud under another ID), `existingLocal` matches `cloudRec1` by ID (`D1`) and matches `cloudRec2` by key (`D2`), pushing `existingLocal` into `mergedRecords` twice.

---

## RECOMMENDATION

**DO NOT PROCEED YET**

While the SQL migration file itself (`public/myret_cloud_persistence_migration.sql`) is safe and properly scoped to the 8 myRet tables, the client synchronization code in `src/utils/storage.ts` and `src/utils/syncService.ts` has three concrete issues verified above that should be resolved before live synchronization testing:
1. `cleanupExpiredTrash()` runs in the `StorageService` constructor before `setSyncTrigger` is registered, pruning expired trash locally on app load without queuing `DELETE_RETIREMENT`.
2. Legacy local retirements without a matching current `user.id` in `ownerId` (or excluded by `storage.getRetirements(true)`) are skipped during `runInitialMigration()`.
3. `mergeCloudData()` and `UPSERT_DAILY_RECORD` do not reconcile differing local vs. cloud daily-record UUIDs or merge expense items via `mergeRecordCategories()` when both local and cloud records exist for the same `(retirementId, date)`.
