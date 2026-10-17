# myRet — Minimal Final Corrections for Cloud Synchronization

**Project**: myRet — Site Expenditure & Retirement PWA  
**Date**: October 16, 2026  
**Status**: All Minimal Corrections Completed & Validated  
**Safety Status**: Zero SQL executed, no live database modifications made, offline functionality and local data 100% preserved.

---

## 1. Summary of Changes

The following files were modified with the minimum necessary corrections:

1. **`supabase/migrations/20261016000100_myret_cloud_persistence.sql`**:
   - **Narrowed Table Grants & Revocations**: Replaced broad schema-wide `REVOKE ALL ON ALL TABLES IN SCHEMA public` with targeted revocations restricted exclusively to the eight myRet domain tables (`profiles`, `retirements`, `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`). This prevents unintended privilege revocations on existing or future unrelated public tables.
   - **Defensive Type Casting in RPC**: Added `NULLIF(..., '')` for category and item UUID fields in `upsert_daily_record_hierarchy` to prevent PostgreSQL runtime cast errors (`invalid input syntax for type uuid: ""`) when client payloads pass empty string IDs.

2. **`public/myret_cloud_persistence_migration.sql`**:
   - Synchronized 1:1 with `supabase/migrations/20261016000100_myret_cloud_persistence.sql` (`diff -u` confirmed 100% identical).

3. **`src/utils/storage.ts`**:
   - **Calendar-Day Deduplication on Cloud Merge**: Updated `mergeCloudData()` to match daily records not only by `id` but also by canonical key `${retirementId}::${normalizeDate(date)}`. This strictly guarantees that merging cloud records never produces duplicate daily records for the same retirement and calendar date.
   - **Local Pending Modifications Protection**: Preserved in-flight local modifications (`syncStatus === 'pending'`) during cloud merge.
   - **Expired Trash Cloud Deletion**: Updated `cleanupExpiredTrash()` so that when retirements reach the end of their 48-hour trash recovery window, a `DELETE_RETIREMENT` operation is triggered to permanently remove them from the cloud database, preventing expired local trash from remaining permanently stranded in the cloud.

4. **`src/utils/syncService.ts`**:
   - **Comprehensive Initial Local Record Migration**: Extended `runInitialMigration()` to accept known cloud IDs from `pullFromCloud()`. Any local record owned by the active user that is either not present in the cloud or marked `syncStatus === 'pending'` is queued for upload. Existing pending queue items are checked beforehand to prevent duplicate queue items.
   - **Truthful Daily Record Synchronization & Error Propagation**:
     - Verified that `upsert_daily_record_hierarchy` receives normalized dates (`YYYY-MM-DD`) and valid category/item hierarchies.
     - Authoritative RPC errors (permission denials, RLS rejections, constraint violations) are thrown immediately to the queue processor instead of falling back to direct mutations.
     - Direct query fallback only activates if the RPC function itself is missing in the database schema cache (`PGRST202` / `42883`).
     - In the fallback, `amount` is strictly omitted from `expense_items` inserts (allowing the database stored expression to generate it), and any failure throws immediately.
     - `storage.markDailyRecordSynced(record.id)` is reached **only** upon full, verified success of either the RPC or all fallback operations. On failure, the local record remains `pending` and the queue item records the error for retry.

---

## 2. Initial Sync: Local Data Preservation & Upload Queue

- **Local Data Durability**: `localStorage` remains the primary offline and immediate-rendering data store. Local records are never deleted or overwritten during initialization or pull operations.
- **Selective & Safe Queuing**:
  - Demo data (`isDemo: true`) is strictly excluded from cloud upload.
  - Ownership boundaries are enforced: records owned by other accounts are ignored.
  - Local retirements created before cloud connection (or missing `ownerId`) are assigned to the authenticated user and queued.
  - Daily records and supplementary entries associated with eligible retirements are evaluated against cloud IDs. If not present in the cloud or flagged `pending`, they are queued.
- **De-duplication in Queue**: The queue processor checks `this.queue.some(q => q.type === type && q.entityId === id && q.status === 'pending')` before enqueueing, ensuring the same initial record is never queued multiple times.
- **Queue Retries**: If network or database connectivity is unavailable, the queue preserves all pending items with exponential retry limits, transitioning to `Local Safe (Cloud DB Pending)` or `offline` without data loss.

---

## 3. Daily-Record Reliability & Failure Handling

- **Atomic Preferred Method**: The `upsert_daily_record_hierarchy` stored procedure handles daily record upsert, category replacement, item insertion, subtotals, and daily total calculations in a single PostgreSQL database transaction.
- **No False Success Reporting**:
  - `storage.markDailyRecordSynced(record.id)` is placed exclusively after the complete execution of the database call. If any network request, RPC check, or fallback insert fails, the function throws immediately.
  - The local record remains marked `syncStatus: 'pending'` in `localStorage`.
  - The synchronization queue records `lastError`, increments `retryCount`, and marks the queue item as `pending` (or `failed` after 5 retries), leaving it recoverable on the next sync pass.
- **Generated Column Omission**: The client and fallback never attempt to insert into `expense_items.amount`, honoring PostgreSQL's `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED` constraint.
- **One-Record-Per-Date Guarantee**: Dates are normalized to canonical `YYYY-MM-DD` strings before submission. Database table constraint `UNIQUE(retirement_id, record_date)` and `onConflict: 'retirement_id, record_date'` prevent duplicate daily records.

---

## 4. Migration Matching & Permission Scope

- **Exact Match**: A unified diff between `supabase/migrations/20261016000100_myret_cloud_persistence.sql` and `public/myret_cloud_persistence_migration.sql` returns exit code 0 (`diff -u` shows zero differences).
- **Targeted Permissions**: The migration explicitly scopes revocations to the 8 application tables:
  ```sql
  REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.retirements FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.retirement_access FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.daily_records FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.categories FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.expense_items FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.supplementary_entries FROM PUBLIC, anon;
  REVOKE ALL ON TABLE public.connected_retirements FROM PUBLIC, anon;
  ```
  Unrelated public tables and sequences remain entirely unaffected.
- **Authenticated Grants**: Full CRUD grants on the 8 tables are granted to `authenticated`, while table-level RLS policies enforce that only primary owners can mutate and collaborators have read-only (`REVIEWER`) access.

---

## 5. Validation Results

| Check | Method | Result | Notes |
| :--- | :--- | :--- | :--- |
| **TypeScript Compilation** | `npm run lint` (`tsc --noEmit`) | **PASSED** (Exit 0) | Zero type errors or missing import warnings. |
| **Vite Production Build** | `npm run build` (`compile_applet`) | **PASSED** (Exit 0) | Clean client and server bundles created. |
| **Migration Files Parity** | `diff -u` | **PASSED** (Identical) | `supabase/migrations/...` and `public/...` match 100%. |
| **RPC Signature Review** | Static parameter audit | **PASSED** | Param names (`p_record_id`, `p_retirement_id`, `p_record_date`, `p_categories`, etc.) match PostgREST RPC signatures. |
| **Live Database Execution** | **NOT EXECUTED** | **PENDING** | As instructed, no SQL was executed against the live Supabase database. |

---

## 6. Remaining Manual Action

The SQL migration has **NOT** been executed on the live Supabase project.

To enable cloud synchronization:
1. Open the **Supabase Dashboard** for the project.
2. Navigate to the **SQL Editor**.
3. Open or copy the contents of `public/myret_cloud_persistence_migration.sql` (or `supabase/migrations/20261016000100_myret_cloud_persistence.sql`).
4. Paste the script into the SQL Editor and click **Run**.

---

## 7. Shortest Next Steps to Activate & Test

1. **Run Migration**: Execute `public/myret_cloud_persistence_migration.sql` in the Supabase Dashboard SQL Editor.
2. **Reload Application**: Open or refresh the myRet PWA.
3. **Observe Sync Transition**:
   - The indicator in the application header will detect the newly created tables via `checkTablesReady()`.
   - The status will transition from `Local Safe (Cloud DB Pending)` to `Synced`.
4. **Verify Initial Upload**:
   - Open any pre-existing local retirement; verify that it syncs and displays a cloud synced badge.
5. **Test Multi-Device / Secondary Account**:
   - Log in with a second user account.
   - Enter the Retirement Code (`RET-XXXXXX`) using the **Add Existing Retirement** modal to confirm cross-device reviewer access.
