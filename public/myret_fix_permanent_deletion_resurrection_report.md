# myRet — Fix Permanent-Deletion Resurrection (Implementation & Validation Report)

## Summary of Implemented Fixes

We have implemented a targeted, multi-layered fix across the client synchronization engine, local persistence layer, UI views, and Supabase database migration to prevent permanently deleted retirements and their child records from being resurrected by stale or reconnecting devices while preserving the 48-hour Trash Bin recovery workflow.

---

### 1. Distinguishing Cloud-Synced Records from Brand-New Offline Creations (`src/types/index.ts`, `src/utils/storage.ts`, `src/components/dashboard/CreateRetirementModal.tsx`)
- Added `hasSyncedToCloud?: boolean` to `Retirement`, `DailyRecord`, and `SupplementaryEntry`.
- Brand-new offline records initialize with `hasSyncedToCloud: false` and `syncStatus: 'pending'`.
- Whenever a record is pulled from Supabase or completes a cloud sync (`markRetirementSynced`, `markDailyRecordSynced`, `markSupplementarySynced`, `updateDailyRecordId`, `updateSupplementaryId`, or `mergeCloudData`), `hasSyncedToCloud` is set to `true`.
- Added helper guards (`hasRetirementEverSynced`, `hasDailyRecordEverSynced`, `hasSupplementaryEverSynced`) and a local tombstone registry (`myret_deleted_retirement_tombstones`) so any retirement known to have been permanently deleted is immediately recognized even while offline.

---

### 2. Pruning Cloud-Deleted Records & Preserving 48-Hour Trash Recovery (`src/utils/storage.ts`)
- **`mergeCloudData()` Cloud Deletion Pruning:**
  - Previously, `mergeCloudData()` retained any local retirement, daily record, or supplementary entry absent from `cloudRetirements` / `cloudRecords` / `cloudSupp`, even when `syncStatus === 'synced'`.
  - Now, if a local record is absent from the cloud snapshot and either has a deletion tombstone or was previously synced to the cloud (`hasSyncedToCloud === true` or `syncStatus === 'synced'`), `mergeCloudData()` removes it locally instead of retaining it.
  - Brand-new offline creations (`hasSyncedToCloud === false` and `syncStatus !== 'synced'`) that have never been uploaded remain preserved until their initial sync completes.
- **48-Hour Trash Bin Child Record Protection:**
  - When a retirement is in the Trash Bin (`status === 'in_trash'`), `mergeCloudData()` preserves its local daily records and supplementary entries even if the database has not yet had the updated RLS helper functions applied, ensuring restoring from the Trash Bin within 48 hours retains all financial data.
- **Clean Referential Links on Permanent Deletion:**
  - `permanentlyDelete()` and `cleanupExpiredTrash()` now strip the deleted retirement's ID from `connectedRetirementIds` on any remaining local retirements and pass `{ id, code, ownerId }` in the `DELETE_RETIREMENT` sync payload.

---

### 3. Preventing Resurrection in Queue Processing & Initial Migration (`src/utils/syncService.ts`)
- **Queue Purging (`purgeQueueForRetirement`):**
  - Enqueuing `DELETE_RETIREMENT`, `DELETE_DAILY_RECORD`, or `DELETE_SUPPLEMENTARY` automatically purges any pending `UPSERT_*` operations for that entity (and all child records of a deleted retirement) from the sync queue.
  - When `pullFromCloud()` detects that a previously synced local retirement has been permanently deleted from Supabase, it purges any stale queued operations for that retirement before merging.
- **Safe `UPSERT_RETIREMENT` Execution (No Blind Upsert Recreation):**
  - Before executing `UPSERT_RETIREMENT`, the sync service checks both local tombstones and `public.deleted_retirements` in Supabase.
  - If the retirement was previously synced (`hasSyncedToCloud === true`), `UPSERT_RETIREMENT` first checks whether the row still exists in `public.retirements` and performs an `.update(...).eq('id', payload.id)` rather than a blind `.upsert(...)`. If the row no longer exists in `public.retirements` (permanently deleted by another device), the client purges the local copy and records a deletion tombstone instead of recreating the row.
  - If the database trigger rejects an insert because of a cloud tombstone in `public.deleted_retirements`, `syncService` catches the tombstone rejection, purges the local retirement, and clears its queue entries cleanly without blocking the sync queue.
- **Guarded `runInitialMigration()`:**
  - `runInitialMigration()` now skips any retirement, daily record, or supplementary entry that already has `syncStatus === 'synced'`, `hasSyncedToCloud === true`, or a deletion tombstone. Only genuinely unsynced brand-new local records (`hasSyncedToCloud === false` and `syncStatus !== 'synced'`) are queued for initial upload.

---

### 4. Reactive Trash View & Active Retirement Guard (`src/components/dashboard/TrashView.tsx`, `src/App.tsx`)
- `TrashView.tsx` now subscribes to `syncService` updates and triggers `syncService.pullFromCloud()` on mount so if another device permanently deletes or restores a trashed retirement, the Trash Bin updates immediately.
- `App.tsx` now verifies inside `refreshRetirements()` whether the currently open `activeRetirement` was moved to trash or permanently deleted during a background sync and automatically exits the detail view if so.

---

### 5. Durable Cloud Tombstones & Trash Bin RLS Policies (`supabase/migrations/`)
- Created incremental migration `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` (and matching `public/myret_fix_permanent_deletion_resurrection.sql`) and updated the full baseline migration `supabase/migrations/20261016000100_myret_cloud_persistence.sql` (and `public/myret_cloud_persistence_migration.sql`):
  1. **`public.deleted_retirements` Tombstone Table:** Stores `(retirement_id, code, owner_id, deleted_by, deleted_at)` with RLS allowing owners to read/insert tombstones for their deleted retirements.
  2. **Automatic Tombstone Trigger (`trg_record_retirement_deletion_tombstone`):** Automatically records a tombstone in `public.deleted_retirements` whenever a row is deleted from `public.retirements`.
  3. **Resurrection Prevention Trigger (`trg_prevent_deleted_retirement_resurrection`):** Rejects any `INSERT` into `public.retirements` whose `id` exists in `public.deleted_retirements`.
  4. **48-Hour Trash Recovery RLS Fix:** Updated `public.user_can_access_retirement(target_ret_id UUID)` and `public.user_can_access_daily_record(target_rec_id UUID)` so the retirement owner retains access to child `daily_records`, `expense_categories`, `expense_items`, and `supplementary_entries` while the parent retirement has `status = 'in_trash'`.

---

## Validation Results

1. **TypeScript & Linter Verification (`tsc --noEmit`):** Passed with 0 errors.
2. **Production Build (`compile_applet` / `vite build`):** Succeeded with exit status 0.
3. **Migration Parity Check (`cmp -s`):**
   - `supabase/migrations/20261016000100_myret_cloud_persistence.sql` and `public/myret_cloud_persistence_migration.sql` are byte-for-byte identical (`BASE_IDENTICAL`).
   - `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` and `public/myret_fix_permanent_deletion_resurrection.sql` are byte-for-byte identical (`FIX_IDENTICAL`).
4. **Focused Multi-Device Synchronization Assertions:**
   - Verified that a previously synced retirement (`hasSyncedToCloud: true`, `syncStatus: 'synced'`) and its child daily records are pruned locally when absent from a cloud pull.
   - Verified that a stale device holding a pending edit (`hasSyncedToCloud: true`, `syncStatus: 'pending'`) on a retirement permanently deleted in the cloud prunes its local copy rather than re-uploading it.
   - Verified that brand-new offline retirements (`hasSyncedToCloud: false`, `syncStatus: 'pending'`) are preserved during cloud pulls prior to their initial upload.
   - Verified that child daily records of `in_trash` retirements are preserved locally during the 48-hour recovery window.
