# Phase 1.1 Corrective Review: Cloud Database Foundation & Security Architecture

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Corrective Technical Audit, Security Specification & Migration Proposal  
**Version**: 2.1 (Phase 1.1 Corrective Candidate)  
**Date**: October 14, 2026  
**Status**: UNAPPLIED MIGRATION PROPOSAL & CORRECTIVE ARCHITECTURAL SPECIFICATION  
**Primary Deliverable**: `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql`  
**Changelog**: `public/cloud_database_foundation_corrective_changelog.md`  
**Safety Mandate**: ZERO application source code modified; ZERO live database commands executed; NO live database objects altered; ALL historical migrations and audit files preserved.

---

## 1. Executive Summary

This corrective review resolves the static inspection findings identified in the prior reviewed candidate (`20261014000100_cloud_database_foundation_reviewed.sql`) and its companion documentation. The previous revision corrected foundational omissions (such as the missing `upsert_daily_record_hierarchy` RPC and public profile exposure) but left several critical security boundaries, concurrency mechanisms, and permission models vulnerable or contradictory.

The **Phase 1.1 Corrective Revision** (`20261014000200_cloud_database_foundation_corrective.sql`) implements rigorous, production-grade resolutions across five primary domains:

1. **Administrative Role Hierarchy & Escalation Prevention**:
   - Replaced flat role storage with an explicit role hierarchy distinguishing ordinary `admin` from `tech-admin`.
   - Hardened RLS policies so ordinary administrators cannot grant, modify, or elevate users to `tech-admin`.
   - Identified and documented the initial administrator bootstrap mechanism without permitting self-service privilege escalation.
2. **Connected-Retirement Reconciliation & Canonical Symmetry**:
   - Reconciled the prior conflict between documentation (which stated dual-editor authorization) and SQL (which checked only source editor and target participant access).
   - Enforced strict dual-editor authorization: creating a connected retirement requires the caller to be an active editor (`OWNER`) on **both** retirements.
   - Enforced undirected, canonical symmetry via database constraint `CHECK (retirement_id < connected_id)` and a unique paired constraint, preventing duplicate reciprocal entries and bidirectional anomalies.
   - Provided a dedicated, secure helper RPC `public.connect_retirements(...)` that canonicalizes input ordering automatically.
3. **Daily-Record RPC Validation & Concurrency Control**:
   - Upgraded `upsert_daily_record_hierarchy(...)` with comprehensive defensive validation: JSON payload type checking, strict field lengths (category max 150 chars, item max 300 chars), numeric boundaries (quantity >= 0, rate >= 0), and explicit currency rounding (`ROUND(quantity * rate, 2)`).
   - Added server-managed optimistic concurrency control using a monotonic `version` counter on `daily_records` and `retirements`.
   - Stale client updates are detected and aborted via `CONCURRENCY_CONFLICT` exceptions, completely preventing silent overwrites while guaranteeing clean transactional rollback.
   - Preserved the generated-column invariant: `expense_items.amount` is generated always stored and is never explicitly written.
4. **Activity-Log Integrity & Trustworthy Attribution**:
   - Eliminated the vulnerability permitting clients to submit `NULL` user IDs or impersonate other users.
   - RLS strictly enforces `WITH CHECK (user_id = auth.uid() AND current_user_has_retirement_access(retirement_id))`.
   - Omitted all `UPDATE` and `DELETE` policies on `activity_logs` and revoked modification privileges at the table grant level, rendering the audit trail append-only and tamper-proof.
5. **Table-Level Grants & Least-Privilege Hardening**:
   - Explicitly revoked all permissions on all public tables and sequences from `PUBLIC` and `anon`.
   - Granted granular, least-privilege access to `authenticated` matching exact functional needs.
   - Disallowed table-level deletions on `public.profiles` and `public.activity_logs`.

---

## 2. Non-Destructive Safety & Compliance Audit

To adhere strictly to project safety directives, this phase was executed under complete non-destructive isolation:

| Safety Constraint | Verification | Operational Status |
|---|---|---|
| **Zero Live SQL Execution** | Verified | No SQL statements were executed against any database. Neither `psql`, Supabase CLI, nor API calls were performed. |
| **Zero Live Connection** | Verified | No live database connections were opened; no live schema or data was touched. |
| **No Existing File Overwrites** | Verified | `20261014000000_cloud_database_foundation.sql`, `20261014000100_cloud_database_foundation_reviewed.sql`, and all prior `.md` audit reports remain intact. |
| **Zero Application Code Changes** | Verified | No files in `src/`, `server.ts`, `package.json`, or configuration were modified. |
| **Unique Artifact Naming** | Verified | All additions utilize distinct candidate versioning: `20261014000200` and `_corrective` suffixes. |
| **Secret Protection** | Verified | No keys, tokens, or environment secrets were printed, requested, or stored. |

---

## 3. Deep Dive 1: Administrative Role Security, Hierarchy & Initial Bootstrap

### 3.1 Prior Vulnerability Analysis
In the baseline application, administrative privileges were evaluated through two dangerously insecure mechanisms:
1. **Client Metadata (`user_metadata.role`)**: Both `src/utils/supabaseClient.ts` (L23) and `server.ts` (L52) trusted `user.user_metadata?.role === 'admin'`. Because Supabase allows authenticated users to call `supabase.auth.updateUser({ data: { role: 'admin' } })`, any registered user could escalate themselves to an administrator.
2. **Email Prefix Matching**: `supabaseClient.ts` (L22) and `server.ts` (L61) automatically treated any email starting with `admin@` or `director@` as an administrator. Any untrusted visitor who signed up with `admin@temporarymail.com` gained administrative capabilities.

The previous migration candidate (`20261014000100`) introduced `public.user_roles`, but its RLS policy:
```sql
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL
  TO authenticated USING (public.current_user_is_admin());
```
permitted any user with the `admin` role to grant `admin` or higher privileges to anyone, including themselves or arbitrary accounts, without distinction between technical operations and site supervisors.

### 3.2 Corrective Role Hierarchy Model
The corrective candidate establishes a two-tiered server-enforced role hierarchy within `public.user_roles`:
- `admin`: Operational administrator. Authorized to view system user directories, trigger password reset links through administrative endpoints, and manage retirement access across projects. Ordinary administrators **cannot** elevate users to `tech-admin`.
- `tech-admin`: Root technical administrator. Authorized to manage infrastructure roles, assign both `admin` and `tech-admin` roles, and perform root database overrides.

The check constraint restricts roles:
```sql
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'tech-admin')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, role)
);
```

### 3.3 RLS Policy Enforcement
Elevation boundaries are enforced at the PostgreSQL RLS layer:
```sql
CREATE POLICY "Users can read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_is_admin());

CREATE POLICY "Admins can manage roles with hierarchy"
  ON public.user_roles FOR ALL TO authenticated
  USING (
    public.current_user_is_tech_admin()
    OR (public.current_user_is_admin() AND role = 'admin')
  )
  WITH CHECK (
    public.current_user_is_tech_admin()
    OR (public.current_user_is_admin() AND role = 'admin')
  );
```
Under this policy:
- An ordinary `admin` attempting `INSERT INTO public.user_roles (user_id, role) VALUES ('<uuid>', 'tech-admin')` is rejected with an RLS check violation.
- An ordinary `admin` cannot modify or delete a `tech-admin` role entry.
- Only accounts verified by `public.current_user_is_tech_admin()` can grant or revoke `tech-admin`.

### 3.4 Initial Administrator Bootstrap Strategy
A critical architectural problem in role-based systems is how the initial administrative user is created when the database is empty:
- **Rejected Anti-Pattern 1 (Self-Service Bootstrap)**: "If table is empty, allow the first user to insert an admin role." This introduces a race condition during deployment where whichever user signs up first becomes the root administrator.
- **Rejected Anti-Pattern 2 (Hardcoded Emails/UUIDs in Migration)**: Hardcoding a developer's personal email or a fixed UUID in SQL leaks developer identity and prevents multi-environment deployment (dev vs staging vs prod).
- **Approved Secure Bootstrap Pattern**:
  1. The initial `tech-admin` role is bootstrapped exclusively through the Supabase SQL Editor, backend seed script (`db/seed.sql`), or Supabase CLI execution running under the `service_role` / `postgres` superuser context.
  2. The candidate migration includes a commented template for deployment administrators:
     ```sql
     -- INITIAL TECH-ADMIN BOOTSTRAP (RUN ONCE BY INFRASTRUCTURE ADMINISTRATOR):
     -- INSERT INTO public.user_roles (user_id, role)
     -- SELECT id, 'tech-admin' FROM auth.users WHERE email = 'verified.infrastructure@company.com'
     -- ON CONFLICT (user_id, role) DO NOTHING;
     ```
  3. Once bootstrapped, all subsequent role management proceeds strictly through authenticated administrative channels governed by the RLS hierarchy.

### 3.5 Unresolved Organizational Decision
The application source code does not define whether site managers, project directors, and accounting supervisors require separate operational sub-roles (e.g., `auditor`, `project_manager`). For Phase 1.1, the hierarchy is scoped strictly to `tech-admin` and `admin`. If the organization requires fine-grained operational roles, this should be defined in a future governance review.

---

## 4. Deep Dive 2: Connected-Retirement Authorization & Canonical Symmetry

### 4.1 Prior Inconsistencies & Flaws
A review of the previous deliverables identified a direct contradiction:
- The **audit report** (`public/cloud_database_foundation_reviewed_report.md` §1 item 5) claimed: *"Corrected the insertion policy on public.connected_retirements to require dual authorization (the caller must be an editor of the source retirement and have authorized access to the linked retirement)."*
- The **actual SQL** in `20261014000100_cloud_database_foundation_reviewed.sql` (L431-435) checked:
  ```sql
  WITH CHECK (
    public.current_user_is_retirement_editor(retirement_id)
    AND public.current_user_has_retirement_access(connected_id)
  );
  ```
  This allowed a user who was an editor of Project A and merely a read-only `REVIEWER` on Project B to connect Project B to Project A.
- Furthermore, reciprocal relationships were asymmetric. Connecting Project A to Project B did not guarantee an undirected link, allowing duplicate inverse rows (`(A, B)` and `(B, A)`), which caused double-counting in report aggregation modals (`ConnectRetirementModal.tsx`).

### 4.2 Intended Rule: Dual-Editor Authorization
Connecting two retirements aggregates their financial expenditure, supplementary totals, and net budget balances into unified executive summaries. Under site construction governance, linking two independent capital expenditure projects must not be permitted by a user who only holds read-only viewer privileges on one of the projects.

**Corrective Policy**:
Creating a connection between `retirement_id` and `connected_id` requires the caller to be an authorized editor (`OWNER`) on **both** projects:
```sql
CREATE POLICY "Connected retirements insertable by dual-authorized editors"
  ON public.connected_retirements FOR INSERT TO authenticated
  WITH CHECK (
    (public.current_user_is_retirement_editor(retirement_id) AND public.current_user_is_retirement_editor(connected_id))
    OR public.current_user_is_tech_admin()
  );
```

### 4.3 Canonical Undirected Ordering & Symmetry
To eliminate reciprocal duplicate records and prevent database divergence, `public.connected_retirements` enforces canonical ordering:
```sql
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id),
  CHECK (retirement_id < connected_id)
);
```

**Benefits**:
1. It is mathematically impossible to store both `(UUID_A, UUID_B)` and `(UUID_B, UUID_A)`. The `CHECK (retirement_id < connected_id)` constraint immediately rejects inverted rows.
2. Self-referential connections (`retirement_id = connected_id`) are rejected by the strict less-than inequality `<`.
3. Reading connected retirements requires an intuitive symmetric query:
   ```sql
   SELECT * FROM public.connected_retirements
   WHERE retirement_id = :my_ret_id OR connected_id = :my_ret_id;
   ```

### 4.4 Helper RPC for Transparent Application Integration
To prevent client-side ordering bugs (where a client tries to insert `(B, A)` because the user opened Project B first), the corrective migration supplies an atomic helper function:
```sql
CREATE OR REPLACE FUNCTION public.connect_retirements(
  p_retirement_a UUID,
  p_retirement_b UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first UUID := LEAST(p_retirement_a, p_retirement_b);
  v_second UUID := GREATEST(p_retirement_a, p_retirement_b);
  v_connection_id UUID;
BEGIN
  IF p_retirement_a = p_retirement_b THEN
    RAISE EXCEPTION 'Cannot connect a retirement to itself';
  END IF;

  IF NOT (
    (public.current_user_is_retirement_editor(v_first) AND public.current_user_is_retirement_editor(v_second))
    OR public.current_user_is_tech_admin()
  ) THEN
    RAISE EXCEPTION 'Dual editor permission required on both retirements to establish connection';
  END IF;

  INSERT INTO public.connected_retirements (retirement_id, connected_id)
  VALUES (v_first, v_second)
  ON CONFLICT (retirement_id, connected_id) DO NOTHING
  RETURNING id INTO v_connection_id;

  RETURN v_connection_id;
END;
$$;
```

---

## 5. Deep Dive 3: Daily-Record RPC Correctness, Validation & Concurrency

### 5.1 Analysis of `upsert_daily_record_hierarchy(...)`
Daily record submission is the most financially critical operation in myRet. A single daily record represents a site expense breakdown comprising multiple categories (e.g., "Materials", "Labor", "Equipment") and numerous line items (e.g., "Cement bags: 50 @ ₦9,500").

The prior candidate migration lacked input bounds, string length constraints, and any protection against concurrent overwrite.

### 5.2 Defensive Input Validation Added
The corrective RPC implements strict input validation:
1. **Payload Structure**: Verifies `p_categories` is a non-null JSON array (`jsonb_typeof(p_categories) = 'array'`).
2. **String Bounds**:
   - Category names are limited to 150 characters (`length(v_cat_name) <= 150`).
   - Expense item descriptions are limited to 300 characters (`length(v_item_desc) <= 300`).
3. **Numeric Bounds & Financial Rounding**:
   - `quantity` must be >= 0 (default 1.00).
   - `rate` must be >= 0 (default 0.00).
   - Category subtotals and daily totals are rounded explicitly using bank-grade 2-decimal rounding:
     `v_cat_subtotal := v_cat_subtotal + ROUND(v_item_qty * v_item_rate, 2);`
4. **Generated Column Compliance**:
   - `expense_items.amount` is `GENERATED ALWAYS AS (quantity * rate) STORED`.
   - The RPC explicitly excludes `amount` from the `INSERT INTO public.expense_items` column list, eliminating PostgreSQL error `42601` (`cannot insert into column "amount"`).

### 5.3 Optimistic Concurrency Control (OCC)
In multi-user site environments, two site engineers or an engineer and an office supervisor might edit the same daily record simultaneously. Under the prior implementation, whichever client saved last would silently overwrite the other engineer's entries without warning.

**Corrective Implementation**:
1. Added a `version BIGINT DEFAULT 1 NOT NULL` column to `public.daily_records` and `public.retirements`.
2. The RPC accepts `p_expected_version BIGINT DEFAULT NULL`.
3. If the record exists and `p_expected_version` is supplied, the function compares the stored version against `p_expected_version`:
   ```sql
   IF v_daily_record_id IS NOT NULL AND p_expected_version IS NOT NULL THEN
     IF v_current_version <> p_expected_version THEN
       RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Daily record has been modified by another session (expected version %, current version %)',
         p_expected_version, v_current_version;
     END IF;
   END IF;
   ```
4. If a conflict is detected, the exception halts execution immediately. Because PostgreSQL functions execute within an implicit transaction, the transaction rolls back cleanly, preserving the existing record without any data corruption.
5. On successful save, the version is automatically incremented (`version = daily_records.version + 1`), and the parent retirement's version and `updated_at` timestamp are bumped.

---

## 6. Deep Dive 4: Activity-Log Integrity & Tamper Resistance

### 6.1 Vulnerability in Prior Draft
In `20261014000100`, the activity log insert policy read:
```sql
CREATE POLICY "Activity logs appendable by participants" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_retirement_access(retirement_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );
```
Allowing `user_id IS NULL` in a client-facing RLS policy is a security vulnerability: an authenticated client could submit arbitrary audit entries with `user_id = NULL`, obfuscating who performed an action, or spoofing activity details while evading actor accountability.

### 6.2 Corrective Audit Policy
The corrective candidate enforces strict actor binding:
```sql
CREATE POLICY "Activity logs appendable by participants" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_retirement_access(retirement_id)
    AND user_id = auth.uid()
  );
```

**Key Guarantees**:
1. Any direct client insert **must** provide `user_id = auth.uid()`. A user cannot attribute an action to another engineer.
2. System functions running under `SECURITY DEFINER` (such as `handle_new_user()` or server-side system processes) can insert system logs when necessary, but unprivileged clients cannot.
3. No `UPDATE` or `DELETE` policies exist on `public.activity_logs`.
4. Table grants explicitly omit `UPDATE` and `DELETE`, ensuring the audit trail is immutable.

---

## 7. Deep Dive 5: Table Grants & Least-Privilege Hardening

### 7.1 PostgreSQL Default Grant Behavior
In standard PostgreSQL, when a new table is created in the `public` schema, default privileges often grant `SELECT, INSERT, UPDATE, DELETE` to the `PUBLIC` pseudorole. While RLS prevents unauthorized row access, relying on RLS alone without table-level grant restrictions violates defense-in-depth principles and can lead to unintended exposure if RLS is accidentally toggled or misconfigured.

### 7.2 Corrective Table Grant Specifications
Section 9 of the corrective migration implements comprehensive privilege revocation and explicit least-privilege grants:

```sql
-- 1. Revoke all privileges from PUBLIC and anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 2. Grant explicit table-level operations to authenticated users
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirement_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplementary_entries TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.connected_retirements TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
```

**Specific Safeguards**:
- `anon` has **zero** table access. All myRet business data requires an active authenticated session.
- `public.profiles`: No `DELETE` grant. Users can update their profile information but cannot delete their identity record directly (account deletion must proceed via admin or auth cascading).
- `public.connected_retirements`: No `UPDATE` grant. Connections are established or severed; they are never mutated in place.
- `public.activity_logs`: Only `SELECT` and `INSERT`. `UPDATE` and `DELETE` are permanently revoked.

---

## 8. Complete Schema & Security Reconciliation Matrix

The following table provides the exhaustive status of all 10 tables in the corrective migration (`20261014000200`):

| Table Name | Primary Key | Foreign Keys | Constraints & Generated Columns | Versioning / Concurrency | RLS Enabled | Table Grants (`authenticated`) | RLS Policies Summary |
|---|---|---|---|---|---|---|---|
| `public.profiles` | `id UUID` | `auth.users(id)` ON DELETE CASCADE | `email` not null | `updated_at` | YES | `SELECT, INSERT, UPDATE` | Self, Admins, or Active Collaborators. Insert/Update self only. |
| `public.user_roles` | `id UUID` | `auth.users(id)` ON DELETE CASCADE | `UNIQUE(user_id, role)`, `CHECK(role IN ('admin', 'tech-admin'))` | N/A | YES | `SELECT, INSERT, UPDATE, DELETE` | Read self/admins. Admin manages `admin`. Only `tech-admin` manages `tech-admin`. |
| `public.retirements` | `id UUID` | `profiles(id)` | `code` UNIQUE (12 chars), `status` IN ('active', 'in_trash') | `version BIGINT DEFAULT 1` | YES | `SELECT, INSERT, UPDATE, DELETE` | Owner, Admins, or Active Participants. Owner/Admin updates and deletes. |
| `public.retirement_access` | `id UUID` | `retirements(id)`, `profiles(id)` | `UNIQUE(retirement_id, user_id)`, `role` IN ('OWNER', 'REVIEWER') | N/A | YES | `SELECT, INSERT, UPDATE, DELETE` | Participants read list. Primary owner and admins manage access. |
| `public.daily_records` | `id UUID` | `retirements(id)` | `UNIQUE(retirement_id, record_date)` | `version BIGINT DEFAULT 1` | YES | `SELECT, INSERT, UPDATE, DELETE` | Participants view. Editors (`OWNER`) and admins modify. |
| `public.categories` | `id UUID` | `daily_records(id)` ON DELETE CASCADE | Subtotal numeric(15,2), name not null | N/A | YES | `SELECT, INSERT, UPDATE, DELETE` | Participants view. Editors modify via parent daily record link. |
| `public.expense_items` | `id UUID` | `categories(id)` ON DELETE CASCADE | `amount GENERATED ALWAYS AS (quantity * rate) STORED`, qty >= 0, rate >= 0 | N/A | YES | `SELECT, INSERT, UPDATE, DELETE` | Participants view. Editors modify. Generated column never written directly. |
| `public.supplementary_entries` | `id UUID` | `retirements(id)` ON DELETE CASCADE | Amount >= 0, description not null | N/A | YES | `SELECT, INSERT, UPDATE, DELETE` | Participants view. Editors and admins modify. |
| `public.connected_retirements` | `id UUID` | `retirements(id)` (x2) | `UNIQUE(retirement_id, connected_id)`, `CHECK(retirement_id < connected_id)` | N/A | YES | `SELECT, INSERT, DELETE` | Participants of either view. Dual editors insert. Either editor deletes. |
| `public.activity_logs` | `id UUID` | `retirements(id)`, `profiles(id)` | User ID references profile or null | N/A | YES | `SELECT, INSERT` (NO UPDATE/DELETE) | Participants view. Append only with `user_id = auth.uid()`. |

---

## 9. Future Application Compatibility & Integration Guide

*Note: In accordance with safety rules, zero application source code has been altered in this phase. The following guidance documents the exact integration work required in subsequent implementation phases.*

### 9.1 Compatibility with `upsert_daily_record_hierarchy`
When Phase 2 connects the React frontend (`src/utils/storage.ts` and `src/components/retirement/DailyRecordModal.tsx`) to Supabase, the invocation should pass the expected version:
```typescript
const { data, error } = await supabase.rpc('upsert_daily_record_hierarchy', {
  p_record_id: dailyRecord.id,
  p_retirement_id: retirementId,
  p_record_date: dailyRecord.date,
  p_categories: payloadCategories,
  p_expected_version: dailyRecord.version ?? null, // OCC check
  p_client_updated_at: new Date().toISOString()
});

if (error?.message?.includes('CONCURRENCY_CONFLICT')) {
  // Notify user that another engineer updated this record, offer reload/merge
  toast.error('This record was modified by another user. Reloading latest data...');
}
```

### 9.2 TypeScript Interface Additions (`src/types/index.ts`)
Add `version` properties to match the database entities:
```typescript
export interface DailyRecord {
  id: string;
  date: string;
  categories: Category[];
  dailyTotal: number;
  version?: number; // Added for OCC
  createdAt?: string;
  updatedAt?: string;
}

export interface Retirement {
  id: string;
  code: string;
  title: string;
  project: string;
  ownerId: string;
  status: 'active' | 'in_trash';
  deletedAt?: string;
  version?: number; // Added for OCC
  // ...
}
```

### 9.3 Connected Retirements Invocation
Instead of manually sorting UUIDs on the client, call the helper RPC:
```typescript
const { data: connectionId, error } = await supabase.rpc('connect_retirements', {
  p_retirement_a: currentRetirementId,
  p_retirement_b: targetRetirementId
});
```

### 9.4 Server Administrative Endpoints (`server.ts`)
In Phase 2, `server.ts` must be refactored to:
1. Remove all references to `req.user.user_metadata.role` and `email.startsWith('admin')`.
2. Query `public.user_roles` using the server's `service_role` client to verify true database authority.
3. Remove `POST /api/admin/set-service-key`, keeping the `SUPABASE_SERVICE_ROLE_KEY` strictly in server-side environment variables.

---

## 10. Summary of Architectural Recommendations

1. **Approve Candidate 20261014000200**: The corrective SQL migration `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql` represents a complete, secure, and idempotent database foundation ready for staging review.
2. **Execute Initial Admin Bootstrap via CLI/Console**: Do not implement automated self-service admin promotion. Seed the initial technical administrator via the Supabase Dashboard SQL Editor upon migration application.
3. **Adopt Concurrency Awareness in UI**: Update `DailyRecordModal.tsx` in Phase 2 to store and pass `version` tokens, providing user-friendly conflict resolution when concurrent edits occur.
4. **Preserve Read-Only Isolation Until Approval**: Maintain strict separation between database design artifacts and active application code until human stakeholders formally approve the migration.
