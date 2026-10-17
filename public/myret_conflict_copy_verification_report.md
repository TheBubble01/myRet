# myRet — Verification of Conflict-Copy Behaviour During Normal Record Operations (Read-Only)

**Project**: myRet — Site Expenditure & Retirement PWA  
**Date**: October 16, 2026  
**Scope**: Read-only verification of whether ordinary daily retirement record operations can unintentionally trigger `(Cloud conflict copy)` items during synchronization.

---

## 1. Exact Files and Functions Inspected

1. **`src/components/retirement/DailyRecordModal.tsx`**
   - `DailyRecordModal` state initialization and `useEffect` hydration (`lines 63–146`)
   - `handleItemChange()` (`lines 151–177`)
   - `handleAddItem()` (`lines 179–189`)
   - `handleDeleteItem()` (`lines 191–211`)
   - `handleSubmit()` (`lines 277–322`)
2. **`src/components/retirement/RetirementHome.tsx`**
   - `handleSaveDailyRecord()` (`lines 149–158`)
   - `handleConfirmDeleteDailyRecord()` (`lines 164–174`)
3. **`src/utils/storage.ts`**
   - `getDailyRecords()` (`lines 560–596`)
   - `mergeRecordCategories()` (`lines 476–557`)
   - `saveDailyRecord()` (`lines 598–699`)
   - `markDailyRecordSynced()` (`lines 944–957`)
   - `reconcileDailyRecordWithCloud()` (`lines 994–1217`)
   - `mergeCloudData()` (`lines 1219–1382`)
4. **`src/utils/syncService.ts`**
   - `enqueue()` (`lines 119–175`)
   - `processQueue()` (`lines 195–297`)
   - `executeQueueItem()` — `UPSERT_DAILY_RECORD` (`lines 340–482`)
   - `pullFromCloud()` (`lines 582–849`)
5. **`src/App.tsx`**
   - Session initialization and `onAuthStateChange` synchronization sequence (`lines 85–138`)
6. **`src/components/pwa/OfflineIndicator.tsx`**
   - Manual sync trigger (`lines 73–96`)
7. **`supabase/migrations/20261016000100_myret_cloud_persistence.sql`**
   - `public.upsert_daily_record_hierarchy()` (`lines 565–678`)

---

## 2. Existing Save-and-Synchronization Flow for Daily Records

### A. UI & Local Storage Save Flow
1. **Opening an Existing Record (`DailyRecordModal.tsx`, lines 104–138)**:
   - When `recordToEdit` is passed, `DailyRecordModal` clones `recordToEdit.categories`, preserving existing category UUIDs (`cat.id || generateUUID()`, line 130) and existing expense item UUIDs (`item.id || generateUUID()`, line 121).
2. **Performing Ordinary Operations in the Modal**:
   - **Editing an expense item (`handleItemChange`, lines 151–177)**: Updates `description`, `quantity`, `rate`, and calculated `amount` in place on `updatedCats[catIndex].items[itemIndex]`, preserving `item.id`.
   - **Adding an expense item (`handleAddItem`, lines 179–189)**: Appends a new item with a fresh `generateUUID()`.
   - **Deleting an expense item (`handleDeleteItem`, lines 191–211)**: Removes the item via `splice(itemIndex, 1)` (or resets the last row to an empty item with a new UUID, which `handleSubmit` filters out if left blank).
   - **Saving the daily record (`handleSubmit`, lines 277–322)**: Filters out empty rows, computes category `subtotal` and `finalDailyTotal`, constructs a `DailyRecord` preserving `id: recordToEdit?.id || generateUUID()`, sets `updatedAt: new Date().toISOString()` and `syncStatus: 'pending'`, and invokes `onSave(record)` $\rightarrow$ `storage.saveDailyRecord(record)`.
3. **Persisting in `storage.saveDailyRecord()` (`src/utils/storage.ts`, lines 598–699)**:
   - Locates the existing record in `myret_daily_records` by `existingByIdIndex` (`line 621`) or by matching `(retirementId, normalizedDate)` (`sameDateIndex`, `lines 622–627`).
   - For an in-place edit on the same date (`lines 658–677`), sets:
     ```typescript
     record.baseUpdatedAt =
       prev.syncStatus === 'synced' ? prev.baseUpdatedAt || prev.updatedAt : prev.baseUpdatedAt;
     ```
   - Writes the updated array to `localStorage` and triggers:
     ```typescript
     globalSyncTrigger('UPSERT_DAILY_RECORD', savedRecord.id, savedRecord, savedRecord.retirementId);
     ```

### B. Synchronization Flow (Online vs. Offline/Reload)
1. **Immediate Online Push (`syncService.enqueue` $\rightarrow$ `processQueue`)**:
   - When the user is online (`navigator.onLine === true`), `syncService.enqueue()` (`src/utils/syncService.ts`, lines 170–171) immediately calls `this.processQueue()` (not `pullFromCloud()`).
   - `executeQueueItem('UPSERT_DAILY_RECORD')` (`lines 340–482`) calls `supabase.rpc('upsert_daily_record_hierarchy', ...)`.
   - In PostgreSQL (`migration lines 612–658`), `upsert_daily_record_hierarchy` deletes existing categories for `v_daily_record_id` (`ON DELETE CASCADE` removes old `expense_items`) and inserts the new categories and items from `p_categories`.
   - Upon success, `storage.markDailyRecordSynced(record.id, authoritativeRecordId, authoritativeUpdatedAt)` (`src/utils/syncService.ts`, line 474) sets `syncStatus = 'synced'` and `baseUpdatedAt = cloudUpdatedAt || records[index].updatedAt`.
2. **Cloud Pull & Merge (`syncService.pullFromCloud` $\rightarrow$ `storage.mergeCloudData` $\rightarrow$ `reconcileDailyRecordWithCloud`)**:
   - `pullFromCloud()` runs on app startup (`App.tsx`, line 99), on auth state change/session refresh (`App.tsx`, line 125), after claiming a shared retirement (`syncService.ts`, line 927), or when clicking the `Synced` badge (`OfflineIndicator.tsx`, line 89).
   - For each cloud daily record that matches a local daily record by `(retirementId, normalizeDate(date))`, `mergeCloudData()` calls `reconcileDailyRecordWithCloud(existingLocal, cloudRec)` (`src/utils/storage.ts`, line 1323).

---

## 3. How `reconcileDailyRecordWithCloud()` Evaluates Records and Items

In `src/utils/storage.ts` (`lines 994–1217`), `reconcileDailyRecordWithCloud(localRec, cloudRec)` runs three sequential stages:

1. **Guard 1 — Already-Synced Record (`lines 1006–1017`)**:
   ```typescript
   if (localRec.syncStatus !== 'pending' && localRec.id === cloudRec.id)
   ```
   Returns `cloudRec` directly as `'synced'`. No item-level comparison or conflict copy occurs.

2. **Guard 2 — Pending Local Edit When Cloud Is Unchanged (`lines 1021–1038`)**:
   ```typescript
   if (
     localRec.syncStatus === 'pending' &&
     localRec.id === cloudRec.id &&
     localRec.baseUpdatedAt &&
     localRec.baseUpdatedAt === cloudRec.updatedAt
   )
   ```
   Intended to recognize that `localRec` is a single user's pending local modification (edit, addition, or deletion) derived from `cloudRec`, returning `localRec` as-is (`needsCloudPush: true`) without running item-level conflict detection.

3. **Stage 3 — Divergent Item-Level Reconciliation (`lines 1040–1186`)**:
   Reached only when **both** Guard 1 and Guard 2 evaluate to `false`. For each `cloudItem` in a matching category:
   - **Match 1 (`lines 1100–1131`)**: Matches by `i.id === cloudItem.id`. If `description`, `quantity`, or `rate` differs (`!isIdentical`), it keeps the local item and appends a new item with `description: "${cDesc} (Cloud conflict copy)"`.
   - **Match 2 (`lines 1134–1145`)**: Matches by identical `(description, quantity, rate)` and deduplicates in place.
   - **Match 3 (`lines 1148–1173`)**: Matches by identical normalized `description` (with different `id` and different `quantity` or `rate`), keeping the local item and appending `"${cDesc} (Cloud conflict copy)"`.
   - **Match 4 (`lines 1175–1183`)**: Appends any remaining `cloudItem` not found in `localCat.items`.

---

## 4. Can Ordinary Record Operations Produce Unnecessary Conflict Copies?

### Verdict: **YES — under a specific, reproducible single-user sequence when a cloud pull runs while a local edit is still `pending`.**

While **ordinary online operations that finish pushing before the next cloud pull do NOT create conflict copies** (because `enqueue()` triggers `processQueue()` first, marking the record `'synced'` so Guard 1 succeeds on the next `pullFromCloud()`), **ordinary single-user edits and deletions DO fail Guard 2 and produce unnecessary conflict copies (or resurrect deleted items) whenever `pullFromCloud()` runs before `processQueue()` flushes the pending edit**.

---

## 5. Precise Code Evidence Supporting This Conclusion

There are **two concrete mechanisms** in the current code that combine to make Guard 2 (`localRec.baseUpdatedAt === cloudRec.updatedAt`) evaluate to `false` during normal single-user usage:

### Mechanism 1: `baseUpdatedAt` Timestamp Mismatch After `UPSERT_DAILY_RECORD`
1. **Database RPC (`supabase/migrations/20261016000100_myret_cloud_persistence.sql`, lines 660–676)**:
   When `upsert_daily_record_hierarchy` saves a daily record in PostgreSQL, it sets `daily_records.updated_at = NOW()` (the PostgreSQL server timestamp), but its return payload omits `updated_at`:
   ```sql
   UPDATE public.daily_records
   SET daily_total = v_calculated_daily_total,
       updated_at = NOW()
   WHERE id = v_daily_record_id;
   ...
   RETURN jsonb_build_object(
     'success', true,
     'daily_record_id', v_daily_record_id,
     'record_date', p_record_date,
     'daily_total', v_calculated_daily_total,
     'version', v_current_version
   );
   ```
2. **Client Queue Handler (`src/utils/syncService.ts`, lines 345, 367–369, 474)**:
   ```typescript
   let authoritativeUpdatedAt = record.updatedAt || new Date().toISOString();
   ...
   if (rpcData.updated_at) {
     authoritativeUpdatedAt = String(rpcData.updated_at);
   }
   ...
   storage.markDailyRecordSynced(record.id, authoritativeRecordId, authoritativeUpdatedAt);
   ```
   Because `rpcData.updated_at` is always `undefined`, `authoritativeUpdatedAt` remains the **client-generated** ISO timestamp (`record.updatedAt`), whereas the row in Supabase `public.daily_records` stores the **server-generated** `NOW()` timestamp.
3. **Resulting State in `localStorage`**:
   After a user creates or edits a daily record online and it syncs via the RPC, `localRec.baseUpdatedAt` holds the client timestamp `T_client`, while `cloudRec.updatedAt` in Supabase holds the server timestamp `T_server` (`T_client !== T_server`).

### Mechanism 2: `App.tsx` Calls `pullFromCloud()` Before `processQueue()` on App Load and Auth Events
In `src/App.tsx` (`lines 99–102` and `125–128`):
```typescript
// Pull cloud data and process pending queue in background
syncService.pullFromCloud().then(() => {
  if (mounted) refreshRetirements();
  syncService.processQueue();
});
```
Whenever the user:
- Edits an existing expense item (or deletes an expense item) while offline (or before the queue finishes flushing), **and**
- Reloads/reopens the PWA once back online (or triggers `onAuthStateChange` on reconnect/token refresh),

`syncService.pullFromCloud()` executes **before** `syncService.processQueue()`.

### Resulting Behaviour for Each Ordinary Operation Under This Sequence
When `pullFromCloud()` runs while the user's edit is still `'pending'` and `localRec.baseUpdatedAt !== cloudRec.updatedAt`:
1. **Editing an Existing Expense Item (Quantity, Rate, or Description)**:
   - Guard 1 is `false` (`localRec.syncStatus === 'pending'`).
   - Guard 2 is `false` (`localRec.baseUpdatedAt !== cloudRec.updatedAt`).
   - In Stage 3, `cloudItem` (the old pre-edit version still in Supabase) matches `localItem` (the user's new edit) by `i.id === cloudItem.id` (**Match 1**, `src/utils/storage.ts`, lines 1100–1131).
   - Because `!isIdentical` is `true`, `reconcileDailyRecordWithCloud()` keeps the user's edited item **and appends the old pre-edit cloud version as `"${cDesc} (Cloud conflict copy)"`**, adding both amounts into `cat.subtotal` and `record.dailyTotal`.
2. **Deleting an Expense Item**:
   - The deleted item is no longer in `localCat.items`, but is still in `cloudCat.items` because the pending local save has not been pushed yet.
   - When Guard 2 fails, Stage 3 reaches **Match 4** (`src/utils/storage.ts`, lines 1175–1183) and **re-adds the deleted item from `cloudCat.items` back into `localCat.items`**, undoing the user's deletion.
3. **Adding an Expense Item**:
   - If the added item has a new UUID and a distinct description, existing items match identically in Match 1 (`isIdentical === true`) and the added item is preserved without creating a conflict copy.
   - If the user adds a second item in the same category with the exact same description as an existing item in that category (e.g., two `"Cement"` rows with different quantities or rates), **Match 3** (`lines 1148–1173`) matches on `i.description.trim().toLowerCase() === cDesc.toLowerCase()` and appends a `(Cloud conflict copy)`.

---

## 6. Conclusion: Is a Correction Genuinely Necessary?

**YES — a targeted correction is genuinely necessary.**

### Why:
1. **Confirmed Single-User Defect on Offline Edit + App Reopen/Refresh**:
   Because `upsert_daily_record_hierarchy` does not return `updated_at` (causing `localRec.baseUpdatedAt` to store the client timestamp instead of the server `updated_at`), and because `App.tsx` runs `pullFromCloud()` before `processQueue()`, an ordinary single-user edit or item deletion made offline followed by reopening/refreshing the app online bypasses Guard 2 (`localRec.baseUpdatedAt === cloudRec.updatedAt`). This causes:
   - An ordinary item edit to duplicate its own previous version as `" (Cloud conflict copy)"` and double-count the expense in daily and PDF totals.
   - An ordinary item deletion to have the deleted item re-inserted from the cloud during merge.
2. **Match 3 Description-Only Conflict Trigger**:
   Matching items with different UUIDs solely by description (`Match 3`, lines 1148–1173) treats legitimate distinct line items that share a common description in the same category (or an item edited before initial cloud sync) as conflicts and inflates totals.
