# Final Pre-Deployment Read-Only Verification Report: `DELETE_RETIREMENT` Correction

---

## 1. Inspected Components & Exact References

1. **`src/utils/syncService.ts`**
   - Queue restoration/loading & persistence: `loadQueue()` (lines `95–103`), `saveQueue()` (lines `105–112`)
   - Enqueue & sync-history capture: `enqueue()` (lines `119–196`)
   - Queue cleanup for deleted retirements: `purgeQueueForRetirement()` (lines `198–218`)
   - Cloud tombstone lookup helper: `isRetirementTombstonedInCloud()` (lines `231–245`)
   - Parent retirement deletion check: `checkAndPurgeIfParentRetirementDeleted()` (lines `247–273`)
   - Queue execution loop: `processQueue()` (lines `311–404`)
   - Single operation executor: `executeQueueItem()` (lines `407–548`, with `case 'DELETE_RETIREMENT'` at lines `514–548`)
   - Full bidirectional sync & pull: `fullSync()` (lines `1025–1312`)

2. **`src/utils/storage.ts`**
   - Retirement persistence & sync-flag initialization: `reconcileLegacyOwnedRetirements()` (lines `270–332`), `saveRetirement()` (lines `358–392`), `moveToTrash()` (lines `394–416`), `restoreFromTrash()` (lines `418–440`)
   - Permanent deletion & trash expiry: `permanentlyDelete()` (lines `442–491`), `runExpiredTrashCleanup()` (lines `493–495`), `cleanupExpiredTrash()` (lines `497–558`)
   - Sync-history evaluation: `hasRetirementEverSynced()` (lines `1059–1089`), `hasDailyRecordEverSynced()` (lines `1091–1095`), `hasSupplementaryEverSynced()` (lines `1098–1103`)
   - Sync-status marking: `markRetirementSynced()` (lines `1105–1113`), `markDailyRecordSynced()` (lines `1115–1132`), `markSupplementarySynced()` (lines `1134–1142`)
   - Cloud merge & pruning: `mergeCloudData()` (lines `1369–1624`)

3. **`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` & `public/myret_fix_permanent_deletion_resurrection.sql`**
   - Tombstone table & RLS/grants: lines `13–35`
   - `record_deleted_retirement_tombstone()` & `AFTER DELETE` trigger `on_retirement_permanently_deleted`: lines `37–55`
   - `prevent_deleted_retirement_resurrection()` & `BEFORE INSERT OR UPDATE` trigger `before_retirement_upsert_check_deleted`: lines `57–78`
   - RLS helper functions & grants: lines `81–123`

---

## 2. Case-by-Case Verification Findings

### Case A: Previously synchronized retirement permanently deleted while online
- **Status:** **PASS**
- **Evidence:**
  1. `storage.permanentlyDelete()` (`src/utils/storage.ts:446–457`) invokes `globalSyncTrigger('DELETE_RETIREMENT', id, { id, code: target.code, ownerId: target.ownerId }, id)` **before** deleting the local retirement and child records (`lines 459–488`).
  2. `syncService.enqueue()` (`src/utils/syncService.ts:126–148`) reads `localRet = storage.getRetirementById(entityId)` while it still exists in `localStorage`, evaluates `storage.hasRetirementEverSynced(localRet)` (`true`), sets `payload.hasSyncedToCloud = true`, purges superseded queue items for that retirement (`purgeQueueForRetirement(entityId, true)`), saves the queue, and triggers `this.processQueue()` (`lines 191–192`).
  3. `executeQueueItem()` (`src/utils/syncService.ts:527–531`) runs:
     ```ts
     const { data: deletedRows, error } = await supabase
       .from('retirements')
       .delete()
       .eq('id', id)
       .select('id');
     ```
  4. In PostgreSQL (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql:37–55`), the `AFTER DELETE ON public.retirements` trigger `on_retirement_permanently_deleted` executes `public.record_deleted_retirement_tombstone()` synchronously inside the **same database transaction** as the `DELETE` statement. If the trigger fails for any reason, the transaction rolls back and PostgREST returns an error.
  5. When the `DELETE` succeeds and affects 1 row (`deletedCount === 1`), `executeQueueItem()` completes normally (`lines 536–547`), and `processQueue()` removes the queue item only at `src/utils/syncService.ts:355–356` after `await this.executeQueueItem(...)` resolves.

---

### Case B: Previously synchronized retirement whose local record was already removed before queued deletion executes
- **Status:** **PASS**
- **Evidence:**
  1. Both `storage.permanentlyDelete()` (`src/utils/storage.ts:451–456`) and `storage.cleanupExpiredTrash()` (`src/utils/storage.ts:513–518`) call `globalSyncTrigger('DELETE_RETIREMENT', ...)` **before** removing the retirement or its child records from `localStorage`.
  2. During `enqueue()` (`src/utils/syncService.ts:127–147`), `hasSyncedToCloud` is computed from `localRet` and any queued items and persisted directly into `item.payload.hasSyncedToCloud` (`true`), then written to `localStorage` via `saveQueue()` (`line 188`).
  3. Later, when `executeQueueItem()` runs (`src/utils/syncService.ts:520–525`), even though `storage.getRetirementById(id)` returns `undefined`, `item.payload?.hasSyncedToCloud === true` evaluates to `true` immediately on `line 522`, preserving the retirement's true sync history.

---

### Case C: Offline-created retirement that was never synchronized and is permanently deleted before reaching Supabase
- **Status:** **PASS**
- **Evidence:**
  1. When a retirement is created locally and saved via `storage.saveRetirement()` (`src/utils/storage.ts:362–374`), `retirement.hasSyncedToCloud` is initialized to `false` and `retirement.syncStatus` is `'pending'`. Its `access` array includes an `'OWNER'` entry, and none of its child records have synced. Thus `storage.hasRetirementEverSynced(localRet)` (`src/utils/storage.ts:1059–1089`) returns `false`.
  2. When permanently deleted before syncing, `enqueue('DELETE_RETIREMENT', ...)` (`src/utils/syncService.ts:127–148`) inspects both `this.queue` (`queuedHasSynced` is `false`) and `localRet` (`storage.hasRetirementEverSynced(localRet)` is `false`), sets `payload.hasSyncedToCloud = false`, and calls `this.purgeQueueForRetirement(entityId, true)` (`line 148`), which purges the pending `UPSERT_RETIREMENT` and any pending child `UPSERT_DAILY_RECORD` / `UPSERT_SUPPLEMENTARY` items from `this.queue` so they never reach Supabase.
  3. When `DELETE_RETIREMENT` executes (`src/utils/syncService.ts:520–547`), `hasEverSynced` is `false` (`lines 521–525`). The `.delete().eq('id', id).select('id')` statement affects `0` rows in `public.retirements`, so the `AFTER DELETE` trigger does **not** fire and no tombstone row is created in `public.deleted_retirements`. Because `hasEverSynced` is `false`, `if (deletedCount === 0 && hasEverSynced)` (`line 537`) is skipped and the queue item is cleanly removed without creating any cloud records.

---

### Case D: Legacy queued `DELETE_RETIREMENT` item that does not contain `hasSyncedToCloud`
- **Status:** **PASS**
- **Evidence:**
  1. In `executeQueueItem()` (`src/utils/syncService.ts:520–525`):
     ```ts
     const localRet = storage.getRetirementById(id);
     const hasEverSynced =
       item.payload?.hasSyncedToCloud === true ||
       (localRet
         ? storage.hasRetirementEverSynced(localRet)
         : item.payload?.hasSyncedToCloud !== false);
     ```
  2. If a legacy queued `DELETE_RETIREMENT` item was persisted in `localStorage` before `hasSyncedToCloud` existed (`item.payload.hasSyncedToCloud === undefined`):
     - If `localRet` is already removed (`undefined`), `item.payload?.hasSyncedToCloud !== false` evaluates to `undefined !== false`, which is **`true`**.
     - If `localRet` still exists, `storage.hasRetirementEverSynced(localRet)` (`src/utils/storage.ts:1059–1089`) checks `syncStatus === 'synced'`, absence of a local `OWNER` access row, or any synced child daily/supplementary record.
  3. Therefore, legacy queued `DELETE_RETIREMENT` items default safely to `hasEverSynced = true` and are never misclassified as unsynced local-only records.

---

### Case E: Another device already deleted the retirement and its tombstone exists
- **Status:** **PASS**
- **Evidence:**
  1. Device B executes `.from('retirements').delete().eq('id', id).select('id')` (`src/utils/syncService.ts:527–531`). Because Device A already deleted the row, PostgREST returns `data: []` (`deletedCount === 0`) and `error: null`.
  2. Because `deletedCount === 0 && hasEverSynced` is `true` (`line 537`), Device B calls `await this.isRetirementTombstonedInCloud(id)` (`line 538`).
  3. `isRetirementTombstonedInCloud(id)` (`src/utils/syncService.ts:231–245`) queries `public.deleted_retirements` for `retirement_id = id`. Because `public.deleted_retirements` grants `SELECT` to `authenticated` (`USING (true)` at `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql:29–34`), the tombstone created by Device A's `AFTER DELETE` trigger is returned (`data.retirement_id` is truthy), `isRetirementTombstonedInCloud` returns `true`, and `executeQueueItem()` completes without throwing, allowing `processQueue()` (`line 355`) to remove the queue item idempotently.

---

### Case F: The retirement is invisible because of RLS, and no tombstone is visible
- **Status:** **PASS**
- **Evidence:**
  1. When RLS hides the target row in `public.retirements` (e.g., non-owner or stale session), `.delete().eq('id', id).select('id')` affects `0` rows and returns `data: []`, `error: null`.
  2. For any previously synchronized retirement (`hasEverSynced === true`), `deletedCount === 0 && hasEverSynced` (`src/utils/syncService.ts:537`) triggers `isRetirementTombstonedInCloud(id)`.
  3. Since the retirement was not actually deleted, no tombstone exists in `public.deleted_retirements`, so `isRetirementTombstonedInCloud(id)` returns `false`.
  4. Lines `539–543` throw:
     ```ts
     throw new Error(
       `Permanent deletion of retirement ${id} could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).`
     );
     ```
  5. `processQueue()` catches this error (`lines 357–381`), increments `item.retryCount`, records `item.lastError`, and keeps the item in `this.queue` instead of silently discarding it.

---

### Case G: The tombstone lookup fails because of a network, permission, or database error
- **Status:** **PASS (with a minor error-reporting distinction noted)**
- **Evidence:**
  1. `isRetirementTombstonedInCloud(retirementId)` (`src/utils/syncService.ts:231–245`) wraps the `deleted_retirements` query in a `try/catch` and returns `true` only when `if (!error && data?.retirement_id)` (`line 238`); on any network exception, permission error (`42501`), or PostgREST error, it returns `false`.
  2. In `case 'DELETE_RETIREMENT'` (`src/utils/syncService.ts:537–544`), when `isRetirementTombstonedInCloud(id)` returns `false`, `executeQueueItem()` immediately throws `Error('Permanent deletion of retirement ... could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).')`.
  3. **Queue Retryability:** Because `executeQueueItem()` throws whenever `isRetirementTombstonedInCloud(id)` does not confirm a tombstone, `processQueue()` (`lines 357–381`) **always preserves the item in the queue for retry** and never marks it as succeeded.
  4. **Defect / Limitation Found (`src/utils/syncService.ts:231–245` & `538–543`):**
     - Because `isRetirementTombstonedInCloud()` swallows `error` and `catch` exceptions and returns `false` instead of propagating the underlying `error` when called from `DELETE_RETIREMENT`:
       1. The underlying database/network/permission error from `deleted_retirements` is replaced by the generic `"0 rows deleted and no deletion tombstone found"` message in `item.lastError`.
       2. If `public.deleted_retirements` has not yet been deployed in Supabase (e.g., `42P01` / `"does not exist"` / `"schema cache"`), `processQueue()`'s missing-table detector (`lines 362–374`, which checks if `errMsg` includes `'schema cache'` or `'does not exist'`) will **not** recognize that the error was caused by a missing migration table, and will instead increment `item.retryCount` up to 5 times and mark the queue item `'failed'`.
     - If `isRetirementTombstonedInCloud` accepts an option (e.g., `throwOnError: boolean = false`) and throws `error` when called from `DELETE_RETIREMENT`, genuine network, permission, or missing-table errors will be propagated distinctly from a legitimate `{ data: null, error: null }` ("no tombstone found") response.

---

### Case H: The same retirement has older `UPSERT`/`UPDATE` queue entries when permanent deletion is enqueued
- **Status:** **PASS**
- **Evidence:**
  1. In `enqueue()` (`src/utils/syncService.ts:126–148`), when `type === 'DELETE_RETIREMENT'`:
     - **First** (`lines 128–135`), `queuedHasSynced` inspects `this.queue` **before** purging:
       ```ts
       const queuedHasSynced = this.queue.some(
         (item) =>
           (item.entityId === entityId || item.retirementId === entityId) &&
           (item.payload?.hasSyncedToCloud === true ||
             (item.type === 'UPSERT_RETIREMENT' &&
               item.payload &&
               storage.hasRetirementEverSynced(item.payload)))
       );
       ```
     - **Second** (`lines 136–147`), `hasSyncedToCloud` incorporates `queuedHasSynced` and attaches it to `payload`.
     - **Third** (`line 148`), `this.purgeQueueForRetirement(entityId, true)` removes all pending/failed `UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, `DELETE_DAILY_RECORD`, `UPSERT_SUPPLEMENTARY`, `DELETE_SUPPLEMENTARY`, `CONNECT_RETIREMENTS`, and `DISCONNECT_RETIREMENTS` entries referencing `entityId`.
  2. In `processQueue()` (`src/utils/syncService.ts:347–351`), even if `enqueue()` is triggered while `processQueue()` is mid-loop over a shallow copy `[...this.queue]`, line `349` checks `if (!this.queue.some((q) => q.id === item.id)) continue;`, preventing any purged item from executing after the purge.

---

### Case I: Coalescing an existing `DELETE_RETIREMENT` queue entry
- **Status:** **FAIL (Edge-Case Defect Identified)**
- **Evidence (`src/utils/syncService.ts:126–174`):**
  Let's trace what happens if a `DELETE_RETIREMENT` item is already in `this.queue` for `entityId` and `enqueue('DELETE_RETIREMENT', entityId, payload, entityId)` is called a second time after the local retirement record has already been deleted from `localStorage`:
  1. **Scenario 1 — Local-only retirement (`hasSyncedToCloud: false`) re-enqueued after local removal:**
     - Suppose an offline-only retirement (`hasSyncedToCloud: false`) was permanently deleted while offline. The first `enqueue('DELETE_RETIREMENT', ...)` correctly stored `item.payload.hasSyncedToCloud = false` in `this.queue`, and `storage.permanentlyDelete()` removed `localRet` from `localStorage`.
     - If `enqueue('DELETE_RETIREMENT', id, { id })` is invoked again for `id` (without `hasSyncedToCloud` explicitly passed in the caller's `payload`):
       - `localRet` is now `undefined` (`line 127`).
       - `queuedHasSynced` (`lines 128–135`) checks `item.payload?.hasSyncedToCloud === true`, which is `false`.
       - Lines `136–143` compute:
         ```ts
         const hasSyncedToCloud =
           payload?.hasSyncedToCloud === true ||
           queuedHasSynced ||
           (localRet
             ? storage.hasRetirementEverSynced(localRet)
             : payload?.hasSyncedToCloud === false
               ? false
               : true);
         ```
       - Because the new caller `payload` did not specify `hasSyncedToCloud: false` (even though the existing queued `DELETE_RETIREMENT` item in `this.queue` **did** have `item.payload.hasSyncedToCloud === false`), `hasSyncedToCloud` evaluates to **`true`**!
       - Lines `167–173` then overwrite `this.queue[existingIndex].payload` with `hasSyncedToCloud: true`, turning a local-only deletion into one that will fail permanently in the cloud (`0 rows deleted and no deletion tombstone found`).
  2. **Scenario 2 — Retry count not reset and payload fields overwritten when coalescing a `'failed'` `DELETE_RETIREMENT` item:**
     - At lines `160–173`:
       ```ts
       const existingIndex = this.queue.findIndex(
         (item) =>
           item.entityId === entityId &&
           item.type === type &&
           (item.status === 'pending' || type === 'DELETE_RETIREMENT')
       );

       if (existingIndex >= 0) {
         this.queue[existingIndex] = {
           ...this.queue[existingIndex],
           payload,
           status: 'pending',
           createdAt: new Date().toISOString(),
         };
       }
       ```
     - Notice that `this.queue[existingIndex].payload` is replaced with `payload` instead of merging `{ ...this.queue[existingIndex].payload, ...payload, hasSyncedToCloud }`, and `retryCount` is not reset (so if `retryCount` was already `>= 5`, the very next failure immediately marks it `'failed'` again).

---

### Case J: Expired Trash Bin auto-cleanup (`storage.cleanupExpiredTrash`)
- **Status:** **PASS**
- **Evidence:**
  1. `storage.cleanupExpiredTrash()` (`src/utils/storage.ts:497–558`) iterates over all local retirements. When a non-demo retirement has `r.status === 'in_trash'` and `now - deletedTime > TRASH_RETENTION_MS` (`48 hours`, line `506`):
     - Line `512`: It checks `if (globalSyncTrigger)` first. If `globalSyncTrigger` is not yet registered, it leaves the retirement in `surviving` (`line 524`) so it is never removed without enqueueing `DELETE_RETIREMENT`.
     - Lines `513–518`: When `globalSyncTrigger` is registered, it calls `globalSyncTrigger('DELETE_RETIREMENT', r.id, { id: r.id, code: r.code, ownerId: r.ownerId }, r.id)` **before** writing `cleanedSurviving` (`line 537`) or removing child daily records/supplementary entries (`lines 540–556`).
     - Therefore, during `syncService.enqueue()` (`src/utils/syncService.ts:127`), `storage.getRetirementById(entityId)` still finds the retirement and its child records in `localStorage`, accurately computing `hasSyncedToCloud` via `storage.hasRetirementEverSynced(localRet)`.

---

### Case K: Tombstone Security Model & Absence of Direct Client Writes to `public.deleted_retirements`
- **Status:** **PASS**
- **Evidence:**
  1. In `src/utils/syncService.ts`, `deleted_retirements` appears in only two places across the entire codebase:
     - `isRetirementTombstonedInCloud()` (`lines 233–237`): `.from('deleted_retirements').select('retirement_id').eq('retirement_id', retirementId).maybeSingle()` (read-only `SELECT`).
     - `fullSync()` (`lines 1083–1085`): `.from('deleted_retirements').select('retirement_id')` (read-only `SELECT`).
     - There are **zero** client `.insert()`, `.upsert()`, `.update()`, or `.delete()` calls on `deleted_retirements`.
  2. In `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`:
     - Lines `25–26`: Client `INSERT` and `UPDATE` policies on `public.deleted_retirements` are dropped.
     - Lines `28–31`: Only the `SELECT` policy for `authenticated` exists.
     - Lines `33–34`: `REVOKE ALL ON TABLE public.deleted_retirements FROM PUBLIC, anon, authenticated;` followed by `GRANT SELECT ON TABLE public.deleted_retirements TO authenticated;`.
     - Lines `37–50`: `public.record_deleted_retirement_tombstone()` is `SECURITY DEFINER` with `SET search_path = public, pg_temp` and schema-qualified `public.deleted_retirements`.
     - Lines `57–78`: `public.prevent_deleted_retirement_resurrection()` is `SECURITY DEFINER` with `SET search_path = public, pg_temp` and raises `ERRCODE = 'P0002'` (`PERMANENTLY_DELETED`) on `BEFORE INSERT OR UPDATE ON public.retirements` if a tombstone exists.

---

### Case L: Byte-for-Byte Identity of Incremental Migration and Public Deployment Copy
- **Status:** **PASS**
- **Evidence:**
  - `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` (124 lines, 4,688 bytes) and `public/myret_fix_permanent_deletion_resurrection.sql` (124 lines, 4,688 bytes) are byte-for-byte identical.
  - Note: `public/myret_cloud_persistence_migration.sql` is the deployment copy of the baseline migration (`supabase/migrations/20261016000000_cloud_persistence_and_collaboration.sql`), whereas `public/myret_fix_permanent_deletion_resurrection.sql` is the deployment copy of the incremental migration (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`).

---

## 3. Summary Matrix

| Case | Description | Result |
| :--- | :--- | :--- |
| **A** | Online deletion of previously synced retirement creates tombstone in same transaction & removes queue item only after confirmation | **PASS** |
| **B** | Sync history (`hasSyncedToCloud: true`) preserved in queue payload after local record removal | **PASS** |
| **C** | Offline-only unsynced retirement deletion purges queue and does not create cloud records or fail on 0 rows | **PASS** |
| **D** | Legacy queued `DELETE_RETIREMENT` without `hasSyncedToCloud` safely defaults to `hasEverSynced = true` | **PASS** |
| **E** | Repeated deletion after another device deleted the retirement succeeds idempotently via tombstone verification | **PASS** |
| **F** | Zero-row delete caused by RLS invisibility (with no tombstone) throws and preserves queue item for retry | **PASS** |
| **G** | Tombstone lookup failure keeps queue retryable, **but** `isRetirementTombstonedInCloud()` swallows the underlying query error instead of propagating it distinctly | **MINOR DEFECT** |
| **H** | Older `UPSERT`/`UPDATE` queue items are inspected for sync history first and then purged so they cannot resurrect the retirement | **PASS** |
| **I** | Coalescing an existing `DELETE_RETIREMENT` item when `localRet` is already removed can overwrite `hasSyncedToCloud: false` with `true` | **DEFECT** |
| **J** | `cleanupExpiredTrash()` enqueues `DELETE_RETIREMENT` before removing local retirement and child records | **PASS** |
| **K** | Client never writes to `public.deleted_retirements`; `AFTER DELETE` trigger is sole tombstone writer | **PASS** |
| **L** | `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` and `public/myret_fix_permanent_deletion_resurrection.sql` are byte-identical | **PASS** |

---

## 4. Final Recommendation

**DO NOT DEPLOY YET**

Before deployment, apply the two small, targeted fixes in `src/utils/syncService.ts` identified in **Case G** (propagate query errors from `isRetirementTombstonedInCloud(id, true)` during `DELETE_RETIREMENT` rather than converting errors into `false`) and **Case I** (preserve `hasSyncedToCloud: false` and merge existing `payload` fields / reset `retryCount` when coalescing an existing `DELETE_RETIREMENT` queue item).
