# Final Read-Only Review: Permanent-Deletion Resurrection Fix Migration

**Files Reviewed (Read-Only):**
1. `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` (`124 lines`, `4,688 bytes`)
2. `public/myret_fix_permanent_deletion_resurrection.sql` (`124 lines`, `4,688 bytes`)
3. `supabase/migrations/20261016000100_myret_cloud_persistence.sql` (`786 lines`, `32,515 bytes` — baseline reference)
4. `src/utils/syncService.ts` (client query compatibility reference)

No files were modified, created, formatted, or deleted during the review, and no SQL was executed against Supabase.

---

## 1. Overall Verdict & Section Summary Table

**Overall Verdict:** **PASS**

| Section | Review Area | Verdict | Summary |
| :--- | :--- | :--- | :--- |
| **A** | Migration Safety and Order | **PASS** | Fully idempotent DDL, safe dependency ordering, preserves all existing data and dependent policies, and does not require rerunning the baseline migration. |
| **B** | Tombstone Table and Access Control | **PASS** | `public.deleted_retirements` has `UUID PRIMARY KEY`, RLS enabled, `REVOKE ALL` from `PUBLIC, anon, authenticated`, `GRANT SELECT` only to `authenticated`, and trigger-only writes via `SECURITY DEFINER`. |
| **C** | Permanent-Deletion Trigger | **PASS** | `AFTER DELETE` trigger atomically records `(OLD.id, OLD.code, OLD.owner_id)` in the same transaction, handles conflicts idempotently, and is reachable via the owner's `DELETE ... RETURNING id` query under `retirements` RLS. |
| **D** | Resurrection-Prevention Trigger | **PASS** | `BEFORE INSERT OR UPDATE` trigger checks `deleted_retirements` by `UUID` primary key and raises SQLSTATE `P0002` (`PERMANENTLY_DELETED`), blocking both `.insert()` and `.upsert()` recreation paths. |
| **E** | RLS and Helper Functions | **PASS** | `CREATE OR REPLACE FUNCTION` preserves exact signatures (`(p_ret_id UUID) RETURNS BOOLEAN`), grants owner access while `status IN ('active', 'in_trash')`, and restricts `REVIEWER` collaborators strictly to `status = 'active'`. |
| **F** | Deployment Copy Consistency | **PASS** | Byte-for-byte identical (`124 lines`, `4,688 bytes`, SHA-256: `ac47d3aeae542b5a4a2383063e99b92d5b7ae13373b6a249007df2d5ad3ad55d`). |

---

## 2. Detailed Section-by-Section Review

### A. Migration Safety and Order — **PASS**
- **Incremental Compatibility with Live Baseline:**
  - References only objects already created by the live baseline (`20261016000100_myret_cloud_persistence.sql`): `public.profiles(id)` (`baseline line 21`), `public.retirements` (`baseline lines 47–58`), `public.retirement_access` (`baseline lines 66–73`), and `auth.uid()`.
  - Does **not** require rerunning `20261016000100_myret_cloud_persistence.sql`.
- **Safe Ordering and Repeatability:**
  1. `CREATE TABLE IF NOT EXISTS public.deleted_retirements` (`lines 13–18`) precedes index creation (`line 20`), `ENABLE ROW LEVEL SECURITY` (`line 22`), policy drops/creations (`lines 25–31`), and table privilege revocations/grants (`lines 33–34`).
  2. `CREATE OR REPLACE FUNCTION public.record_deleted_retirement_tombstone()` (`lines 37–50`) precedes `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER on_retirement_permanently_deleted` (`lines 52–55`).
  3. `CREATE OR REPLACE FUNCTION public.prevent_deleted_retirement_resurrection()` (`lines 57–73`) precedes `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER before_retirement_upsert_check_deleted` (`lines 75–78`).
  4. `CREATE OR REPLACE FUNCTION public.current_user_has_retirement_access(p_ret_id UUID)` (`lines 81–102`) and `public.current_user_is_retirement_owner(p_ret_id UUID)` (`lines 104–117`) preserve their exact parameter name (`p_ret_id`), parameter type (`UUID`), and return type (`BOOLEAN`) from `baseline lines 160–197`, so PostgreSQL replaces their bodies in-place without invalidating or requiring recreation of any dependent RLS policies on `profiles`, `retirements`, `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, or `connected_retirements`.
- **Zero Data Loss:**
  - Contains no `DROP TABLE`, `TRUNCATE`, `DELETE`, or column-dropping statements.

---

### B. Tombstone Table and Access Control — **PASS**
- **Table Schema (`lines 13–20`):**
  - `retirement_id UUID PRIMARY KEY` (`line 14`): Matches `public.retirements.id UUID PRIMARY KEY` (`baseline line 48`) and intentionally omits a foreign key to `public.retirements(id)` so the tombstone persists after the retirement row is deleted.
  - `code VARCHAR(12)` (`line 15`): Matches `public.retirements.code VARCHAR(12)` (`baseline line 49`); nullable and non-unique so tombstone creation cannot fail on code collisions.
  - `owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL` (`line 16`): Matches `public.retirements.owner_id` (`baseline line 52`), indexed via `idx_deleted_retirements_owner` (`line 20`).
  - `deleted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL` (`line 17`).
- **RLS & Table Grants (`lines 22–34`):**
  - RLS is enabled (`ALTER TABLE public.deleted_retirements ENABLE ROW LEVEL SECURITY;` at `line 22`).
  - Legacy client write policies `"Owners can insert deleted retirement tombstones"` and `"Owners can update deleted retirement tombstones"` are explicitly dropped (`lines 25–26`).
  - Table privileges are locked down via:
    ```sql
    REVOKE ALL ON TABLE public.deleted_retirements FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.deleted_retirements TO authenticated;
    ```
    (`lines 33–34`).
  - `PUBLIC` and `anon` have zero access. `authenticated` has `SELECT` privilege only and cannot `INSERT`, `UPDATE`, or `DELETE` rows in `public.deleted_retirements` (preventing any forged tombstone or tombstone tampering).
- **Trigger Write Authority (`lines 37–50`):**
  - `public.record_deleted_retirement_tombstone()` is `SECURITY DEFINER` (`line 40`) with `SET search_path = public, pg_temp` (`line 41`). When created by the database owner role in the Supabase SQL Editor, it runs with owner privileges and `BYPASSRLS`, allowing it to insert/update tombstones in `public.deleted_retirements` even though `authenticated` has only `SELECT`.
- **SELECT Policy & Client Query Compatibility (`lines 28–31`, `src/utils/syncService.ts:258–262`, `902–904`):**
  - Policy `"Users can view deleted retirement tombstones"` (`FOR SELECT TO authenticated USING (true)`, `lines 29–31`) allows both the owner (across devices) and read-only collaborators (`REVIEWER`s) to detect tombstoned retirement IDs during `isRetirementTombstonedInCloud()` (`.select('retirement_id').eq('retirement_id', retirementId).maybeSingle()`) and `pullFromCloud()` (`.select('retirement_id')`).
  - Because `retirement_id` is the `PRIMARY KEY`, `.eq('retirement_id', id).maybeSingle()` returns at most one row (`{ data: { retirement_id: id }, error: null }` or `{ data: null, error: null }`).

---

### C. Permanent-Deletion Trigger — **PASS**
- **Trigger & Function (`lines 37–55`):**
  - `on_retirement_permanently_deleted` fires `AFTER DELETE ON public.retirements FOR EACH ROW EXECUTE FUNCTION public.record_deleted_retirement_tombstone()` (`lines 53–55`).
  - Inserts `(OLD.id, OLD.code, OLD.owner_id, TIMEZONE('utc'::text, NOW()))` (`lines 44–45`), which match the exact column names and types of `public.retirements` (`baseline lines 48–52`).
- **Trash Bin vs. Permanent Deletion:**
  - Moving a retirement to the Trash Bin executes an `UPDATE` on `public.retirements` (`status = 'in_trash'`, `deleted_at = ...`), which does **not** fire `AFTER DELETE`. The trigger fires only when the row is permanently deleted via `DELETE FROM public.retirements`.
- **Transactional Atomicity & Idempotency:**
  - Because `AFTER DELETE ... FOR EACH ROW` runs inside the same database transaction as the `DELETE`, the retirement deletion and tombstone insertion succeed or roll back together.
  - `ON CONFLICT (retirement_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at` (`lines 46–47`) handles pre-existing tombstones idempotently without raising `23505`.
- **Reachability from Client `DELETE` Request (`src/utils/syncService.ts:559–563`):**
  - Client executes `supabase.from('retirements').delete().eq('id', id).select('id')` (`DELETE FROM public.retirements WHERE id = $1 RETURNING id`).
  - Under `20261016000100_myret_cloud_persistence.sql`, `authenticated` has `GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirements` (`baseline line 777`), `FOR DELETE` policy `"Owners can delete their retirements"` (`USING (owner_id = auth.uid())`, `baseline lines 275–277`), and `FOR SELECT` policy `"Users can view retirements they own or have access to"` (`USING (owner_id = auth.uid() OR ...)`, `baseline lines 256–261`).
  - Therefore, an authenticated owner can delete their retirement (whether `status` is `'active'` or `'in_trash'`), receive the deleted row's `id` back via `RETURNING id`, and activate `on_retirement_permanently_deleted` in the same transaction.

---

### D. Resurrection-Prevention Trigger — **PASS**
- **Trigger & Function (`lines 57–78`):**
  - `before_retirement_upsert_check_deleted` fires `BEFORE INSERT OR UPDATE ON public.retirements FOR EACH ROW EXECUTE FUNCTION public.prevent_deleted_retirement_resurrection()` (`lines 76–78`).
  - Checks `IF EXISTS (SELECT 1 FROM public.deleted_retirements WHERE retirement_id = NEW.id)` (`lines 64–67`), comparing `UUID = UUID` against the primary key of `public.deleted_retirements`.
  - If a tombstone exists, it raises an exception (`lines 68–69`):
    ```sql
    RAISE EXCEPTION 'PERMANENTLY_DELETED: Retirement % was permanently deleted and cannot be recreated', NEW.id
      USING ERRCODE = 'P0002';
    ```
- **No Bypass via `.upsert()` or `.update()`:**
  - In PostgreSQL, `INSERT ... ON CONFLICT DO UPDATE` (used by PostgREST `.upsert()`) always fires `BEFORE INSERT` triggers prior to conflict resolution and `BEFORE UPDATE` triggers on conflict update. Direct `.insert()` and `.update()` also fire the trigger.
  - Unrelated retirements (`NEW.id` not in `public.deleted_retirements`) return `NEW` (`line 71`) and are unaffected.
  - Client `syncService.isPermanentlyDeletedError()` (`src/utils/syncService.ts:242–251`) explicitly matches `code === 'P0002'` and `'permanently_deleted'`, purging the stale local copy cleanly.

---

### E. RLS and Helper Functions — **PASS**
- **Helper 1 — `public.current_user_has_retirement_access(p_ret_id UUID)` (`lines 81–102`, `119–120`):**
  - Signature: `(p_ret_id UUID) RETURNS BOOLEAN`, `LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp`.
  - Logic:
    - Returns `TRUE` for the owner (`owner_id = auth.uid()`) when `status IN ('active', 'in_trash')` (`line 92`).
    - Returns `TRUE` for a collaborator (`user_id = auth.uid()` in `public.retirement_access`) **only** when `status = 'active'` (`lines 94–99`).
- **Helper 2 — `public.current_user_is_retirement_owner(p_ret_id UUID)` (`lines 104–117`, `122–123`):**
  - Signature: `(p_ret_id UUID) RETURNS BOOLEAN`, `LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp`.
  - Logic:
    - Returns `TRUE` only when `id = p_ret_id AND status IN ('active', 'in_trash') AND owner_id = auth.uid()` (`lines 113–115`).
- **Effect on Baseline Policies (`20261016000100_myret_cloud_persistence.sql:255–401`):**
  - Primary owners retain full `SELECT` and modification access to `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, and `connected_retirements` while a retirement is in the Trash Bin (`status = 'in_trash'`) during the 48-hour recovery window.
  - Read-only `REVIEWER` collaborators cannot see or access any retirement or child record whose `status = 'in_trash'`, and can never modify any retirement or child record.
  - Cross-owner access remains impossible because `owner_id = auth.uid()` is strictly enforced for all write policies and `in_trash` visibility.

---

### F. Deployment Copy Consistency — **PASS**
- **Files Compared:**
  1. `supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`
  2. `public/myret_fix_permanent_deletion_resurrection.sql`
- **Verification Results:**
  - **Byte Count:** `4,688 bytes` each (`124 lines` each)
  - **SHA-256 Checksum (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql`):**
    `ac47d3aeae542b5a4a2383063e99b92d5b7ae13373b6a249007df2d5ad3ad55d`
  - **SHA-256 Checksum (`public/myret_fix_permanent_deletion_resurrection.sql`):**
    `ac47d3aeae542b5a4a2383063e99b92d5b7ae13373b6a249007df2d5ad3ad55d`
  - **Result:** **Byte-for-byte identical.**

---

## 3. Classified Findings

- **Critical:** None (`0`)
- **High:** None (`0`)
- **Medium:** None (`0`)
- **Low:** None (`0`)
- **Informational:**
  1. **[Informational] Broad `SELECT` Visibility on `public.deleted_retirements` (`lines 29–31`):**
     - `CREATE POLICY "Users can view deleted retirement tombstones" ON public.deleted_retirements FOR SELECT TO authenticated USING (true);` allows any authenticated user to read rows in `public.deleted_retirements` (`retirement_id`, `code`, `owner_id`, `deleted_at`). This is intentional so both owners and former `REVIEWER` collaborators (whose `retirement_access` rows were cascade-deleted when the retirement was deleted) can see tombstones and prune stale local copies. No financial data, descriptions, titles, or emails are stored in `deleted_retirements`, and client writes are completely revoked (`lines 33–34`).
  2. **[Informational] Pre-Existing Baseline File Copy in Repo (`supabase/migrations/20261016000100_myret_cloud_persistence.sql:409–418, 784`):**
     - The repository copy of `20261016000100_myret_cloud_persistence.sql` still contains the older `INSERT`/`UPDATE` policies and grants on `deleted_retirements`. Because the baseline migration was already applied to the live database and will not be rerun, and because `20261017000100_fix_permanent_deletion_resurrection.sql` (`lines 25–26, 33–34`) explicitly drops those policies and revokes `INSERT`/`UPDATE`/`DELETE` from `authenticated`, this does not affect applying the incremental migration to the live project.

---

## 4. Blockers & Final Deployment Statement

- **Concrete Blockers:** **None.**
- **Deployment Readiness:** The incremental migration (`supabase/migrations/20261017000100_fix_permanent_deletion_resurrection.sql` / `public/myret_fix_permanent_deletion_resurrection.sql`) is **READY FOR THE USER TO APPLY** in the Supabase SQL Editor. **It has NOT been applied by this review.**
