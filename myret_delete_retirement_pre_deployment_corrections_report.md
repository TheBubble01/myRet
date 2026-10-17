# Targeted `DELETE_RETIREMENT` Pre-Deployment Corrections Report

Only `src/utils/syncService.ts` was modified.

---

## 1. Summary of Precise Code Changes

1. **`isRetirementTombstonedInCloud(retirementId: string, throwOnError: boolean = false)` (`src/utils/syncService.ts:253–277`):**
   - Added an optional `throwOnError: boolean = false` parameter.
   - When `error` is returned by PostgREST or a network/transport exception is thrown in `try`, it rethrows the original error if `throwOnError` is `true` and returns `false` otherwise.
   - Preserves the default non-throwing behavior (`throwOnError = false`) for all other callers (`checkAndPurgeIfParentRetirementDeleted`, `UPSERT_RETIREMENT`, `UPSERT_DAILY_RECORD`, `UPSERT_SUPPLEMENTARY`, `CONNECT_RETIREMENTS`).

2. **`executeQueueItem()` — `case 'DELETE_RETIREMENT'` (`src/utils/syncService.ts:546–580`):**
   - Updated the zero-row fallback check on line `570` to call `await this.isRetirementTombstonedInCloud(id, true)` so that database, RLS/permission, or network errors during the tombstone lookup are propagated directly to `processQueue()` with their original message/code intact.
   - When the tombstone query succeeds and finds no tombstone (`isTombstoned === false`), throws `Error('Permanent deletion of retirement ${id} could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).')` (`lines 571–575`).

3. **`enqueue()` — `DELETE_RETIREMENT` Sync-History Preservation & Coalescing (`src/utils/syncService.ts:126–196`):**
   - Captures any existing `DELETE_RETIREMENT` queue entry (`existingDeleteItem`) for `entityId` (`lines 127–129`).
   - Computes `hasPositiveSyncEvidence` (`lines 139–143`) across:
     - `payload?.hasSyncedToCloud === true`
     - `existingDeleteItem?.payload?.hasSyncedToCloud === true`
     - `queuedHasSynced` (any queued operation for `entityId` whose payload has `hasSyncedToCloud === true` or passes `storage.hasRetirementEverSynced(item.payload)`)
     - `localRet ? storage.hasRetirementEverSynced(localRet) : false`
   - Computes `hasSyncedToCloud` (`lines 145–151`):
     - `true` whenever `hasPositiveSyncEvidence` is `true` (ensuring `true` can never be downgraded to `false`).
     - Otherwise `false` only when explicit never-synced evidence exists (`existingDeleteItem?.payload?.hasSyncedToCloud === false`, `payload?.hasSyncedToCloud === false`, or a present local record with no sync history `Boolean(localRet)`).
     - Otherwise `true` (conservative default when neither local state nor explicit `false` evidence exists).
   - Broadened the coalescing index lookup (`lines 170–175`) from `item.status === 'pending'` to `(item.status === 'pending' || type === 'DELETE_RETIREMENT')` so an existing `failed` `DELETE_RETIREMENT` item is coalesced in place rather than duplicated.
   - When coalescing an existing `DELETE_RETIREMENT` item (`lines 177–195`), merges payloads while preserving `hasSyncedToCloud: payload.hasSyncedToCloud`, resets `status: 'pending'`, resets `retryCount: 0`, updates `createdAt`, and clears `lastError`.

---

## 2. Final Implementation Blocks in `src/utils/syncService.ts`

### A. `enqueue()` (`lines 119–218`)
```ts
  // --- Enqueue Operations ---
  enqueue(type: SyncOperationType, entityId: string, payload: any, retirementId?: string): void {
    // If demo sample, never enqueue for cloud sync
    if (payload?.isDemo || payload?.retirement?.isDemo) {
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
        (item.status === 'pending' || type === 'DELETE_RETIREMENT')
    );

    if (existingIndex >= 0) {
      const existingItem = this.queue[existingIndex];
      const mergedPayload =
        type === 'DELETE_RETIREMENT'
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
```

### B. `isRetirementTombstonedInCloud()` (`lines 253–277`)
```ts
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
```

### C. `case 'DELETE_RETIREMENT'` (`lines 546–580`)
```ts
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
```

---

## 3. TypeScript & Production Build Verification

- **TypeScript Validation (`npm run lint` / `tsc --noEmit`):** Passed with 0 errors.
- **Production Build (`npm run build`):** Passed cleanly (`✓ built in 6.53s`).

---

## 4. Edge-Case Verification (`A`–`G`)

- **Edge Case A (Synchronized retirement deleted once):**
  - `storage.permanentlyDelete()` reads `hasRetirementEverSynced(target)` before removing local state and passes `hasSyncedToCloud: true` to `enqueue('DELETE_RETIREMENT', id, { id, hasSyncedToCloud: true }, id)`.
  - `enqueue()` sees `hasPositiveSyncEvidence === true` (`line 140`) and stores `hasSyncedToCloud: true` (`line 146`).
- **Edge Case B (Synchronized retirement deleted, then `DELETE_RETIREMENT` enqueued again after local record is gone):**
  - On the second `enqueue()`, `localRet` is `undefined` and the caller may pass `hasSyncedToCloud: false`.
  - `existingDeleteItem?.payload?.hasSyncedToCloud === true` makes `hasPositiveSyncEvidence === true` (`line 141`), so `hasSyncedToCloud` remains `true` (`line 146`) and cannot be overwritten with `false` when coalesced (`lines 179–185`).
- **Edge Case C (`DELETE_RETIREMENT` reaches `status: 'failed'` after 5 retries, then is enqueued again):**
  - `existingIndex` matches `(item.status === 'pending' || type === 'DELETE_RETIREMENT')` (`lines 170–175`).
  - Rather than appending a duplicate entry, the existing failed item is updated in place (`lines 187–195`) with `status: 'pending'`, `retryCount: 0`, `lastError` deleted, and `hasSyncedToCloud` preserved.
- **Edge Case D (Offline local-only retirement deleted before ever syncing):**
  - `localRet` has never synced (`hasRetirementEverSynced === false`), `queuedHasSynced === false`, and caller passes `hasSyncedToCloud: false`.
  - `hasPositiveSyncEvidence` is `false` (`lines 139–143`) and `payload?.hasSyncedToCloud === false` produces `hasSyncedToCloud = false` (`lines 147–150`).
  - In `DELETE_RETIREMENT`, `hasEverSynced` evaluates to `false` (`lines 553–557`), so a `0`-row delete completes cleanly without querying `deleted_retirements`.
- **Edge Case E (Tombstone query fails with network/PostgREST error after 0-row delete):**
  - `this.isRetirementTombstonedInCloud(id, true)` (`line 570`) rethrows the underlying PostgREST `error` (`line 265`) or network exception (`line 272`).
  - `processQueue()` catches the original error (`line 389`), records its actual message in `item.lastError`, increments `retryCount`, and keeps the item in the queue.
- **Edge Case F (Tombstone query succeeds and finds no row after 0-row delete for synced retirement):**
  - `this.isRetirementTombstonedInCloud(id, true)` returns `false` (`line 269`).
  - `DELETE_RETIREMENT` throws `Error('Permanent deletion of retirement ${id} could not be confirmed in cloud (0 rows deleted and no deletion tombstone found).')` (`lines 571–575`), retaining the queue operation for retry.
- **Edge Case G (Tombstone query succeeds and finds a row):**
  - `this.isRetirementTombstonedInCloud(id, true)` returns `true` (`line 269`), `executeQueueItem()` completes normally, and `processQueue()` removes the item idempotently (`line 387`).

---

## 5. Database & Migration Confirmation

- **No SQL was executed.**
- **No Supabase migration was applied or modified.**
- **No live database connection or schema/RLS/trigger change was made.**
