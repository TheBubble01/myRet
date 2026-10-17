# myRet — Targeted Security & Correctness Review of Incremental Migration (`20261017000100_fix_permanent_deletion_resurrection.sql`)

**Review Type:** Read-Only Static Code & SQL Security/Correctness Audit  
**Live Database Status:** Not modified; no SQL executed against Supabase; incremental migration has **not** yet been applied to the live database.  
**Files Inspected:**
1. `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` (lines 1–131)
2. `public/myret_fix_permanent_deletion_resurrection.sql` (lines 1–131)
3. `supabase/migrations/20261016000100_myret_cloud_persistence.sql` (lines 1–786)
4. `src/utils/syncService.ts` (lines 1–1278)
5. `src/utils/storage.ts` (lines 1–1627)
6. `src/types/index.ts` (lines 1–132)
7. `src/components/dashboard/TrashView.tsx` (lines 1–158)

---

## Executive Summary

The incremental migration (`20261017000100_fix_permanent_deletion_resurrection.sql`) and accompanying client-side synchronization updates address the core permanent-deletion resurrection mechanism and the 48-hour Trash Bin child-record RLS regression.

However, **static security inspection of `public.deleted_retirements` identified a High-Severity RLS / Privilege Vulnerability** in the incremental migration that should be corrected **before** applying the SQL migration to the live Supabase database:

1. **Forged Tombstone & Tombstone Tampering Vulnerability (High Severity — SQL Migration):**
   - `public.deleted_retirements` grants `INSERT` and `UPDATE` directly to `authenticated` with RLS policies that only check `owner_id = auth.uid()` on the tombstone row itself (`WITH CHECK (owner_id = auth.uid())`).
   - Because the policy does **not** verify that `retirement_id` actually belongs to `auth.uid()` in `public.retirements`, any authenticated user (including a read-only `REVIEWER` collaborator who knows a shared retirement's UUID) can insert a forged tombstone with `retirement_id = <shared_retirement_id>` and `owner_id = auth.uid()`.
   - Because both `prevent_deleted_retirement_resurrection()` and client-side `pullFromCloud()` check `deleted_retirements` by `retirement_id` alone, a forged tombstone immediately blocks the legitimate owner from updating their retirement or its daily records in Supabase and causes the owner's device to **permanently prune the active retirement and all its local records** on the next sync pull.
   - Additionally, `GRANT UPDATE` allows a user to update the `retirement_id` primary key on an existing tombstone row they own, either erasing tombstone protection for a deleted retirement or retargeting the tombstone at another retirement UUID.
   - **Root Cause & Fix:** Because the `AFTER DELETE ON public.retirements` trigger (`public.record_deleted_retirement_tombstone()`) is `SECURITY DEFINER`, it already records tombstones with elevated privileges automatically whenever an authorized owner deletes a retirement. Direct client `INSERT`, `UPDATE`, and `DELETE` grants/policies on `public.deleted_retirements` are unnecessary and unsafe.

---

## CHECK 1 — Tombstone Security (`public.deleted_retirements`)

### 1.1 Exact Privileges & RLS Policies on `public.deleted_retirements`
In `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` (lines 22–41):
- **Table Grants:**
  - `REVOKE ALL ON TABLE public.deleted_retirements FROM PUBLIC, anon;`
  - `GRANT SELECT, INSERT, UPDATE ON public.deleted_retirements TO authenticated;`
- **RLS Policies:**
  - `SELECT`: `"Users can view deleted retirement tombstones"` — `FOR SELECT TO authenticated USING (true)`
  - `INSERT`: `"Owners can insert deleted retirement tombstones"` — `FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid())`
  - `UPDATE`: `"Owners can update deleted retirement tombstones"` — `FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`
  - `DELETE`: No `DELETE` grant and no `FOR DELETE` RLS policy exist.

### 1.2 Answers to Specific Security Questions

| Question | Finding |
| :--- | :--- |
| **Who can `SELECT` rows in `public.deleted_retirements`?** | Any `authenticated` user can `SELECT` all rows (`USING (true)`). `anon` and `PUBLIC` have no access. |
| **Who can `INSERT` rows in `public.deleted_retirements`?** | Any `authenticated` user can directly `INSERT` a row via PostgREST as long as the inserted payload sets `owner_id = auth.uid()`, plus the `SECURITY DEFINER` trigger `record_deleted_retirement_tombstone()`. |
| **Who can `UPDATE` rows in `public.deleted_retirements`?** | Any `authenticated` user can `UPDATE` any column (including `retirement_id`) on rows where `owner_id = auth.uid()`, plus the `SECURITY DEFINER` trigger on conflict. |
| **Who can `DELETE` rows in `public.deleted_retirements`?** | **No `authenticated` user.** `DELETE` is not granted to `authenticated` and no `FOR DELETE` policy exists. Rows are only deleted if the owner's profile in `public.profiles` is cascade-deleted (`ON DELETE CASCADE`). |
| **Can an authenticated user delete or modify a tombstone?** | They **cannot `DELETE`** a tombstone row directly. However, because `UPDATE` is granted on all columns, an owner **can modify** a tombstone where `owner_id = auth.uid()`, including changing `retirement_id` to a dummy UUID (effectively bypassing the tombstone) or changing `deleted_at`. |
| **Can a user create a forged tombstone for another user's retirement?** | **YES (Vulnerability).** A collaborator or any authenticated user who knows another user's `retirement_id` UUID can execute `INSERT INTO public.deleted_retirements (retirement_id, owner_id) VALUES ('<victim_retirement_uuid>', auth.uid())`. This satisfies `WITH CHECK (owner_id = auth.uid())` because the check only inspects `deleted_retirements.owner_id`, not `retirements.owner_id`. |
| **Does the trigger execute with appropriate privileges and correctly identify the retirement owner and deleting user?** | **Yes.** `public.record_deleted_retirement_tombstone()` is `SECURITY DEFINER` with `SET search_path = public, pg_temp`. It fires `AFTER DELETE ON public.retirements` and records `OLD.id`, `OLD.code`, and `OLD.owner_id`. Because `public.retirements` only permits `DELETE` when `owner_id = auth.uid()` (line 277 of baseline migration), the deleting user is guaranteed to be `OLD.owner_id`. |
| **Does RLS prevent the trigger from recording a tombstone when the deleting user is authorized to delete the retirement?** | **No.** Because `record_deleted_retirement_tombstone()` is `SECURITY DEFINER` (owned by the migration superuser/admin role with `BYPASSRLS`), it bypasses RLS on `public.deleted_retirements`. It will succeed even if `INSERT` and `UPDATE` are completely revoked from `authenticated`. |

---

## CHECK 2 — Resurrection Prevention Trigger & Database-Level Enforcement

### 2.1 `public.prevent_deleted_retirement_resurrection()` (Lines 64–85)
```sql
CREATE OR REPLACE FUNCTION public.prevent_deleted_retirement_resurrection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deleted_retirements
    WHERE retirement_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'PERMANENTLY_DELETED: Retirement % was permanently deleted and cannot be recreated', NEW.id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER before_retirement_upsert_check_deleted
  BEFORE INSERT OR UPDATE ON public.retirements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deleted_retirement_resurrection();
```

- **Effectiveness against stale `INSERT` / `UPSERT` / `UPDATE`:**
  - Fires `BEFORE INSERT OR UPDATE ON public.retirements FOR EACH ROW`.
  - In PostgreSQL, a `BEFORE INSERT` trigger executes before row insertion or `ON CONFLICT DO UPDATE` resolution. Any attempt by a stale device to `INSERT` or `UPSERT` a retirement whose `id` is in `public.deleted_retirements` is rejected with SQLSTATE `P0002` (`PERMANENTLY_DELETED:...`).
- **Effectiveness against child record uploads (`upsert_daily_record_hierarchy`):**
  - If a retirement has been deleted from `public.retirements`, `current_user_is_retirement_owner(p_retirement_id)` returns `FALSE` (blocking the RPC at line 659 of the baseline migration), and foreign-key constraints `REFERENCES public.retirements(id) ON DELETE CASCADE` on `daily_records` and `supplementary_entries` reject orphan child inserts with `23503` (`foreign_key_violation`).
- **Interaction with client-side pre-delete tombstone upsert (`syncService.ts` lines 491–505):**
  - In `syncService.ts` (`DELETE_RETIREMENT`), the client currently upserts into `deleted_retirements` *before* calling `supabase.from('retirements').delete().eq('id', id)`.
  - Because `before_retirement_upsert_check_deleted` only fires on `BEFORE INSERT OR UPDATE` (not `DELETE`), inserting the tombstone first does not block the subsequent `DELETE FROM public.retirements`.
  - However, once `INSERT`/`UPDATE` on `deleted_retirements` are revoked from `authenticated` (to fix the forged tombstone vulnerability in Check 1), the `AFTER DELETE` trigger on `public.retirements` will be the sole, authoritative writer to `public.deleted_retirements`.
  - *Edge-case note:* What if Retirement `R` was deleted from `public.retirements` **before** the incremental migration was applied (so `R` is already gone from `public.retirements` and has no row in `public.deleted_retirements`), and another device later executes `DELETE_RETIREMENT`? If `DELETE FROM public.retirements WHERE id = R.id` affects 0 rows, the `AFTER DELETE` trigger will not fire for that already-deleted row. If you want `DELETE_RETIREMENT` to also be able to record a tombstone for a retirement that was already deleted prior to the migration, you should either keep tombstone creation strictly inside a `SECURITY DEFINER` RPC (or reject `INSERT` into `deleted_retirements` only when `EXISTS (SELECT 1 FROM public.retirements r WHERE r.id = retirement_id AND r.owner_id <> auth.uid())`, though note that if a retirement no longer exists in `public.retirements`, the database cannot verify who owned it unless checked against existing table rows). Therefore, trigger-only writes (`REVOKE INSERT, UPDATE, DELETE ON public.deleted_retirements FROM authenticated`) is the only way to guarantee zero forged tombstones.

---

## CHECK 3 — Trash Bin Recovery (48-Hour Window) & RLS Helper Functions

### 3.1 Inspection of Updated Helper Functions (Lines 88–130)
1. **`public.current_user_has_retirement_access(p_ret_id UUID)`:**
   ```sql
   SELECT EXISTS (
     SELECT 1 FROM public.retirements
     WHERE id = p_ret_id
       AND (
         (owner_id = auth.uid() AND status IN ('active', 'in_trash'))
         OR (
           status = 'active'
           AND EXISTS (
             SELECT 1 FROM public.retirement_access
             WHERE retirement_id = p_ret_id AND user_id = auth.uid()
           )
         )
       )
   );
   ```
2. **`public.current_user_is_retirement_owner(p_ret_id UUID)`:**
   ```sql
   SELECT EXISTS (
     SELECT 1 FROM public.retirements
     WHERE id = p_ret_id
       AND status IN ('active', 'in_trash')
       AND owner_id = auth.uid()
   );
   ```

### 3.2 Impact on Child Record RLS Policies & Collaborator Isolation
- **Owner Access While `status = 'in_trash'`:**
  - `daily_records`, `categories`, `expense_items`, `supplementary_entries`, and `retirement_access` all use `public.current_user_has_retirement_access(...)` in their `SELECT` RLS policies and `public.current_user_is_retirement_owner(...)` in their `ALL` (modify) RLS policies.
  - With `status IN ('active', 'in_trash')` enabled for `owner_id = auth.uid()`, the primary owner retains full `SELECT` and modification access to all child records while a retirement is in the Trash Bin during the 48-hour recovery window.
  - Restoring a retirement from Trash within 48 hours on the same or another owned device preserves all daily records, categories, expense items, and supplementary entries in the cloud and locally.
- **Reviewer (Collaborator) Isolation While `status = 'in_trash'`:**
  - For any user where `owner_id <> auth.uid()`, `current_user_has_retirement_access` strictly requires `status = 'active'`.
  - Consequently, reviewers immediately lose `SELECT` visibility on the retirement and all of its child records as soon as the owner moves it to `in_trash`, and regain visibility if the owner restores it to `active` within 48 hours.

---

## CHECK 4 — Client-Side Synchronization & Stale-Device Resurrection Prevention

### 4.1 `src/utils/storage.ts` & `src/utils/syncService.ts` Verification
1. **Explicit Sync History Tracking (`hasSyncedToCloud`):**
   - `Retirement`, `DailyRecord`, and `SupplementaryEntry` in `src/types/index.ts` now carry `hasSyncedToCloud?: boolean`.
   - `storage.hasRetirementEverSynced(ret)` returns `true` if `ret.hasSyncedToCloud === true`, `ret.syncStatus === 'synced'`, if `ret.access` has no local `OWNER` row (hydrated from cloud), or if any child daily record or supplementary entry has ever synced.
2. **Pruning Cloud-Deleted Retirements on Pull (`storage.mergeCloudData`, lines 1418–1424):**
   - When `pullFromCloud()` runs, any local retirement absent from `cloudRetirements` that is either in `deletedRetirementIds` (`deleted_retirements`) OR satisfies `this.hasRetirementEverSynced(local)` is added to `prunedRetirementIdSet` and removed from local storage along with its daily records, supplementary entries, activity logs, and `connectedRetirementIds` references.
   - `pullFromCloud()` (lines 1048–1054) also purges any pending sync queue operations referencing `prunedRetirementIds`.
3. **Preventing Re-Upload in `runInitialMigration()` (`syncService.ts`, lines 1130–1143):**
   - `runInitialMigration()` explicitly skips any retirement in `deletedRetirementIds` and skips any retirement where `!isKnownInCloud && hasRetSynced`.
4. **Update-Only Semantics for Previously Synced Retirements (`syncService.ts`, lines 404–437):**
   - When `executeQueueItem` processes `UPSERT_RETIREMENT` for a retirement with `hasEverSynced === true` (such as a stale device attempting to push an offline edit or a stale Trash restoration), it executes `.from('retirements').update(...).eq('id', ret.id).select('id')` instead of `.upsert(...)`.
   - If the row was permanently deleted in Supabase, `.update(...)` returns `0` rows (`updatedRows.length === 0`), and `syncService` immediately calls `storage.permanentlyDelete(ret.id, true)` and `this.purgeQueueForRetirement(ret.id, false)` instead of re-inserting the deleted row.

### 4.2 Client-Side Edge Cases Identified
1. **Legacy Empty Retirement Created Offline Before `hasSyncedToCloud` Existed (Low/Medium Edge Case):**
   - In `storage.hasRetirementEverSynced(ret)` (lines 1059–1089), if a retirement was originally created on Device C *before* `hasSyncedToCloud` was added to the codebase, synced to the cloud, had **zero** daily records and **zero** supplementary entries, and was then edited or restored offline on Device C (setting `syncStatus = 'pending'` while `hasSyncedToCloud` is `undefined` and `ret.access` still contains the local `OWNER` row), `hasRetirementEverSynced(ret)` would evaluate to `false`.
   - **Mitigation:** Once the incremental migration is applied, `public.deleted_retirements` and the `BEFORE INSERT` trigger `prevent_deleted_retirement_resurrection()` block Device C from re-inserting that retirement if it was deleted after the migration. Additionally, `storage.restoreFromTrash()` / `storage.moveToTrash()` / `storage.saveRetirement()` can treat any existing non-demo retirement that already has `updatedAt !== createdAt` or `status === 'in_trash'` as having previously synced if desired, though the cloud tombstone table handles all post-migration deletions.
2. **`TrashView.tsx` Optimistic UI Navigation Before `pullFromCloud()` Completes (Low Edge Case):**
   - In `src/components/dashboard/TrashView.tsx` (lines 23–40), `loadTrash()` renders local trash items immediately on mount while `syncService.pullFromCloud()` runs asynchronously in the background.
   - If a user on Device B clicks **"Restore"** within the brief window before `pullFromCloud()` completes for a retirement that Device A just permanently deleted, `handleRestore` calls `onRetirementRestored(id)` immediately, and then a moment later `pullFromCloud()` / `processQueue()` detects that the retirement was permanently deleted in the cloud and purges it locally. It will not resurrect in the cloud, though the UI briefly navigates to the retirement before it disappears.
3. **Redundant Client-Side Upsert to `deleted_retirements` in `DELETE_RETIREMENT` (`syncService.ts` lines 491–503):**
   - Currently, `DELETE_RETIREMENT` calls `await supabase.from('deleted_retirements').upsert(...)` before `await supabase.from('retirements').delete().eq('id', id)`.
   - Once `INSERT` and `UPDATE` privileges on `public.deleted_retirements` are revoked from `authenticated` (so only the `SECURITY DEFINER` `AFTER DELETE` trigger can write tombstones), that client-side `.from('deleted_retirements').upsert(...)` call will receive a `403 Forbidden` response from PostgREST on every permanent deletion (even though it won't throw). Removing that client-side `.from('deleted_retirements').upsert(...)` call from `syncService.ts` avoids unnecessary `403` network requests.

---

## CHECK 5 — Migration File Parity & Baseline Consistency

1. **Incremental Migration Parity:**
   - `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` and `public/myret_fix_permanent_deletion_resurrection.sql` are **byte-for-byte identical** (131 lines, 4,933 bytes).
2. **Consistency with `supabase/migrations/20261016000100_myret_cloud_persistence.sql`:**
   - Note that the baseline file `supabase/migrations/20261016000100_myret_cloud_persistence.sql` in the workspace was also updated to include `public.deleted_retirements`, the two tombstone triggers, and the updated `current_user_has_retirement_access` / `current_user_is_retirement_owner` definitions.
   - All statements in `20261017000100_fix_permanent_deletion_resurrection.sql` are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`) and compatible with the already-applied baseline schema in the live Supabase database.

---

## Summary of What Was Verified Statically vs. Live Database

- **Verified via Static Code & SQL Inspection:**
  - All DDL, table definitions, foreign keys, `SECURITY DEFINER` functions, triggers, RLS policies, and `GRANT`/`REVOKE` statements in `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`, `public/myret_fix_permanent_deletion_resurrection.sql`, and `supabase/migrations/20261016000100_myret_cloud_persistence.sql`.
  - Complete client-side synchronization and storage logic in `src/utils/syncService.ts`, `src/utils/storage.ts`, `src/types/index.ts`, and `src/components/dashboard/TrashView.tsx`.
- **Not Executed / Not Tested Against Live Supabase Database:**
  - Per instructions, no SQL queries or migrations were executed against the live Supabase project, and the incremental migration has not yet been applied to the live database.

---

## Recommended Minimal Corrections (Awaiting Your Approval)

Before applying the incremental migration to the live Supabase database, we recommend approving the following minimal security hardening changes:

1. **Harden `public.deleted_retirements` in SQL (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`, `public/myret_fix_permanent_deletion_resurrection.sql`, and `supabase/migrations/20261016000100_myret_cloud_persistence.sql`):**
   - **Remove** the `INSERT` and `UPDATE` RLS policies (`"Owners can insert deleted retirement tombstones"` and `"Owners can update deleted retirement tombstones"`) on `public.deleted_retirements`.
   - **Change the table grant** from `GRANT SELECT, INSERT, UPDATE ON public.deleted_retirements TO authenticated;` to **read-only**:
     ```sql
     REVOKE ALL ON TABLE public.deleted_retirements FROM PUBLIC, anon, authenticated;
     GRANT SELECT ON public.deleted_retirements TO authenticated;
     ```
   - This guarantees that tombstones can **only** be created by the `SECURITY DEFINER` trigger `public.record_deleted_retirement_tombstone()` when an actual row in `public.retirements` is deleted by its authorized owner (`owner_id = auth.uid()`), completely eliminating the forged tombstone and primary-key tampering vulnerabilities.
2. **Remove Redundant Client Tombstone Upsert in `src/utils/syncService.ts`:**
   - In `executeQueueItem` -> `case 'DELETE_RETIREMENT'` (lines 490–503), remove the direct `supabase.from('deleted_retirements').upsert(...)` call and rely on `await supabase.from('retirements').delete().eq('id', id)` which triggers `on_retirement_permanently_deleted` atomically on the server.

*No files or database state have been modified during this review. Please let us know if you approve implementing these hardening corrections.*
