# Read-Only Review: Remove Imported Retirement Feature & Incremental SQL Migration

**Review Status:** 100% Read-Only. Zero files modified, zero SQL executed, zero database changes made.

---

## A. Overall Verdict

**PASS**

---

## B. Findings by Review Area

### 1. UI and Eligibility (`PASS`)

- **Imported Retirement Eligibility Condition:**
  - In `src/components/dashboard/RetirementCard.tsx` (`lines 61–66`), ownership is evaluated as:
    ```ts
    const isOwner = retirement.ownerId === currentUser.id;
    const canDelete = isOwner;
    ```
  - When `canDelete` is `true` (`retirement.ownerId === currentUser.id`), the card renders the **"Delete Retirement (Move to Trash Bin)"** quick button (`lines 130–137`) and the **"Move to Trash Bin"** context-menu item (`lines 197–207`).
  - When `canDelete` is `false` (`retirement.ownerId !== currentUser.id`, i.e., an imported/shared retirement where the user is a `REVIEWER`) and `onRemoveImported` is provided, the card renders the **"Remove Imported Retirement"** quick icon button (`lines 138–148`) and the **"Remove Imported Retirement"** context-menu item (`lines 208–221`).
  - In `src/components/retirement/RetirementHome.tsx` (`lines 92–98` and `314–332`), the same strict condition (`const isOwner = retirement.ownerId === currentUser.id; const canDelete = isOwner;`) controls the top action bar: owners see **"Delete Retirement"** (`setShowDeleteConfirm(true)`), while non-owners (`!canDelete`) see **"Remove Imported Retirement"** (`setShowRemoveImportedConfirm(true)`).
  - Note: Removing `isUserAdmin(currentUser)` from `canDelete` in both `RetirementCard.tsx` and `RetirementHome.tsx` also fixed a latent role-confusion issue where an admin who imported another user's retirement would previously have been shown "Move to Trash" (which would fail or get skipped by `UPSERT_RETIREMENT` owner checks). Now any non-owner—including an admin reviewing another user's retirement—cleanly sees **"Remove Imported Retirement"**.
- **Confirmation Modal Cancellation:**
  - **Dashboard Modal (`src/App.tsx`, `lines 217–227`, `638–678`):** Clicking "Remove Imported Retirement" on a card calls `handleRemoveImportedRetirement(ret)`, which only sets `retirementToRemoveImported(ret)`. Clicking **Cancel** (`lines 661–667`) calls `setRetirementToRemoveImported(null)` without invoking `storage.removeImportedRetirement()`.
  - **Workspace Modal (`src/components/retirement/RetirementHome.tsx`, `lines 109–116`, `677–717`):** Clicking "Remove Imported Retirement" in the header sets `showRemoveImportedConfirm(true)`. Clicking **Cancel** (`lines 700–706`) calls `setShowRemoveImportedConfirm(false)` without invoking `storage.removeImportedRetirement()`.

---

### 2. Local Data Cleanup (`PASS`)

- **Inspection of `storage.removeImportedRetirement(id, skipSync)` (`src/utils/storage.ts`, `lines 493–554`):**
  1. **Owner Guard (`lines 498–501`):**
     - Checks `if (target && currentUser && target.ownerId === currentUser.id) return false;`. Even if invoked programmatically by mistake on an owned retirement, it refuses to execute.
  2. **Queue Enqueue (`lines 503–520`):**
     - If `!skipSync && target && !target.isDemo`, it checks `if (!globalSyncTrigger) return false;` and triggers `'REMOVE_IMPORTED_RETIREMENT'` (never `'DELETE_RETIREMENT'`).
     - Computes `hasSynced = this.hasRetirementEverSynced(target)` before removing the local retirement record and passes `{ id, code: target.code, ownerId: target.ownerId, userId: currentUser?.id, hasSyncedToCloud: hasSynced }` in the payload.
  3. **Targeted Local Storage Removal (`lines 522–551`):**
     - Removes only the retirement where `r.id === id` from `myret_retirements` (`STORAGE_KEYS.RETIREMENTS`) and cleans `id` out of any surviving retirement's `connectedRetirementIds` array (`lines 522–532`).
     - Removes cached child daily records where `r.retirementId === id` from `myret_daily_records` (`lines 535–539`).
     - Removes cached child supplementary entries where `s.retirementId === id` from `myret_supplementary` (`lines 541–545`).
     - Removes local activity logs where `l.retirementId === id` from `myret_activity_logs` (`lines 547–551`).
  4. **Zero Impact on Owner's Cloud Retirement or Unrelated Local Records:**
     - Does not enqueue `DELETE_RETIREMENT`, `DELETE_DAILY_RECORD`, or `DELETE_SUPPLEMENTARY`.
     - All other retirements and their child records (`retirementId !== id`) remain untouched in `localStorage`.

---

### 3. Synchronization (`PASS`)

- **Queue Enqueue & Purging (`src/utils/syncService.ts`, `enqueue()` at `lines 159–215` & `purgeQueueForRetirement()` at `lines 224–253`):**
  - When `type === 'REMOVE_IMPORTED_RETIREMENT'` is enqueued:
    - `hasSyncedToCloud` is resolved using positive sync evidence (`payload?.hasSyncedToCloud === true`, `existingRemoveItem?.payload?.hasSyncedToCloud === true`, `queuedHasSynced`, or `storage.hasRetirementEverSynced(localRet)`), preserving `false` when explicitly offline-only and defaulting conservatively to `true` when local state is already absent (`lines 160–190`).
    - Calls `this.purgeQueueForRetirement(entityId, false, true)` (`line 191`), which purges any older queued operations referencing `entityId` (including `CONNECT_RETIREMENTS` / `DISCONNECT_RETIREMENTS` or any stale operations) while keeping only `REMOVE_IMPORTED_RETIREMENT` (`lines 234–240`).
    - Coalesces with any existing `REMOVE_IMPORTED_RETIREMENT` item for `entityId` (even if `status === 'failed'`), resetting `status: 'pending'`, `retryCount: 0`, and deleting `lastError` (`lines 202–230`).
- **Execution in `executeQueueItem()` (`src/utils/syncService.ts`, `lines 590–635`):**
  - Targets **only** the current user's row in `public.retirement_access`:
    ```ts
    const { data: deletedRows, error } = await supabase
      .from('retirement_access')
      .delete()
      .eq('retirement_id', id)
      .eq('user_id', currentUserId)
      .select('id');
    ```
  - If `error` occurs, it throws `error` so the queue item increments `retryCount` and retries.
  - If `deletedCount === 0 && hasEverSynced`:
    - It queries `public.retirement_access` for `.eq('retirement_id', id).eq('user_id', currentUserId).maybeSingle()` (`lines 616–621`).
    - Unlike `public.retirements` (where RLS hides a row from non-owners, requiring a separate tombstone table), `public.retirement_access` has the SELECT policy `Participants can view access list` (`USING (public.current_user_has_retirement_access(retirement_id))`), which returns `true` whenever a row exists for `(retirement_id, auth.uid())`.
    - Therefore, if the `DELETE` was silently blocked by missing RLS `DELETE` policy (0 rows deleted, row still exists), `remainingRow?.id` is returned and `executeQueueItem` throws a clear error (`lines 626–630`), keeping `REMOVE_IMPORTED_RETIREMENT` in the queue rather than silently dropping it and allowing `pullFromCloud()` to re-import the retirement.
    - Conversely, if the row is genuinely absent (`!remainingRow?.id` and `!checkErr`), the operation completes idempotently.
- **Protection During `pullFromCloud()` (`src/utils/syncService.ts`, `lines 931–938`, `999–1001`, `1165–1170`):**
  - `pendingDeleteRetIds` includes both `DELETE_RETIREMENT` and `REMOVE_IMPORTED_RETIREMENT` queue items (`lines 931–938`), regardless of whether their status is `'pending'` or `'failed'`.
  - `deletedRetIdSet` is initialized from `pendingDeleteRetIds` (`line 956`).
  - `allCloudRetirements` filters out any retirement in `deletedRetIdSet` (`lines 999–1001`), and `storage.mergeCloudData(..., deletedRetIdSet)` prunes any local copy and skips any cloud daily records or supplementary entries for those IDs (`src/utils/storage.ts`, `lines 1457–1460`, `1564–1569`, `1649–1653`).
  - In `pullFromCloud()` (`lines 1173–1179`), `if (!pendingDeleteRetIds.has(prunedId))` prevents `pullFromCloud()` from purging the pending `REMOVE_IMPORTED_RETIREMENT` queue item before `processQueue()` executes it.
- **Cross-Device & Cross-Session Persistence:**
  - Once `REMOVE_IMPORTED_RETIREMENT` deletes the user's `public.retirement_access` row in Supabase, subsequent `pullFromCloud()` calls on any device (or after logout/login or refresh) no longer receive `retirement_id` in `sharedAccess` (`lines 980–986`).
  - On another device that still had the imported retirement cached locally with `hasSyncedToCloud: true`, `storage.mergeCloudData()` sees that the retirement is absent from `cloudRetirements` and `this.hasRetirementEverSynced(local)` is `true` (`src/utils/storage.ts:1481–1486`), so it automatically prunes the retirement and its local cached records on that device as well.

---

### 4. Re-Importing (`PASS`)

- **Inspection of `AddExistingModal.tsx` (`lines 41–115`) and `syncService.claimRetirementByCode()` (`src/utils/syncService.ts`, `lines 1320–1404`):**
  1. When User B opens `AddExistingModal` and enters the code `RET-XXXXXX` while online (`lines 44–59`), `AddExistingModal` calls `await syncService.claimRetirementByCode(cleanCode)`.
  2. Inside `claimRetirementByCode(code)`:
     - It invokes `supabase.rpc('claim_retirement_by_code', { p_code: cleanCode })` (or the direct fallback if RPC is unavailable), which inserts a fresh `(retirement_id, user_id, 'REVIEWER')` row into `public.retirement_access` (`lines 1347–1388`).
     - Next (`lines 1390–1399`), it explicitly clears any pending or failed `REMOVE_IMPORTED_RETIREMENT` queue items for `retId`:
       ```ts
       if (retId) {
         const beforeLen = this.queue.length;
         this.queue = this.queue.filter(
           (q) => !(q.type === 'REMOVE_IMPORTED_RETIREMENT' && q.entityId === retId)
         );
         if (this.queue.length !== beforeLen) {
           this.saveQueue();
         }
       }
       ```
     - It then calls `await this.pullFromCloud()` (`line 1402`), which fetches the newly re-shared retirement and its daily/supplementary records from Supabase and hydrates them into `localStorage`.
  3. Because removing an imported retirement never inserts a row into `public.deleted_retirements`, `deletedRetIdSet` in `pullFromCloud()` does not block re-importing once any local `REMOVE_IMPORTED_RETIREMENT` queue item is cleared.

---

### 5. Database Migration (`PASS`)

- **Files Reviewed:**
  1. `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql` (`20 lines`, `929 bytes`, SHA-256: `78c1a11fe0ef51459be5e6e86add2413a2de0e4eb84c91e1b2cc60bc41db4459`)
  2. `public/myret_allow_collaborator_remove_imported_retirement.sql` (`20 lines`, `929 bytes`, SHA-256: `78c1a11fe0ef51459be5e6e86add2413a2de0e4eb84c91e1b2cc60bc41db4459`)
- **Verification Details:**
  - **No Repetition or Modification of Applied Migrations:** Neither `20261016000100_myret_cloud_persistence.sql` nor `20261017000100_fix_permanent_deletion_resurrection.sql` was modified, and the new migration contains only the single `Collaborators can remove their own access` policy on `public.retirement_access`.
  - **Table Grants & RLS Interaction:**
    - In the baseline migration (`20261016000100_myret_cloud_persistence.sql`, `line 778`), `GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirement_access TO authenticated;` is already granted.
    - Existing policies on `public.retirement_access` (`lines 280–289`) are:
      1. `"Participants can view access list"` (`FOR SELECT TO authenticated USING (public.current_user_has_retirement_access(retirement_id))`)
      2. `"Primary owners can manage access"` (`FOR ALL TO authenticated USING (public.current_user_is_retirement_owner(retirement_id)) WITH CHECK (public.current_user_is_retirement_owner(retirement_id))`)
    - Because PostgreSQL permissive RLS policies for the same command (`DELETE`) are combined with `OR`, adding:
      ```sql
      DROP POLICY IF EXISTS "Collaborators can remove their own access" ON public.retirement_access;
      CREATE POLICY "Collaborators can remove their own access"
        ON public.retirement_access FOR DELETE TO authenticated
        USING (user_id = auth.uid());
      ```
      allows a user to `DELETE` a row in `public.retirement_access` if and only if they are the retirement owner (`current_user_is_retirement_owner(retirement_id)`) **OR** the `retirement_access` row belongs to themselves (`user_id = auth.uid()`).
  - **Cannot Authorize Deletion of Original Retirement or Another User's Access:**
    - Scoped strictly to `ON public.retirement_access FOR DELETE TO authenticated USING (user_id = auth.uid())`.
    - Grants zero permissions on `public.retirements`, `public.daily_records`, `public.categories`, `public.expense_items`, `public.supplementary_entries`, or `public.deleted_retirements`.
    - Cannot delete any row in `public.retirement_access` where `user_id <> auth.uid()`.
  - **Idempotency & Byte Identity:**
    - Uses `BEGIN; ... DROP POLICY IF EXISTS ... CREATE POLICY ... COMMIT;` so it is idempotent and safe to run on the live Supabase database.
    - Verified byte-identical (`cmp -s` exit code `0`, matching SHA-256 `78c1a11fe0ef51459be5e6e86add2413a2de0e4eb84c91e1b2cc60bc41db4459`) between `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql` and `public/myret_allow_collaborator_remove_imported_retirement.sql`.

---

### 6. Regression Risks (`PASS`)

- **Owner Retirement Deletion & Trash Bin Recovery:**
  - Owner soft-delete (`storage.moveToTrash(id)`), restoration (`storage.restoreFromTrash(id)`), 48-hour expiration (`cleanupExpiredTrash()`), and permanent deletion (`storage.permanentlyDelete(id)` -> `DELETE_RETIREMENT`) remain untouched.
  - `TrashView.tsx` only lists retirements with `status === 'in_trash'`; removed imported retirements are removed directly from local storage without entering the importer's Trash Bin.
- **Permanent-Deletion Tombstone Protection:**
  - `public.deleted_retirements` is only populated by the PostgreSQL `AFTER DELETE ON public.retirements` trigger (`on_retirement_permanently_deleted`). Removing a row from `public.retirement_access` never fires triggers on `public.retirements` and never writes to `public.deleted_retirements`.
  - If the owner later permanently deletes the retirement, `deleted_retirements` still records the tombstone as before.
- **Other Retirements Belonging to Current User:**
  - Filtering in `storage.removeImportedRetirement(id)` and `executeQueueItem('REMOVE_IMPORTED_RETIREMENT')` is strictly scoped to the target `retirementId` (`id`) and `currentUserId`.

---

### 7. Build and Test Evidence (`PASS`)

- **Static Code & SQL Inspection:**
  - Inspected `src/types/index.ts`, `src/utils/storage.ts`, `src/utils/syncService.ts`, `src/components/dashboard/RetirementCard.tsx`, `src/components/retirement/RetirementHome.tsx`, `src/components/dashboard/AddExistingModal.tsx`, `src/App.tsx`, `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql`, and `public/myret_allow_collaborator_remove_imported_retirement.sql`.
- **TypeScript / Lint Check (`lint_applet` / `tsc --noEmit`):**
  - Executed and passed with zero errors.
- **Production Build Check (`compile_applet` / `vite build`):**
  - Executed and succeeded cleanly.
- **Binary File Comparison (`sha256sum` & `cmp -s`):**
  - Executed and confirmed `BYTE_IDENTICAL` between migration and public deployment copy.
- **Runtime / Live Database Tests:**
  - Not executed against the live Supabase instance (per strict read-only database instructions; the new incremental migration `20261018000100_allow_collaborator_remove_imported_retirement.sql` has not yet been applied to the live Supabase database).

---

## C. Supporting Files and Functions

- `src/types/index.ts`: `SyncOperationType` (`line 104`)
- `src/utils/storage.ts`: `StorageService.removeImportedRetirement` (`lines 493–554`), `StorageService.mergeCloudData` (`lines 1432–1675`)
- `src/utils/syncService.ts`: `SyncService.enqueue` (`lines 159–215`), `SyncService.purgeQueueForRetirement` (`lines 224–253`), `SyncService.executeQueueItem` (`case 'REMOVE_IMPORTED_RETIREMENT'` at `lines 590–635`), `SyncService.pullFromCloud` (`lines 931–938`, `1173–1179`), `SyncService.claimRetirementByCode` (`lines 1390–1404`)
- `src/components/dashboard/RetirementCard.tsx`: `RetirementCard` (`lines 61–66`, `130–224`)
- `src/components/retirement/RetirementHome.tsx`: `RetirementHome` (`lines 92–116`, `314–332`, `677–717`)
- `src/components/dashboard/AddExistingModal.tsx`: `AddExistingModal` (`lines 41–65`)
- `src/App.tsx`: `handleRemoveImportedRetirement` & `handleConfirmRemoveImported` (`lines 217–227`, `539`, `638–678`)
- `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql` & `public/myret_allow_collaborator_remove_imported_retirement.sql` (`lines 12–19`)

---

## D. Confirmed Defects or Unresolved Risks

- **Confirmed Code or SQL Defects:** None.
- **Operational Dependency:** Until `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql` is applied in the live Supabase SQL Editor, RLS on `public.retirement_access` will not permit non-owners to delete their own `retirement_access` row in the cloud. However, because `executeQueueItem` verifies whether the row still exists after a `0`-row delete and throws an error while keeping `REMOVE_IMPORTED_RETIREMENT` in `pendingDeleteRetIds`, the removed retirement will remain hidden locally and will automatically finish syncing once the migration is applied.

---

## E. Recommended Next Steps

1. Apply `supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql` (along with `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` if not yet applied) in the Supabase SQL Editor.
2. Perform a live end-to-end verification in two accounts (Owner User A and Importer User B): import a retirement by code as User B, remove it via **"Remove Imported Retirement"**, refresh/re-login to confirm persistence, verify User A's retirement and records are untouched, and re-import the code as User B.
