# Final Read-Only Verification Report: `src/utils/syncService.ts`

No files were modified, no SQL was executed, and no migrations were applied.

---

## Scenario Verification Results

### Scenario 1 — Offline-only retirement re-enqueued without `hasSyncedToCloud` after local record removal
- **Status:** **PASS**
- **Code References:** `src/utils/syncService.ts:126–158`, `170–196`, `220–240`
- **Verification Trace:**
  1. `existingDeleteItem` (`lines 127–129`) locates the existing queued `DELETE_RETIREMENT` item whose `payload.hasSyncedToCloud === false`.
  2. `localRet` (`line 130`) is `undefined` because the local retirement record was already removed.
  3. `queuedHasSynced` (`lines 131–138`) evaluates to `false` because no queued item for `entityId` has `hasSyncedToCloud === true` or a synced `UPSERT_RETIREMENT` payload.
  4. `hasPositiveSyncEvidence` (`lines 139–143`) evaluates to `false` (`payload?.hasSyncedToCloud === true` is `false`, `existingDeleteItem?.payload?.hasSyncedToCloud === true` is `false`, `queuedHasSynced` is `false`, `localRet` is `undefined`).
  5. `hasSyncedToCloud` (`lines 145–151`) enters the ternary false-branch and matches `existingDeleteItem?.payload?.hasSyncedToCloud === false` (`line 147`), resolving `hasSyncedToCloud = false`.
  6. `payload` (`lines 153–157`) merges `...(existingDeleteItem?.payload || {})`, `...payload`, and explicitly sets `hasSyncedToCloud: false`.
  7. `this.purgeQueueForRetirement(entityId, true)` (`line 158`, `223–225`) keeps the existing `DELETE_RETIREMENT` item.
  8. `existingIndex` (`lines 170–175`) matches the existing `DELETE_RETIREMENT` item (`type === 'DELETE_RETIREMENT'`), updates it in-place (`lines 177–196`) with `hasSyncedToCloud: false`, and does not append a duplicate item.

---

### Scenario 2 — Previously synchronized retirement re-enqueued with `{ id, hasSyncedToCloud: false }` after local record removal
- **Status:** **PASS**
- **Code References:** `src/utils/syncService.ts:126–158`, `170–196`
- **Verification Trace:**
  1. `existingDeleteItem` (`lines 127–129`) locates the queued `DELETE_RETIREMENT` item with `existingDeleteItem.payload.hasSyncedToCloud === true`.
  2. Even though the incoming `payload.hasSyncedToCloud` is `false` and `localRet` is `undefined`, `hasPositiveSyncEvidence` (`lines 139–143`) checks `existingDeleteItem?.payload?.hasSyncedToCloud === true` (`line 141`), which evaluates to `true`.
  3. `hasSyncedToCloud` (`lines 145–146`) resolves to `true`.
  4. `payload` (`lines 153–157`) sets `hasSyncedToCloud: true` AFTER spreading `...payload`, overriding the incoming `hasSyncedToCloud: false`.
  5. During coalescing (`lines 179–185`), `mergedPayload` sets `hasSyncedToCloud: payload.hasSyncedToCloud` (`true`), ensuring the resulting flag remains `true`.

---

### Scenario 3 — Legacy queued `DELETE_RETIREMENT` with no `hasSyncedToCloud` property and absent local record
- **Status:** **PASS**
- **Code References:**
  - During `executeQueueItem` -> `case 'DELETE_RETIREMENT'`: `src/utils/syncService.ts:552–557`
  - During `enqueue` (if re-enqueued): `src/utils/syncService.ts:126–157`
- **Verification Trace:**
  1. **Direct execution (`lines 552–557`):**
     - `localRet` (`line 552`) is `undefined`.
     - `item.payload?.hasSyncedToCloud === true` (`line 554`) is `false`.
     - The ternary (`lines 555–557`) takes the `: item.payload?.hasSyncedToCloud !== false` branch (`line 557`). Because `item.payload?.hasSyncedToCloud` is `undefined`, `undefined !== false` evaluates to `true`.
     - Thus `hasEverSynced` is `true`, and if `DELETE` affects `0` rows (`line 569`), it verifies the tombstone in the cloud (`line 570`) rather than assuming an offline-only deletion.
  2. **If re-enqueued (`lines 139–151`):**
     - When `existingDeleteItem.payload.hasSyncedToCloud` is `undefined`, incoming `payload.hasSyncedToCloud` is `undefined`, and `localRet` is `undefined`, `hasPositiveSyncEvidence` is `false`, and all three conditions in `lines 147–149` (`existingDeleteItem?.payload?.hasSyncedToCloud === false || payload?.hasSyncedToCloud === false || Boolean(localRet)`) are `false`, so `lines 150–151` default `hasSyncedToCloud` to `true`.

---

### Scenario 4 — Failed `DELETE_RETIREMENT` with `retryCount >= 5` is re-enqueued
- **Status:** **PASS**
- **Code References:** `src/utils/syncService.ts:127–129`, `153–158`, `170–196`, `408–412`
- **Verification Trace:**
  1. When a queue item reaches `retryCount >= 5` (`line 410`), its `status` is `'failed'` and `lastError` is populated (`line 409`).
  2. When `enqueue('DELETE_RETIREMENT', entityId, payload, entityId)` is called:
     - `existingDeleteItem` (`lines 127–129`) finds the failed `DELETE_RETIREMENT` item regardless of `status`.
     - `payload` (`lines 153–157`) preserves `...(existingDeleteItem?.payload || {})` (such as `code`, `ownerId`) and retains the resolved `hasSyncedToCloud` flag.
     - `this.purgeQueueForRetirement(entityId, true)` (`line 158`, `223–225`) retains the existing `DELETE_RETIREMENT` item.
     - `existingIndex` (`lines 170–175`) matches `item.entityId === entityId && item.type === type && (item.status === 'pending' || type === 'DELETE_RETIREMENT')`. Because `type === 'DELETE_RETIREMENT'` is explicitly allowed even when `item.status === 'failed'`, `existingIndex >= 0` is found.
     - `updatedItem` (`lines 187–195`) replaces the item at `this.queue[existingIndex]` in-place (ensuring exactly one deletion remains queued), preserves merged payload metadata and `hasSyncedToCloud` (`lines 180–185`), resets `status: 'pending'` (`line 190`), resets `retryCount: 0` (`line 191`), and executes `delete updatedItem.lastError` (`line 194`).

---

### Scenario 5 — Older `UPSERT_RETIREMENT` or child upsert exists when deletion is enqueued
- **Status:** **PASS**
- **Code References:** `src/utils/syncService.ts:131–158`, `220–240`, `379–383`; `src/utils/storage.ts:1059–1089`
- **Verification Trace:**
  1. **Preserving positive sync-history evidence before purging (`src/utils/syncService.ts:131–143`):**
     - Before `purgeQueueForRetirement` runs, `queuedHasSynced` (`lines 131–138`) scans `this.queue` for any item matching `item.entityId === entityId || item.retirementId === entityId` that has `item.payload?.hasSyncedToCloud === true` OR is an `UPSERT_RETIREMENT` where `storage.hasRetirementEverSynced(item.payload)` is `true`.
     - Furthermore, `storage.hasRetirementEverSynced()` (`src/utils/storage.ts:1059–1089`) checks `ret.hasSyncedToCloud === true || ret.syncStatus === 'synced'` (`line 1060`), and if `ret.hasSyncedToCloud` is `undefined`, checks local child `DAILY_RECORDS` (`lines 1074–1083`) and `SUPPLEMENTARY` entries (`lines 1084–1087`) for `syncStatus === 'synced'`, `Boolean(r.baseUpdatedAt)`, or `hasSyncedToCloud`. Note also that in `storage.permanentlyDelete()` (`src/utils/storage.ts:446–458`) and `storage.cleanupExpiredTrash()` (`src/utils/storage.ts:512–519`), `globalSyncTrigger('DELETE_RETIREMENT', ...)` is invoked **before** local retirement and child records are removed from `localStorage`, so `localRet` and its child records are still present when `enqueue` evaluates `storage.hasRetirementEverSynced(localRet)` (`line 143`).
  2. **Preventing older upserts from executing (`src/utils/syncService.ts:158`, `220–240`, `379–383`):**
     - `this.purgeQueueForRetirement(entityId, true)` (`line 158`) removes every queued item where `item.entityId === retirementId || item.retirementId === retirementId` (including `UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, `UPSERT_SUPPLEMENTARY`, and connection items) except `DELETE_RETIREMENT` (`lines 223–235`).
     - If `processQueue()` is already mid-loop over a snapshot `[...this.queue]` (`line 379`), the guard `if (!this.queue.some((q) => q.id === item.id)) continue;` (`lines 381–383`) skips any purged upsert item so it cannot execute and recreate the retirement.

---

### Scenario 6 — `isRetirementTombstonedInCloud(id, true)` vs. default parameter behavior
- **Status:** **PASS**
- **Code References:** `src/utils/syncService.ts:253–277`, `282`, `450`, `570–575`
- **Verification Trace:**
  1. **Successful query with no matching row (`lines 258–269`):**
     - `.maybeSingle()` (`line 262`) returns `{ data: null, error: null }`.
     - `if (error)` (`line 263`) is not entered; `Boolean(data?.retirement_id)` (`line 269`) returns `false`.
     - In `DELETE_RETIREMENT` (`lines 570–575`), `!isTombstoned` is `true`, so it throws `Error('Permanent deletion of retirement ${id} could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).')`, keeping the queue item for retry.
  2. **Successful query with a matching row (`lines 258–269`):**
     - `.maybeSingle()` returns `{ data: { retirement_id: id }, error: null }`.
     - `Boolean(data?.retirement_id)` (`line 269`) returns `true`.
     - In `DELETE_RETIREMENT` (`lines 570–579`), `if (!isTombstoned)` is skipped, `purgeQueueForRetirement(id, true)` runs, and the item completes idempotently.
  3. **Query errors and transport exceptions with `throwOnError = true` (`lines 263–273`):**
     - If PostgREST returns an `error` object (`line 263`), `if (throwOnError) throw error;` (`lines 264–266`) throws `error`, which is caught by `catch (err)` (`line 270`) and rethrown by `if (throwOnError) throw err;` (`lines 271–273`).
     - If `supabase.from(...).select(...)` throws a network/transport exception, `catch (err)` (`line 270`) catches it and rethrows it via `if (throwOnError) throw err;` (`lines 271–273`).
     - In both cases, the original error propagates out of `executeQueueItem` to `processQueue()` (`lines 389–413`), incrementing `retryCount`, recording `lastError`, and keeping the queue item retryable.
  4. **Callers using default parameter (`throwOnError = false`):**
     - `checkAndPurgeIfParentRetirementDeleted()` (`line 282`) and `UPSERT_RETIREMENT` (`line 450`) omit the second argument, defaulting `throwOnError` to `false` (`line 255`), which returns `false` on PostgREST errors (`line 267`) or thrown exceptions (`line 275`), preserving their existing non-throwing behavior.

---

## Final Recommendation

All 6 scenarios **PASS** verification. **Proceed to final migration review.**
