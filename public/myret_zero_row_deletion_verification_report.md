# Focused Verification: `DELETE_RETIREMENT` Sync Handler & Tombstone Trigger

Here is the complete, read-only verification of `src/utils/syncService.ts` and `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` answering all four questions with code evidence.

---

### 1. When `DELETE_RETIREMENT` deletes a retirement that exists in Supabase, does the database `AFTER DELETE` trigger create the tombstone before the operation completes?

**Answer: Yes.**

**Code Evidence (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`, lines 37–56):**
```sql
CREATE OR REPLACE FUNCTION public.record_deleted_retirement_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.deleted_retirements (retirement_id, code, owner_id, deleted_at)
  VALUES (OLD.id, OLD.code, OLD.owner_id, TIMEZONE('utc'::text, NOW()))
  ON CONFLICT (retirement_id) DO UPDATE SET
    deleted_at = EXCLUDED.deleted_at;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_retirement_permanently_deleted ON public.retirements;
CREATE TRIGGER on_retirement_permanently_deleted
  AFTER DELETE ON public.retirements
  FOR EACH ROW EXECUTE FUNCTION public.record_deleted_retirement_tombstone();
```

* **Established by Static SQL Inspection:** `on_retirement_permanently_deleted` is a standard (non-constraint, non-deferred) PostgreSQL `AFTER DELETE ... FOR EACH ROW` trigger. In PostgreSQL, row-level `AFTER DELETE` triggers run synchronously inside the same transaction as the `DELETE` statement before the statement finishes and before PostgREST commits the transaction and returns the HTTP response to `await supabase.from('retirements').delete().eq('id', id)`. If the tombstone insert fails, the entire `DELETE` transaction rolls back and returns an error.
* **Requires Live Database Verification:** Confirming that the incremental migration (`20261017000100_fix_permanent_deletion_resurrection.sql`) has been applied to the live Supabase database so the trigger is active in production.

---

### 2. When another device has already deleted the retirement, the second `DELETE` affects zero rows, and no database error is returned, does the client verify that a tombstone exists before marking the queue operation complete?

**Answer: No.**

**Code Evidence (`src/utils/syncService.ts`, lines 488–500 & 327–331):**
```ts
      case 'DELETE_RETIREMENT': {
        const { id } = item.payload || {};
        if (!id) {
          throw new Error('Cannot delete retirement: missing retirement ID in queue payload');
        }

        const { error } = await supabase.from('retirements').delete().eq('id', id);
        if (error && error.code !== 'PGRST116') {
          throw error;
        }
        this.purgeQueueForRetirement(id, true);
        break;
      }
```
And in `processQueue()` (`src/utils/syncService.ts`, lines 327–331):
```ts
      try {
        await this.executeQueueItem(item, session.user.id);
        // Successful: remove from active queue
        this.queue = this.queue.filter((q) => q.id !== item.id);
        this.saveQueue();
```

* **Established by Static Code Inspection:** The `DELETE_RETIREMENT` handler neither chains `.select()` to check the number of deleted rows nor queries `deleted_retirements` (e.g., via `this.isRetirementTombstonedInCloud(id)`) when zero rows are deleted. As long as `error` is null, `executeQueueItem` returns normally and `processQueue()` removes the item from `this.queue`.

---

### 3. If no tombstone exists after a zero-row `DELETE`, does the client preserve/retry the queued operation or incorrectly mark it successful?

**Answer: The client marks the queued operation successful and removes it from the queue without retrying.**

**Code Evidence (`src/utils/syncService.ts`, lines 328–331 & 494–499):**
* Because a zero-row `DELETE` in PostgREST returns HTTP `200`/`204` with `error: null`, `executeQueueItem` does not throw an error.
* `processQueue()` immediately executes `this.queue = this.queue.filter((q) => q.id !== item.id);` (line 330) and persists the queue (`this.saveQueue()`), permanently discarding the `DELETE_RETIREMENT` queue item.

**Impact Analysis of Zero-Row `DELETE` Outcomes:**
1. **Already deleted by another device (after trigger installation):** The first device's `DELETE` already fired `on_retirement_permanently_deleted` and wrote the tombstone. Removing the second device's queue item is safe.
2. **Never-synced local retirement:** If a retirement was created offline, moved to Trash, and permanently deleted before ever syncing to Supabase, zero rows exist in `retirements` and no tombstone exists in `deleted_retirements`. Because no other device ever received the retirement, no tombstone is needed.
3. **Defect cases where marking it complete is unsafe:**
   - **Silent RLS filtering / non-owner or stale auth context:** Under RLS (`CREATE POLICY "Owners can delete their retirements" ON public.retirements FOR DELETE TO authenticated USING (owner_id = auth.uid());`), if `DELETE` affects `0` rows because the row was filtered out by RLS while still existing in `public.retirements`, PostgREST returns `0` rows deleted and `error: null`. The client falsely marks `DELETE_RETIREMENT` complete even though the retirement was **not** deleted and no tombstone was created.
   - **Pre-trigger deletion:** If a retirement was deleted before the `AFTER DELETE` trigger existed on the live database, `0` rows are deleted and no tombstone exists in `deleted_retirements`.

---

### 4. Is excluding error code `PGRST116` necessary for the exact current `.delete().eq('id', id)` query? Explain based on the actual query and Supabase/PostgREST response behavior.

**Answer: No — excluding `PGRST116` is unnecessary for `.delete().eq('id', id)`.**

**Explanation based on the actual query and PostgREST behavior:**
* **How `PGRST116` is triggered:** PostgREST returns error code `PGRST116` (`"JSON object requested, multiple (or no) rows returned"`) **only** when the request includes `Accept: application/vnd.pgrst.object+json`, which `@supabase/postgrest-js` only sends when `.single()` is chained onto the query builder.
* **Actual query (`src/utils/syncService.ts`, line 494):**
  ```ts
  const { error } = await supabase.from('retirements').delete().eq('id', id);
  ```
  Because `.single()` is not chained on this query, PostgREST executes a standard bulk/filtered `DELETE` (`Prefer: return=minimal`). Whether `0`, `1`, or multiple rows match `.eq('id', id)`, PostgREST returns `204 No Content` with `error: null` and **never** produces `PGRST116`.

---

### Summary of Static Inspection vs. Live Database Testing

| Finding | Established By |
| :--- | :--- |
| `on_retirement_permanently_deleted` runs synchronously inside the `DELETE` transaction before returning to the client | **Static SQL Inspection** (`20261017000100_fix_permanent_deletion_resurrection.sql`, lines 37–56) |
| Client does not check affected row count or verify tombstone existence on a zero-row `DELETE` | **Static Code Inspection** (`src/utils/syncService.ts`, lines 488–500) |
| Zero-row `DELETE` with no tombstone still removes `DELETE_RETIREMENT` from `this.queue` as successful | **Static Code Inspection** (`src/utils/syncService.ts`, lines 328–331, 494–499) |
| `error.code !== 'PGRST116'` is dead code for `.delete().eq('id', id)` without `.single()` | **Static Code Inspection** (`src/utils/syncService.ts`, line 494) + PostgREST specification |
| Whether the `AFTER DELETE` trigger is currently active on the live project and whether any retirements were deleted prior to applying the migration | **Requires Live Database Testing** |

---

### Recommended Smallest Safe Correction (Not Implemented)

To prevent a zero-row `DELETE` from falsely marking `DELETE_RETIREMENT` complete when the row still exists in Supabase (or when a previously synced retirement was not tombstoned), update `case 'DELETE_RETIREMENT'` in `src/utils/syncService.ts` (lines 494–499):

```ts
        const { data: deletedRows, error } = await supabase
          .from('retirements')
          .delete()
          .eq('id', id)
          .select('id');
        if (error) {
          throw error;
        }

        // If 0 rows were deleted, verify the retirement is no longer present in cloud
        if (!deletedRows || deletedRows.length === 0) {
          const { data: existingRow, error: checkError } = await supabase
            .from('retirements')
            .select('id')
            .eq('id', id)
            .maybeSingle();
          if (checkError) {
            throw checkError;
          }
          if (existingRow) {
            throw new Error(
              `Permanent deletion of retirement ${id} affected 0 rows while record still exists in cloud.`
            );
          }
        }

        this.purgeQueueForRetirement(id, true);
        break;
```

**Why this is minimal and safe:**
1. Removes the redundant `error.code !== 'PGRST116'` check.
2. Uses `.select('id')` on the `DELETE` so the client knows whether a row was actually deleted (and thus whether the `AFTER DELETE` trigger fired in that transaction).
3. If `0` rows were deleted, checks whether the retirement row still exists in `public.retirements`:
   - If it **still exists**, throws an error so the queue item is **preserved and retried** rather than silently dropped.
   - If it **does not exist** (because another device already deleted it and created the tombstone via trigger, or because it was a local-only retirement that never synced to Supabase), it safely completes and purges the queue for that retirement.
