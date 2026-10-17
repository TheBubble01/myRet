# myRet — Targeted Investigation of Permanent-Deletion Resurrection (Read-Only Diagnostic Report)

No source files or SQL files were modified, no SQL was executed, and no live database state or user data was altered during this investigation.

---

## Trace of the Six Required Paths

### 1. Permanent Deletion from the Trash Bin
- **UI Entry Point (`src/components/dashboard/TrashView.tsx:32–36`):**
  - Clicking **Delete Permanently** sets `deleteConfirmId = ret.id` (`line 133`).
  - Clicking **Confirm Delete** (`line 119`) invokes `handlePermanentDelete(ret.id)`:
    ```ts
    const handlePermanentDelete = (id: string) => {
      storage.permanentlyDelete(id);
      setDeleteConfirmId(null);
      loadTrash();
    };
    ```
- **Storage Execution & Order of Operations (`src/utils/storage.ts:415–450`):**
  1. Looks up the retirement in `localStorage` (`myret_retirements`) (`lines 416–417`).
  2. **Queues Cloud Deletion First (`lines 420–425`):** If `!skipSync && target && !target.isDemo`, it checks for `globalSyncTrigger` (aborting with `return false` if unavailable) and invokes:
     ```ts
     globalSyncTrigger('DELETE_RETIREMENT', id, { id }, id);
     ```
  3. **Removes Local Data (`lines 427–448`):**
     - Filters `id` out of `myret_retirements` (`lines 427–428`).
     - Filters all daily records with `r.retirementId === id` out of `myret_daily_records` (`lines 431–435`). *(Categories and expense items are stored nested inside `DailyRecord.categories` in `localStorage`, so removing the `DailyRecord` removes them locally.)*
     - Filters all supplementary entries with `s.retirementId === id` out of `myret_supplementary` (`lines 437–441`).
     - Filters all activity logs with `l.retirementId === id` out of `myret_activity_logs` (`lines 443–447`).
     - *Note on local connected retirements:* `permanentlyDelete()` does **not** remove `id` from the `connectedRetirementIds: string[]` array of other surviving retirements in local storage on that device until the next `pullFromCloud()` refreshes `connectedRetirementIds` from Supabase.
- **Expired-Trash Auto-Purge Path (`src/utils/storage.ts:456–504`):**
  - `cleanupExpiredTrash()` runs when `now - deletedTime > TRASH_RETENTION_MS` (48 hours). It follows the same sequence: calls `globalSyncTrigger('DELETE_RETIREMENT', r.id, { id: r.id }, r.id)` first (`line 472`) and then removes the retirement, daily records, supplementary entries, and activity logs from `localStorage` (`lines 481–503`).
- **Cloud Execution (`src/utils/syncService.ts:354–360`):**
  - `DELETE_RETIREMENT` is queued first and then processed asynchronously by `syncService.processQueue()` (`line 171`).
  - `executeQueueItem()` runs a hard SQL `DELETE`:
    ```ts
    case 'DELETE_RETIREMENT': {
      const { id } = item.payload;
      const { error } = await supabase.from('retirements').delete().eq('id', id);
      if (error && error.code !== 'PGRST116') {
        throw error;
      }
      break;
    }
    ```

---

### 2. Synchronization Queue (`src/utils/syncService.ts`)
- **Durable Queue Creation (`lines 119–175`):**
  - `permanentlyDelete()` calls `syncService.enqueue('DELETE_RETIREMENT', id, { id }, id)`.
  - `enqueue()` persists the `SyncQueueItem` to `localStorage` under `myret_sync_queue` via `this.saveQueue()` (`line 167`).
- **Handling of Superseded Queue Items on the Deleting Device (`lines 126–131`):**
  - When `type === 'DELETE_RETIREMENT'`, `enqueue()` purges all pending operations for that retirement **on the current device only**:
    ```ts
    if (type === 'DELETE_RETIREMENT') {
      this.queue = this.queue.filter(
        (item) =>
          item.type === 'DELETE_RETIREMENT' ||
          (item.entityId !== entityId && item.retirementId !== entityId)
      );
    }
    ```
  - *Minor local queue gap:* `CONNECT_RETIREMENTS` and `DISCONNECT_RETIREMENTS` items use `entityId = "${retirementA}_${retirementB}"` and do not pass `retirementId` (`src/components/retirement/ConnectRetirementModal.tsx:69–73, 125–129`), so they are not matched by `item.entityId !== entityId && item.retirementId !== entityId`.
- **Cross-Device Queue Isolation:**
  - Because `myret_sync_queue` lives in each browser's `localStorage`, purging queue items on Device A has no effect on `myret_sync_queue` on Device B or Device C.
  - Once `executeQueueItem()` succeeds on Device A, the `DELETE_RETIREMENT` item is removed from Device A's queue (`src/utils/syncService.ts:253–254`). Neither Device A nor Supabase retains any durable record that `id` was deleted.

---

### 3. Cloud-to-Local Synchronization (`pullFromCloud()`, `mergeCloudData()`, and `runInitialMigration()`)
This path contains the primary defect. When `syncService.pullFromCloud()` (`src/utils/syncService.ts:630–907`) runs on a device that still has a previously synced retirement in `localStorage` which is now absent from Supabase:

1. **Step 1 — `storage.mergeCloudData()` retains all local records absent from Supabase (`src/utils/storage.ts:1261–1412`):**
   - In `mergeCloudData()`, `localMap` is initialized with **all** non-demo local retirements (`line 1269`):
     ```ts
     const localMap = new Map<string, Retirement>(nonDemoLocal.map((r) => [r.id, r]));
     ```
   - After iterating over `cloudRetirements` and deleting matched IDs from `localMap` (`lines 1271–1286`), lines `1288–1291` unconditionally keep **every remaining local retirement**—even when `local.syncStatus === 'synced'`:
     ```ts
     // Keep any remaining local retirements (e.g. created offline)
     localMap.forEach((local) => {
       mergedRetirements.push(local);
     });
     ```
   - The exact same unconditional retention occurs for local `DailyRecord` items absent from `cloudDailyRecords` (`lines 1375–1383`) and local `SupplementaryEntry` items absent from `cloudSupplementary` (`lines 1406–1408`), regardless of whether their `syncStatus` is `'synced'` or `'pending'`.
   - Furthermore, if the deleted retirement was the user's **only** retirement in Supabase, `allCloudIds.length === 0` is true in `pullFromCloud()` (`src/utils/syncService.ts:696`), causing `pullFromCloud()` to skip `mergeCloudData()` altogether (`lines 696–703`) and leave `localStorage` completely untouched.

2. **Step 2 — `syncService.runInitialMigration()` automatically re-queues and re-uploads every owned local record absent from Supabase (`src/utils/syncService.ts:698, 895, 911–969`):**
   - `pullFromCloud()` calls `this.runInitialMigration(session.user, cloudRetIdSet, cloudDailyRecIdSet, cloudSuppIdSet)` on **every** cloud pull (`line 698` when `allCloudIds.length === 0`, and `line 895` when `allCloudIds.length > 0`).
   - Inside `runInitialMigration()` (`lines 918–968`):
     - It calls `storage.reconcileLegacyOwnedRetirements(user)` (`line 918`), which returns all non-demo local retirements in `myret_retirements` where `r.ownerId === user.id` (`src/utils/storage.ts:227–230`).
     - At `src/utils/syncService.ts:925–934`, it checks whether each local retirement is in `cloudRetirementIds`:
       ```ts
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
       ```
     - Because the retirement was hard-deleted from Supabase, `isKnownInCloud` is **`false`**. Even though `ret.syncStatus` is `'synced'`, `!isKnownInCloud` makes `needsUpload === true`!
     - It then repeats the exact same `!isRecInCloud` check for every local `DailyRecord` (`lines 938–950`) and `!isSuppInCloud` check for every local `SupplementaryEntry` (`lines 953–966`), queueing `UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, and `UPSERT_SUPPLEMENTARY` for the deleted retirement and all its child records, and immediately calls `this.processQueue()` (`lines 700, 898`).

---

### 4. Trash Bin and Restoration
- **Moving to Trash (`src/utils/storage.ts:375–393`):**
  - Sets `status = 'in_trash'`, `deletedAt = new Date().toISOString()`, `syncStatus = 'pending'`, and enqueues `UPSERT_RETIREMENT`.
  - In Supabase, `public.retirements` is updated to `status = 'in_trash'` and `deleted_at = <timestamp>` (`src/utils/syncService.ts:320–321`).
- **Restoring from Trash (`src/components/dashboard/TrashView.tsx:26–30` -> `src/utils/storage.ts:395–413`):**
  - `restoreFromTrash(id)` mutates the local retirement in `myret_retirements` to `status = 'active'`, deletes `deletedAt`, sets `syncStatus = 'pending'`, and enqueues `UPSERT_RETIREMENT`.
  - When `executeQueueItem('UPSERT_RETIREMENT')` runs (`src/utils/syncService.ts:314–323`), it executes `supabase.from('retirements').upsert(...)`.
  - Because PostgreSQL `INSERT ... ON CONFLICT (id) DO UPDATE` inserts a new row whenever `id` does not exist in `public.retirements`, restoring a stale local copy on Device B after Device A has permanently deleted the row in Supabase **re-inserts the retirement row into `public.retirements`**.

---

### 5. Multiple Devices and Sessions
- **How the current implementation distinguishes deleted vs. unsynchronized records:**
  - **It does not.** There is no cloud-side deletion tombstone table, no `'deleted'` status enum value on `public.retirements` (the `CHECK` constraint at `supabase/migrations/20261016000100_myret_cloud_persistence.sql:53` only permits `status IN ('active', 'in_trash')`), and no distinction in `mergeCloudData()` or `runInitialMigration()` between:
    1. A legacy local retirement that existed before cloud persistence was enabled (`syncStatus === undefined` or legacy owner ID),
    2. A newly created offline retirement (`syncStatus === 'pending'`), and
    3. A previously synchronized retirement (`syncStatus === 'synced'`) that was subsequently hard-deleted from the cloud by another device.
- **What happens when Device C logs in or reconnects (`src/App.tsx:86–102, 114–128`):**
  - On app load (`getSession()`) or login (`onAuthStateChange()`), `App.tsx` calls `syncService.pullFromCloud()`.
  - Because Device C previously accessed the retirement under the same owner account, Device C still has the retirement (`syncStatus: 'synced'`), its `DailyRecord`s (`syncStatus: 'synced'`), and its `SupplementaryEntry`s (`syncStatus: 'synced'`) in its browser `localStorage`.
  - `pullFromCloud()` sees that those IDs are not in Supabase, keeps them locally in `mergeCloudData()`, and immediately re-uploads all of them via `runInitialMigration()`.

---

### 6. Database Schema and RPCs (`supabase/migrations/20261016000100_myret_cloud_persistence.sql`)
- **Foreign Keys and Cascading Deletes (`lines 47–128`):**
  - `DELETE FROM public.retirements WHERE id = <id>` cascades cleanly across all child tables in PostgreSQL:
    - `public.retirement_access.retirement_id` (`line 68`: `ON DELETE CASCADE`)
    - `public.daily_records.retirement_id` (`line 78`: `ON DELETE CASCADE`)
    - `public.categories.daily_record_id` (`line 92`: `ON DELETE CASCADE`)
    - `public.expense_items.category_id` (`line 103`: `ON DELETE CASCADE`)
    - `public.supplementary_entries.retirement_id` (`line 113`: `ON DELETE CASCADE`)
    - `public.connected_retirements.retirement_id` and `connected_id` (`lines 123–124`: `ON DELETE CASCADE`)
  - Thus, database foreign-key behavior does **not** leave partial orphan rows behind when a retirement is deleted.
- **Why the Database Permits Resurrection:**
  - `public.retirements` has `INSERT` policy `"Owners can insert their retirements"` (`lines 250–252`: `WITH CHECK (owner_id = auth.uid())`) and `UPDATE` policy `"Owners can update their retirements"` (`lines 255–258`).
  - Because `DELETE_RETIREMENT` physically removes the row from `public.retirements` without recording a tombstone, a subsequent `.upsert({ id: ret.id, owner_id: currentUserId, ... })` from any other device owned by the same user satisfies `owner_id = auth.uid()` and inserts the deleted UUID back into `public.retirements`.
- **Secondary Schema/RLS Interaction While a Retirement is in Trash (`status = 'in_trash'`):**
  - In `supabase/migrations/20261016000100_myret_cloud_persistence.sql:149–168`, `public.current_user_has_retirement_access(p_ret_id)` requires `AND status = 'active'` (`line 159`), even when `owner_id = auth.uid()`.
  - While `public.retirements` allows the owner to `SELECT` their own trashed retirement (`line 245`: `owner_id = auth.uid()`), the `SELECT` policies on `public.daily_records` (`line 281`), `public.categories` (`line 297`), `public.expense_items` (`line 328`), and `public.supplementary_entries` (`line 356`) rely solely on `public.current_user_has_retirement_access(retirement_id)`.
  - Consequently, while a retirement has `status = 'in_trash'` in Supabase, `pullFromCloud()` fetches the retirement row (`allCloudIds` includes it) but receives **zero** `daily_records` and **zero** `supplementary_entries` from Supabase for that trashed retirement. `runInitialMigration()` then sees `!isRecInCloud` for the trashed retirement's local daily records and enqueues `UPSERT_DAILY_RECORD` for them, which subsequently fails in `upsert_daily_record_hierarchy` (`line 583`) because `current_user_is_retirement_owner` also requires `status = 'active'` (`line 181`).

---

## Structured Investigation Report

### A. CONFIRMED ROOT CAUSE

The resurrection of permanently deleted retirements is caused by **three confirmed mechanisms** in the client synchronization and storage layer, compounded by the **absence of a cloud-side deletion tombstone (or local `syncStatus === 'synced'` pruning check)**:

1. **Unconditional Retention of Cloud-Deleted Records in `storage.mergeCloudData()` (`src/utils/storage.ts:1288–1291`, `1375–1383`, `1406–1408`):**
   - When `mergeCloudData()` merges `cloudRetirements`, `cloudDailyRecords`, and `cloudSupplementary` with `localStorage`, it retains **every** remaining local record that was not present in the cloud response (`localMap.forEach((local) => mergedRetirements.push(local))`), **even when `local.syncStatus === 'synced'`**.
   - Additionally, if the deleted retirement was the user's last remaining retirement in Supabase (`allCloudIds.length === 0`), `syncService.pullFromCloud()` (`src/utils/syncService.ts:696–703`) returns early **before calling `mergeCloudData()` at all**, leaving all previously synced local records intact in `localStorage`.

2. **Automatic Re-Upload of Missing Cloud Records in `syncService.runInitialMigration()` (`src/utils/syncService.ts:698, 895, 911–969`):**
   - On **every** execution of `pullFromCloud()`, `syncService` invokes `this.runInitialMigration(session.user, cloudRetIdSet, cloudDailyRecIdSet, cloudSuppIdSet)`.
   - Inside `runInitialMigration()`:
     - `storage.reconcileLegacyOwnedRetirements(user)` (`src/utils/storage.ts:216–329`) returns **every** local retirement in `myret_retirements` where `r.ownerId === user.id` (`lines 227–230`), not just un-migrated legacy retirements.
     - Lines `925–926` evaluate:
       ```ts
       const isKnownInCloud = cloudRetirementIds ? cloudRetirementIds.has(ret.id) : false;
       const needsUpload = !isKnownInCloud || ret.syncStatus === 'pending';
       ```
     - Because permanent deletion hard-deleted `ret.id` from `public.retirements`, `isKnownInCloud` is `false`, making `needsUpload = true` even when `ret.syncStatus === 'synced'`.
     - `runInitialMigration()` immediately enqueues `UPSERT_RETIREMENT` (`line 932`), `UPSERT_DAILY_RECORD` (`line 948`), and `UPSERT_SUPPLEMENTARY` (`line 964`), and `pullFromCloud()` calls `this.processQueue()` (`lines 700, 898`), which upserts the deleted retirement and all of its child records back into Supabase.

3. **Unconditional Upsert on Stale Local Trash Restoration (`src/components/dashboard/TrashView.tsx:26–30`, `src/utils/storage.ts:395–413`, `src/utils/syncService.ts:314–323`):**
   - If Device B still displays a retirement in its Trash view (or has not removed it locally after Device A permanently deleted it), clicking **Restore** on Device B calls `storage.restoreFromTrash(id)`, which sets `status = 'active'`, `syncStatus = 'pending'` and enqueues `UPSERT_RETIREMENT`.
   - `executeQueueItem('UPSERT_RETIREMENT')` executes `supabase.from('retirements').upsert(...)`, which re-inserts the deleted row into `public.retirements`.

---

### B. EVENT TIMELINE

#### Scenario 1: Device B Restores After Device A Permanently Deletes (Reproduced Observations 1–4)
1. **Device A** moves Retirement `R` to the Trash Bin (`storage.moveToTrash(R.id)` at `src/utils/storage.ts:375–393`). `UPSERT_RETIREMENT` sets `status = 'in_trash'` in `public.retirements`.
2. **Device B** synchronizes (`pullFromCloud()`). Device B's `localStorage` now holds `R` with `status: 'in_trash'` and `syncStatus: 'synced'`, plus all of `R`'s daily records and supplementary entries from prior syncs.
3. **Device A** opens Trash View and permanently deletes `R` (`TrashView.tsx:32–36` -> `storage.permanentlyDelete(R.id)` at `src/utils/storage.ts:415–450`).
   - Device A removes `R` and its child records from Device A's `localStorage`.
   - Device A executes `DELETE_RETIREMENT` (`src/utils/syncService.ts:354–360`), which deletes `R` from `public.retirements` (cascading to all child tables in Supabase).
4. **Device B** has not removed `R` from its local storage (and even if Device B ran `pullFromCloud()` before clicking Restore, `mergeCloudData()` at `src/utils/storage.ts:1289–1291` would have kept `R` in Device B's `localStorage` with `status: 'in_trash'`).
5. User on **Device B** clicks **Restore** (`TrashView.tsx:26–30`). `storage.restoreFromTrash(R.id)` (`src/utils/storage.ts:395–413`) sets `R.status = 'active'`, `R.syncStatus = 'pending'`, and enqueues `UPSERT_RETIREMENT`.
6. **Device B** runs `processQueue()` (`src/utils/syncService.ts:314–323`), which upserts `R` back into `public.retirements` with `status = 'active'`. On the next `pullFromCloud()`, `runInitialMigration()` on Device B sees that `R`'s daily records and supplementary entries are missing from `cloudDailyRecordIds` / `cloudSuppIdSet` and re-uploads all of them (`src/utils/syncService.ts:938–966`).
7. When **Device A** next runs `pullFromCloud()`, `R` is fetched from `public.retirements` as a "brand new cloud retirement" (`src/utils/storage.ts:1284`) and reappears on Device A's dashboard.

#### Scenario 2: Device C Logs In Later and Resurrects the Retirement Without User Interaction (Reproduced Observations 5–7)
1. **Device A** and **Device B** both permanently delete `R`. `R` and all its child rows are completely absent from Supabase, and removed from `localStorage` on Devices A and B.
2. **Device C** (which had previously logged into the same owner account and synced `R` while `R` was active) opens the app or logs in (`src/App.tsx:86–102` or `114–128`).
3. `App.tsx` automatically triggers `syncService.pullFromCloud()` (`line 99` or `125`).
4. `pullFromCloud()` queries Supabase (`src/utils/syncService.ts:665–694`). `R` is not in `allCloudRetirements` (`allCloudIds` does not contain `R.id`).
5. Inside `pullFromCloud()`:
   - If `allCloudIds.length > 0`, `storage.mergeCloudData()` (`src/utils/storage.ts:1289–1291`, `1376–1383`, `1406–1408`) keeps Device C's local copy of `R` (`syncStatus: 'synced'`), its `DailyRecord`s (`syncStatus: 'synced'`), and its `SupplementaryEntry`s (`syncStatus: 'synced'`).
   - If `allCloudIds.length === 0`, `pullFromCloud()` skips `mergeCloudData()` (`src/utils/syncService.ts:696–703`), also leaving Device C's `localStorage` intact.
6. Still inside `pullFromCloud()`, `this.runInitialMigration(session.user, cloudRetIdSet, cloudDailyRecIdSet, cloudSuppIdSet)` executes (`line 698` or `895`).
7. `runInitialMigration()` (`src/utils/syncService.ts:918–968`) inspects Device C's local `R`:
   - `r.ownerId === user.id` is `true`.
   - `isKnownInCloud` (`cloudRetirementIds.has(R.id)`) is `false`.
   - `needsUpload = !isKnownInCloud || ret.syncStatus === 'pending'` evaluates to **`true`**.
   - It enqueues `UPSERT_RETIREMENT` for `R` (`line 932`), `UPSERT_DAILY_RECORD` for every local daily record of `R` (`line 948`), and `UPSERT_SUPPLEMENTARY` for every local supplementary entry of `R` (`line 964`).
8. `pullFromCloud()` immediately calls `this.processQueue()` (`line 700` or `898`), which pushes `R` and all its child records back into Supabase.
9. Devices A and B subsequently pull `R` from Supabase, causing the permanently deleted retirement to reappear across all devices.

---

### C. QUEUE AND DATA CONSEQUENCES

When resurrection occurs via `runInitialMigration()` on a stale device (or after a stale Trash restore followed by `pullFromCloud()`), it does **not** merely recreate an empty retirement shell—it recreates the **entire retirement data hierarchy** held in that device's `localStorage`:
1. **`public.retirements`:** Recreated via `UPSERT_RETIREMENT` (`src/utils/syncService.ts:314–323, 932`) with its original `id`, `code`, `title`, `project`, `owner_id`, `status`, and `deleted_at`.
2. **`public.retirement_access` (Collaborator Reviewer Access):** Recreated via `UPSERT_RETIREMENT` (`src/utils/syncService.ts:328–347`) for every collaborator entry with `role === 'REVIEWER'` and a known `userId` in `ret.access`.
3. **`public.daily_records`, `public.categories`, and `public.expense_items`:** Recreated in full via `UPSERT_DAILY_RECORD` (`src/utils/syncService.ts:363–520, 938–950`), which calls `upsert_daily_record_hierarchy` for every local `DailyRecord` of that retirement.
4. **`public.supplementary_entries`:** Recreated in full via `UPSERT_SUPPLEMENTARY` (`src/utils/syncService.ts:539–551, 953–966`).
5. **Single-Record Deletion Resurrection (Same Underlying Flaw):** Because `mergeCloudData()` (`src/utils/storage.ts:1375–1383, 1406–1408`) and `runInitialMigration()` (`src/utils/syncService.ts:938–966`) apply the exact same `!isRecInCloud` / `!isSuppInCloud` logic to individual `DailyRecord` and `SupplementaryEntry` rows within an *active* retirement, a `DailyRecord` or `SupplementaryEntry` deleted on Device A (`deleteDailyRecord` / `deleteSupplementaryEntry`) will also be retained and re-uploaded by Device B or Device C on its next `pullFromCloud()` if Device B/C previously synced that record!
6. **`public.connected_retirements`:** Not automatically re-queued by `runInitialMigration()`, unless a stale `CONNECT_RETIREMENTS` operation was still pending in the device's `myret_sync_queue`.

*(Note: A reviewer-only device cannot resurrect a deleted retirement in Supabase because `runInitialMigration()` checks `if (ret.ownerId !== user.id) continue;` at `src/utils/syncService.ts:922`, and `executeQueueItem('UPSERT_RETIREMENT')` checks `ret.ownerId !== currentUserId` at `line 309` in addition to Supabase RLS. However, because of `mergeCloudData()` at `src/utils/storage.ts:1289–1291`, a reviewer's device will still retain a deleted shared retirement as a local ghost copy on its own dashboard.)*

---

### D. EXISTING SAFEGUARDS AND WHERE THEY FAIL

1. **Queue-Before-Delete in `storage.permanentlyDelete()` (`src/utils/storage.ts:420–425`) and `cleanupExpiredTrash()` (`lines 471–475`):**
   - *What it protects:* Ensures the **deleting device itself** records `DELETE_RETIREMENT` in its own `myret_sync_queue` before wiping its own `localStorage`.
   - *Where it fails:* It only protects the device that initiated the deletion. Once `DELETE_RETIREMENT` executes against Supabase and is removed from that device's queue, no record of the deletion exists anywhere.
2. **Local Queue Purge on `enqueue('DELETE_RETIREMENT')` (`src/utils/syncService.ts:126–131`):**
   - *What it protects:* Purges pending `UPSERT_*` operations for `entityId` / `retirementId` in the **deleting device's** `myret_sync_queue`.
   - *Where it fails:* Does not affect `myret_sync_queue` or `localStorage` on any other device (Device B or Device C).
3. **`pendingDeleteRetIds` / `pendingDeleteDailyIds` / `pendingDeleteSuppIds` Filters in `pullFromCloud()` (`src/utils/syncService.ts:649–662, 691–693, 716–720, 751–753`):**
   - *What it protects:* Prevents `pullFromCloud()` on Device A from re-downloading a record that Device A has queued for deletion while Device A is waiting for `processQueue()` to finish.
   - *Where it fails:* Once `processQueue()` finishes on Device A, `DELETE_RETIREMENT` is removed from Device A's queue; and Devices B and C never had `DELETE_RETIREMENT` in their queues at all.

---

### E. MINIMAL CORRECTIVE STRATEGY

To prevent resurrection across all devices and sessions—including stale devices that reconnect days or weeks later—without breaking the 48-hour Trash Bin recovery window or offline creation:

#### 1. Fix Client-Side Cloud-to-Local Merge & Initial Migration (`src/utils/storage.ts` & `src/utils/syncService.ts`)
- **Distinguish Previously Synced Records (`syncStatus === 'synced'`) from Unsynced Local Creations (`syncStatus === 'pending'` or legacy un-synced records):**
  1. **In `storage.mergeCloudData()` (`src/utils/storage.ts:1261–1412`):**
     - When merging `cloudRetirements` with `localRetirements`, if a local non-demo retirement is **absent** from `cloudRetirements`:
       - Keep it locally **only** if `local.syncStatus === 'pending'` (it was created or modified locally and is awaiting upload in the sync queue).
       - If `local.syncStatus === 'synced'` and it is absent from `cloudRetirements`, it was permanently deleted in the cloud (or access was revoked): **remove it from `localStorage`** along with its local daily records, supplementary entries, activity logs, and any references in `connectedRetirementIds`.
     - Apply the exact same rule in `mergeCloudData()` for local `DailyRecord` items (`lines 1375–1383`) and local `SupplementaryEntry` items (`lines 1406–1408`): if a local record belongs to a synced retirement, has `syncStatus === 'synced'`, and is absent from the cloud response for an **active** retirement, remove it locally rather than keeping it.
     - *(Crucial 48-hour Trash safeguard):* Because Supabase's RLS helper `current_user_has_retirement_access` (`migration line 159`) currently filters out child `daily_records` and `supplementary_entries` while a retirement has `status = 'in_trash'`, `mergeCloudData()` must **preserve** local `DailyRecord` and `SupplementaryEntry` items for any retirement whose cloud `status === 'in_trash'` (or the RLS helper should allow owners to read child rows of their own `in_trash` retirements) so that moving a retirement to Trash and restoring it within 48 hours never loses its child records!
  2. **In `syncService.pullFromCloud()` when `allCloudIds.length === 0` (`src/utils/syncService.ts:696–703`):**
     - Do **not** skip `storage.mergeCloudData([], [], [])` when `allCloudIds.length === 0`! Calling `storage.mergeCloudData([], [], [])` ensures that if the user's last cloud retirement was permanently deleted on another device, any local retirement with `syncStatus === 'synced'` on the current device is cleanly pruned before `runInitialMigration()` runs.
  3. **In `syncService.runInitialMigration()` (`src/utils/syncService.ts:911–969`):**
     - `runInitialMigration()` is intended to migrate **pre-cloud legacy records** or **genuinely pending local records** (`syncStatus === 'pending'`), **never** records that are already marked `syncStatus === 'synced'`.
     - Change `needsUpload` (`line 926`), `recNeedsUpload` (`line 941`), and `suppNeedsUpload` (`line 957`) so that records already marked `syncStatus === 'synced'` are **never** re-queued for upload merely because they are absent from the cloud set (`needsUpload = ret.syncStatus === 'pending'`).
     - Additionally, in `storage.reconcileLegacyOwnedRetirements()` (`src/utils/storage.ts:227–230`), if `r.ownerId === user.id` is already set and `r.syncStatus === 'synced'`, it does not need legacy ownership migration.

#### 2. Guard Against Stale Queue Operations & Stale Trash Restoration (`src/utils/syncService.ts` & `src/utils/storage.ts`)
- What if a stale device (Device B or Device C) remained **offline** while a retirement was permanently deleted on Device A, and the user on Device B/C queued a local edit or clicked **Restore** in Trash (`syncStatus === 'pending'`) before reconnecting?
  1. **Verify Cloud Existence Before Updating/Restoring an Existing Previously-Synced Retirement (`src/utils/syncService.ts:306–326`):**
     - Mark newly created local retirements with a durable boolean flag (e.g., `createdOffline?: boolean` or a synced timestamp on the retirement object, cleared in `markRetirementSynced()`).
     - When `executeQueueItem('UPSERT_RETIREMENT')` runs for a retirement that was **previously synced** (i.e. not a brand-new offline creation), check whether the row still exists in `public.retirements` (or perform an `.update(...).eq('id', ret.id).select('id')` instead of a blind `.upsert(...)`).
     - If the previously synced retirement row no longer exists in `public.retirements`, it was permanently deleted: abort the upsert, purge any remaining queued operations for `ret.id`, and call `storage.permanentlyDelete(ret.id, true)` (`skipSync = true`) so the stale offline edit or stale Trash restoration cannot resurrect the permanently deleted retirement.

---

### F. VALIDATION PLAN

A focused, deterministic multi-device simulation test (executable via `npx tsx` with three isolated `localStorage` instances `DeviceA`, `DeviceB`, `DeviceC` against an in-memory mock of Supabase `public.retirements`, `public.daily_records`, and `public.supplementary_entries`) will verify both failure reproduction and the fix:

1. **Setup & Initial Sync Across 3 Devices:**
   - **Device A** creates Retirement `R` with 1 `DailyRecord` (containing categories and expense items) and 1 `SupplementaryEntry`, and syncs to cloud (`syncStatus: 'synced'`).
   - **Device B** and **Device C** both run `pullFromCloud()`. Verify all three devices have `R` and its child records with `syncStatus: 'synced'`.
2. **Trash & Permanent Deletion on Device A:**
   - **Device A** moves `R` to Trash (`storage.moveToTrash(R.id)`) and syncs.
   - **Device B** runs `pullFromCloud()` and sees `R.status === 'in_trash'`.
   - **Device A** permanently deletes `R` (`storage.permanentlyDelete(R.id)`) and syncs (`processQueue()`). Verify `R` and its child rows are removed from cloud storage and from Device A's local storage.
3. **Test Case 1 — Stale Restore on Device B (Reproduced Observation 4):**
   - Before syncing the permanent deletion, **Device B** attempts `storage.restoreFromTrash(R.id)` and runs `processQueue()` + `pullFromCloud()`.
   - **Expected Result:** `R` is **not** re-inserted into cloud storage, is removed from Device B's local storage, and does **not** reappear on Device A.
4. **Test Case 2 — Stale Login / Pull on Device C (Reproduced Observations 6–7):**
   - **Device C** (which still holds `R` with `status: 'active', syncStatus: 'synced'` and all child records in its `localStorage`, both when `allCloudIds.length === 0` and when `allCloudIds.length > 0`) logs in and runs `pullFromCloud()` followed by `processQueue()`.
   - **Expected Result:**
     - `mergeCloudData()` prunes `R` and its child daily records and supplementary entries from Device C's `localStorage`.
     - `runInitialMigration()` enqueues **zero** `UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, or `UPSERT_SUPPLEMENTARY` items for `R`.
     - Cloud storage remains free of `R`, and Device A / Device B do not see `R` reappear.
5. **Test Case 3 — Regression Check for Offline Creation & 48-Hour Trash Recovery:**
   - Verify that a brand-new retirement created while offline on Device C (`syncStatus: 'pending'`) **is** preserved by `mergeCloudData()` and uploaded to cloud storage on `processQueue()`.
   - Verify that a retirement moved to Trash and restored within 48 hours (without being permanently deleted) restores cleanly with all of its daily records, categories, expense items, and supplementary entries intact.
