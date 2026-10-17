# Targeted `DELETE_RETIREMENT` Correction Implementation Report

The targeted `DELETE_RETIREMENT` correction has been implemented in `src/utils/syncService.ts` and validated with TypeScript lint and a production build.

---

## Summary of Code Changes (`src/utils/syncService.ts`)

### 1. Record Sync History Before Purging Queue (`enqueue`, lines 126–148 & 160–173)
- When `DELETE_RETIREMENT` is enqueued (which happens in `storage.permanentlyDelete` and `storage.cleanupExpiredTrash` before the local retirement is removed from `localStorage`), `enqueue()` inspects `storage.getRetirementById(entityId)` and any existing queue items for that retirement **before** `purgeQueueForRetirement(entityId, true)` removes superseded operations.
- It persists `hasSyncedToCloud: boolean` inside the `DELETE_RETIREMENT` queue item payload (`true` if the retirement has ever synced or if no local record exists and `hasSyncedToCloud` was not explicitly `false`; `false` if the retirement was created offline and never synced to Supabase).
- If a `DELETE_RETIREMENT` item for the same `entityId` is already in the queue (including one previously marked `'failed'`), it coalesces the item and resets its status to `'pending'`.

```ts
if (type === 'DELETE_RETIREMENT') {
  const localRet = storage.getRetirementById(entityId);
  const queuedHasSynced = this.queue.some(
    (item) =>
      (item.entityId === entityId || item.retirementId === entityId) &&
      (item.payload?.hasSyncedToCloud === true ||
        (item.type === 'UPSERT_RETIREMENT' &&
          item.payload &&
          storage.hasRetirementEverSynced(item.payload)))
  );
  const hasSyncedToCloud =
    payload?.hasSyncedToCloud === true ||
    queuedHasSynced ||
    (localRet
      ? storage.hasRetirementEverSynced(localRet)
      : payload?.hasSyncedToCloud === false
        ? false
        : true);
  payload = {
    ...payload,
    hasSyncedToCloud,
  };
  this.purgeQueueForRetirement(entityId, true);
}
```

### 2. Persist Retry Metadata on Queue Failure (`processQueue`, lines 376–380)
- Added `this.saveQueue()` in the `catch` block of `processQueue()` so updated `retryCount`, `lastError`, and `status` values are durably persisted to `localStorage` whenever a queue operation throws an error.

```ts
item.retryCount += 1;
item.lastError = errMsg;
item.status = item.retryCount >= 5 ? 'failed' : 'pending';
failedItems.push(item);
this.saveQueue();
```

### 3. Verify Affected Rows & Cloud Tombstone in `DELETE_RETIREMENT` (`executeQueueItem`, lines 514–548)
- Removed the unnecessary `error.code !== 'PGRST116'` exception so all genuine PostgREST, database, and network errors are thrown and keep the queue item retryable.
- Chained `.select('id')` onto `.from('retirements').delete().eq('id', id)` so PostgREST returns `Prefer: return=representation` with the array of deleted row IDs.
- **When `deletedCount > 0`:** The row existed and was deleted by this request; PostgreSQL's `AFTER DELETE` trigger (`public.handle_retirement_deleted`) executes in the same transaction to write the authoritative tombstone in `public.deleted_retirements`.
- **When `deletedCount === 0` and `hasEverSynced === false`:** The retirement was created offline and never uploaded to Supabase. The zero-row deletion is treated as a complete no-op in the cloud without requiring or creating a cloud tombstone, and the queue item is removed.
- **When `deletedCount === 0` and `hasEverSynced === true` (including legacy queued items without `hasSyncedToCloud`):** The client calls `this.isRetirementTombstonedInCloud(id)` (`SELECT id FROM public.deleted_retirements WHERE id = id MAYBE SINGLE`).
  - If a tombstone is found (`isTombstoned === true`), the retirement was already permanently deleted by another device; the operation completes idempotently and is removed from the queue.
  - If no tombstone is found (`isTombstoned === false`, including when RLS hid the row or the tombstone lookup failed), `executeQueueItem` throws an error so the queue item is preserved for retry rather than silently discarded.

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
    const isTombstoned = await this.isRetirementTombstonedInCloud(id);
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

## Behavior Across Scenarios

| Scenario | `deletedCount` | `hasEverSynced` | Tombstone Check | Outcome |
| :--- | :---: | :---: | :---: | :--- |
| **1. First deletion of an existing cloud retirement** | `1` | `true` | Not needed (trigger runs in same transaction) | Succeeds; DB `AFTER DELETE` trigger inserts tombstone; queue item removed. |
| **2. Second deletion after another device already deleted it** | `0` | `true` | `isRetirementTombstonedInCloud(id)` returns `true` | Succeeds idempotently; queue item removed. |
| **3. Zero-row deletion where no tombstone exists (e.g., RLS hid row or deletion did not occur)** | `0` | `true` | `isRetirementTombstonedInCloud(id)` returns `false` | Throws error; queue item retained and persisted for retry. |
| **4. Deletion of an offline-only retirement never uploaded to Supabase** | `0` | `false` | Skipped | Succeeds cleanly without creating cloud records; queue item removed. |
| **5. Transient network or database error during delete** | N/A (`error !== null`) | Either | Not reached | Throws `error`; queue item retained and persisted for retry. |

---

## Validation Results

- **TypeScript Lint (`npm run lint` / `tsc --noEmit`):** Passed with zero errors.
- **Production Build (`npm run build`):** Succeeded cleanly.

---

## Dependencies & Assumptions

- **Incremental Migration Dependency:** Scenario 2 (idempotent completion of a repeated delete across devices) and Scenario 1 (automatic tombstone creation on delete) require the incremental migration `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` to be applied to the live Supabase database so that `public.deleted_retirements`, its `SELECT` RLS policy/grant for `authenticated`, and the `on_retirement_permanently_deleted` `AFTER DELETE` trigger exist.
- **Pre-Migration Deletions:** If a previously synchronized retirement was already deleted from `public.retirements` *before* the incremental migration's `AFTER DELETE` trigger was installed on the live database, a subsequent zero-row `DELETE_RETIREMENT` from another stale device will find neither a row to delete nor a tombstone in `public.deleted_retirements`, and will retain the queued deletion item rather than silently discarding it.
