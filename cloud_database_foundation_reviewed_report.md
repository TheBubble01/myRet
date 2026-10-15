# Phase 1 Database Foundation: Revised Technical Audit & Architecture Review

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Reviewed Technical Audit & Architecture Specification  
**Version**: 2.0 (Targeted Security & Correctness Revision)  
**Date**: October 14, 2026  
**Status**: READ-ONLY ARCHITECTURAL SPECIFICATION & UNAPPLIED CANDIDATE MIGRATION  
**Compliance**: ZERO application source code modified; ZERO SQL executed; NO live database queries; NO localStorage data migrated.

---

## 1. Executive Summary

This document presents the revised and corrected technical audit for **myRet**. Following a comprehensive review of the original candidate migration (`20261014000000_cloud_database_foundation.sql`) and its audit report, this revision directly remedies several critical discrepancies, security flaws, and missing database functions.

### Key Corrections in This Revision
1. **Added Missing Atomic RPC**: The previous audit report erroneously claimed that `upsert_daily_record_hierarchy(...)` was present in the candidate migration. In reality, the function was absent from the SQL file. This revision specifies and includes a complete, production-grade PostgreSQL implementation in `20261014000100_cloud_database_foundation_reviewed.sql`.
2. **Eliminated Unrestricted Profile Access**: The previous draft applied `USING (true)` to `public.profiles`, exposing all site engineers' names, email addresses, phone numbers, and project placements to any authenticated user. The revised policy restricts profile access to: (a) Self, (b) System Administrators, and (c) Collaborators sharing at least one active retirement.
3. **Hardened SECURITY DEFINER Helper Functions**: Helper functions in the previous draft (`has_retirement_access` and `is_retirement_editor`) accepted a caller-supplied `p_user_id` parameter, enabling arbitrary users to probe permissions of other accounts. They have been refactored to `current_user_has_retirement_access(p_ret_id)` and `current_user_is_retirement_editor(p_ret_id)`, binding strictly to `auth.uid()`.
4. **Resolved Administrator Role Storage**: Replaced the vulnerable client-metadata authorization model with a dedicated, protected `public.user_roles` table, preventing privilege self-escalation while laying the foundation for server-side role resolution.
5. **Fixed Connected-Retirement Authorization**: Corrected the insertion policy on `public.connected_retirements` to require dual authorization (the caller must be an editor of the source retirement and have authorized access to the linked retirement).
6. **Secured Activity-Log Immutability**: Enforced that activity logs can only be inserted with `user_id = auth.uid()` or null, preventing client impersonation in audit logs, and prohibited client UPDATE and DELETE operations.
7. **Accurate Rate Limiting & Offline Statements**: Corrected unsupported claims regarding automatic PostgreSQL rate limiting and clarified that offline synchronization logic remains future work.

---

## 2. Files Inspected

The following repository files were inspected to ground every finding in factual code evidence:

1. `supabase/schema.sql`: Base repository schema (9 tables, initial RLS definitions, constraints).
2. `supabase/migrations/20261014000000_cloud_database_foundation.sql`: Original candidate migration proposal.
3. `src/types/index.ts`: TypeScript domain interfaces (`Retirement`, `DailyRecord`, `Category`, `ExpenseItem`, `SupplementaryEntry`, `ActivityLog`, `UserProfile`, `RetirementAccess`).
4. `src/utils/storage.ts`: Complete localStorage CRUD implementation, calculations, normalization, trash lifecycle, and demo data management.
5. `src/utils/supabaseClient.ts`: Supabase browser client initialization, user metadata formatting, and client-side admin check.
6. `server.ts`: Express backend, authentication middleware (`requireAuth`, `requireAdmin`), administrative endpoints, and Vite middleware integration.
7. `src/components/auth/AuthModal.tsx`: Login, signup, password reset request, and user metadata submission logic.
8. `src/components/auth/ProfileModal.tsx`: User profile editing, auth metadata updates, and attempted `public.profiles` upsert.
9. `src/components/admin/AdminUserManagement.tsx` & `AdminResetPasswordModal.tsx`: Admin user management portal, password reset requests, and service key configuration UI.
10. `src/components/retirement/RetirementHome.tsx`: Core retirement dashboard, calculations, daily record CRUD, supplementary CRUD, and activity log rendering.
11. `src/components/retirement/DailyRecordModal.tsx`: Daily expense form, category/item creation, financial calculation, and validation logic.
12. `src/components/retirement/SupplementaryModal.tsx`: Supplementary payment entry modal.
13. `src/components/retirement/ShareModal.tsx`: Access control, collaborator management, role assignment (`OWNER` vs `REVIEWER`).
14. `src/components/retirement/ConnectRetirementModal.tsx`: Bidirectional retirement linking and aggregated totals inspection.
15. `src/components/retirement/ExportPdfModal.tsx` & `src/utils/pdfGenerator.ts`: Report generation and multi-retirement aggregation.
16. `src/components/dashboard/TrashView.tsx`: 48-hour trash display, restoration, and permanent deletion logic.
17. `src/components/dashboard/AddExistingModal.tsx`: Retirement linking via 12-character human-readable code.
18. `src/components/pwa/OfflineIndicator.tsx` & `src/hooks/useOnlineStatus.ts`: PWA connectivity indicator and offline banner.
19. `vite.config.ts`: Vite PWA plugin configuration, service worker caching rules, and asset manifest.
20. `src/utils/currency.ts`: Nigerian Naira formatting and `calculateAmount(quantity, rate)` precision rules.

---

## 3. Existing Architecture and Verified Facts

1. **Local-Only Domain State**: All active retirements, daily expenditures, categories, items, and supplementary entries reside in browser `localStorage`.
2. **Current Supabase Scope**: Supabase Auth handles login, signup, and session restoration. Three server endpoints in `server.ts` utilize Supabase Auth Admin API for user management and password resets.
3. **Database Schema State**: The base file `supabase/schema.sql` defines 9 tables with RLS enabled, but only 3 tables have policies (8 total policies). 6 tables have zero policies.
4. **Trigger Absense**: No trigger on `auth.users` exists in `supabase/schema.sql`. New user signups in `AuthModal.tsx` create an `auth.users` row but do not create a `public.profiles` row.
5. **Role Escalation Vulnerability**: `supabaseClient.ts` (L23) and `server.ts` (L52) evaluate `user_metadata.role`. Any user can execute `supabase.auth.updateUser({ data: { role: 'admin' } })` to grant themselves system admin rights.
6. **Insecure Email Prefix Rule**: Both client (L22) and server (L61) grant administrator status to any email starting with `admin@`, allowing arbitrary untrusted signups to gain root admin access.
7. **Offline Queue Status**: `myret_sync_queue` and `syncStatus` exist as declarations in TypeScript, but no queue processing, background task runner, or sync engine exists.

---

## 4. Findings from Original Candidate Migration (`20261014000000`)

| Issue | Severity | Analysis |
|---|---|---|
| **Missing `upsert_daily_record_hierarchy`** | **Critical** | The SQL file lacked the function entirely, despite the report claiming its existence. Without this RPC, nested daily record persistence cannot succeed atomically. |
| **Broad Profile Exposure** | **High** | Applied `CREATE POLICY ... ON public.profiles FOR SELECT USING (true);`. Every authenticated user could scrape all site engineers' private phone numbers, emails, and site placements. |
| **Security Definer Function Probing** | **High** | `has_retirement_access` and `is_retirement_editor` took `p_user_id` as a parameter. Any user could pass arbitrary UUIDs to query authorization details of other users. |
| **Unchecked Connected-Retirements Insert** | **Medium** | Checked only whether caller was an editor of `retirement_id`. A user could link their project to any third-party project without having access to it. |
| **Activity Log Spoofing** | **Medium** | Allowed inserting logs without validating `user_id = auth.uid()`. A collaborator could forge audit events in another user's name. |
| **Unrestricted Function Execution** | **Medium** | Default `PUBLIC` execution privileges remained on SECURITY DEFINER functions. |

---

## 5. Schema Reconciliation Table

| Model / Property | Local TypeScript Type (`src/types/index.ts`) | Relational Target (`supabase/migrations/...`) | Conversion & Handling Rules |
|---|---|---|---|
| **User Profile** | `UserProfile` (`id`, `name`, `designation`, `phone`, `email`, `placement`, `avatarUrl`) | `public.profiles` (`id` PK UUID, `name`, `designation`, `phone`, `email`, `placement`, `avatar_url`) | 1:1 relational mapping. `id` matches `auth.users.id`. Auto-populated via `handle_new_user()` trigger on signup. |
| **Admin Roles** | `UserProfile.role?: string` ('admin' \| 'tech-admin' \| 'user') | `public.user_roles` (`user_id` FK, `role` VARCHAR(50)) | Dedicated table replaces vulnerable client-editable metadata. |
| **Retirement** | `Retirement` (`id`, `code`, `title`, `project`, `ownerId`, `status`, `deletedAt`) | `public.retirements` (`id` PK UUID, `code` UNIQUE, `title`, `project`, `owner_id` FK, `status`, `deleted_at`) | Stable UUID preserved across offline creation and cloud sync. `code` is 12-char uppercase alphanumeric. |
| **Retirement Access** | `Retirement.access: RetirementAccess[]` | `public.retirement_access` (`retirement_id` FK, `user_id` FK, `role`, `granted_at`) | Normalized child table. `UNIQUE(retirement_id, user_id)`. Role is `OWNER` or `REVIEWER`. |
| **Connected Projects** | `Retirement.connectedRetirementIds: string[]` | `public.connected_retirements` (`retirement_id` FK, `connected_id` FK) | Normalized bidirectional join table. `CHECK (retirement_id <> connected_id)`. |
| **Daily Record** | `DailyRecord` (`id`, `retirementId`, `date`, `dailyTotal`) | `public.daily_records` (`id` PK UUID, `retirement_id` FK, `record_date` DATE, `daily_total`) | Property `date` mapped to SQL `record_date` (`YYYY-MM-DD`). `UNIQUE(retirement_id, record_date)` enforces one record per date. |
| **Categories** | `Category` (`id`, `name`, `subtotal`, `items`) | `public.categories` (`id` PK UUID, `daily_record_id` FK, `name`, `subtotal`, `sort_order`) | Normalized child table. Subtotal maintained by atomic RPC. |
| **Expense Items** | `ExpenseItem` (`id`, `description`, `quantity`, `rate`, `amount`) | `public.expense_items` (`id` PK UUID, `category_id` FK, `description`, `quantity`, `rate`, `amount` STORED) | **Critical**: `amount` is a GENERATED ALWAYS STORED column (`quantity * rate`). Inserts/updates must omit `amount`. |
| **Supplementary** | `SupplementaryEntry` (`id`, `retirementId`, `description`, `amount`) | `public.supplementary_entries` (`id` PK UUID, `retirement_id` FK, `description`, `amount`) | Stored in dedicated child table. Contributes to general totals. |
| **Activity Log** | `ActivityLog` (`id`, `retirementId`, `userId`, `action`, `details`, `timestamp`) | `public.activity_logs` (`id` PK UUID, `retirement_id` FK, `user_id` FK, `action`, `details`, `created_at`) | Immutable append-only audit trail. |
| **Demo Indicator** | `Retirement.isDemo?: boolean` | *Local Only* | Excluded from PostgreSQL persistence. Preserved strictly in browser storage. |

---

## 6. Table-by-Table RLS and Authorization Matrix

| Table | SELECT Policy | INSERT Policy | UPDATE Policy | DELETE Policy | Authorized Callers |
|---|---|---|---|---|---|
| **`public.profiles`** | Self, Admins, or Shared Collaborators | Self (`auth.uid() = id`) | Self (`auth.uid() = id`) | None (Cascade from auth.users) | Authenticated Users |
| **`public.user_roles`** | Self or Admins | Admins only | Admins only | Admins only | System Administrators |
| **`public.retirements`** | Participants or Admins | Primary Owner (`owner_id = auth.uid()`) | Primary Owner or Admins | Primary Owner or Admins | Owner / Participants / Admins |
| **`public.retirement_access`** | Participants or Admins | Primary Owner or Admins | Primary Owner or Admins | Primary Owner or Admins | Primary Owner / Admins |
| **`public.daily_records`** | Participants or Admins | Editors or Admins | Editors or Admins | Editors or Admins | Primary Owner / Participant OWNER |
| **`public.categories`** | Participants or Admins | Editors or Admins | Editors or Admins | Editors or Admins | Primary Owner / Participant OWNER |
| **`public.expense_items`** | Participants or Admins | Editors or Admins | Editors or Admins | Editors or Admins | Primary Owner / Participant OWNER |
| **`public.supplementary_entries`** | Participants or Admins | Editors or Admins | Editors or Admins | Editors or Admins | Primary Owner / Participant OWNER |
| **`public.connected_retirements`** | Participants or Admins | Dual-Authorized Editors | None (Delete/Recreate) | Either Retirement Editor | Editors of both retirements |
| **`public.activity_logs`** | Participants or Admins | Participants (`user_id = auth.uid()`) | None (Immutable) | None (Immutable) | Participants / System |

---

## 7. Function-by-Function Security Review

### 1. `current_user_has_retirement_access(p_ret_id UUID)`
- **Purpose**: Non-recursive RLS helper to check if caller is primary owner or authorized collaborator.
- **Security Definer**: Justified to query `retirements` and `retirement_access` without recursive policy evaluation.
- **Search Path**: Fixed (`SET search_path = public, pg_temp`).
- **Caller Binding**: Binds strictly to `auth.uid()`. Takes only `p_ret_id`. Prevents arbitrary user permission probing.
- **Grants**: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`.

### 2. `current_user_is_retirement_editor(p_ret_id UUID)`
- **Purpose**: Evaluates whether caller is Primary Owner or Participant granted `role = 'OWNER'`.
- **Security Definer**: Justified to bypass RLS recursion on child write operations.
- **Search Path**: Fixed (`SET search_path = public, pg_temp`).
- **Caller Binding**: Binds strictly to `auth.uid()`.
- **Grants**: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`.

### 3. `current_user_is_admin()`
- **Purpose**: Evaluates whether caller has an active role in `public.user_roles`.
- **Security Definer**: Justified to check administrative roles securely.
- **Search Path**: Fixed (`SET search_path = public, pg_temp`).
- **Caller Binding**: Binds strictly to `auth.uid()`.
- **Grants**: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`.

### 4. `claim_retirement_by_code(p_code TEXT)`
- **Purpose**: Allows engineers to link a shared retirement as `REVIEWER` using a 12-character code.
- **Security Definer**: Justified because unlinked users cannot query private retirements directly under RLS.
- **Safeguards**:
  - Rejects unauthenticated callers (`auth.uid() IS NULL`).
  - Ignores self-claims by primary owner without duplicate records or errors.
  - Idempotent: duplicate claims by existing collaborators do not duplicate rows or logs.
  - Rejects trashed retirements (`status = 'in_trash'`).
  - Returns identical generic error `'Invalid retirement code'` on any lookup failure to prevent enumeration.
  - Appends audit log atomically.
- **Grants**: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`.

### 5. `upsert_daily_record_hierarchy(...)`
- **Purpose**: Atomically persists a daily record with its complete nested category and item hierarchy.
- **Security Definer**: Justified to execute atomic delete-and-reinsert of categories/items within a transaction.
- **Safeguards**:
  - Validates editor authorization (`current_user_is_retirement_editor`).
  - Enforces one record per date via `ON CONFLICT (retirement_id, record_date)`.
  - Atomically replaces child categories and items to prevent partial state corruption.
  - Does NOT assign `amount` (prevents `42601` generated column error).
  - Recalculates category subtotals and daily totals server-side.
  - Appends audit log atomically.
- **Grants**: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`.

---

## 8. Profile Privacy & Discoverability Design

### Threat Model
In the construction domain, exposing contact lists allows unauthorized subcontractors or competitors to scrape employee phone numbers, emails, and project assignments.

### Implemented Policy
`public.profiles` policy `"Profiles viewable by self collaborators or admins"` allows reading profile rows only when:
1. The profile is the user's own profile (`id = auth.uid()`), OR
2. The user is a system administrator (`current_user_is_admin()`), OR
3. The user shares at least one active retirement with the profile owner via `public.retirement_access`, OR
4. The user is a retirement owner viewing their collaborator, or a collaborator viewing the primary owner.

Any random authenticated user who does not share a project with User X receives 0 rows when attempting to query User X's profile.

---

## 9. Connected-Retirement Authorization Design

### Threat Model
If user A controls Retirement 1, they should not be able to link Retirement 1 to Retirement 2 (owned by user B) unless user A is an authorized participant of Retirement 2. Without dual authorization, a malicious user could attach their private records to an executive budget.

### Implemented Policy
- `public.connected_retirements` INSERT requires:
  - Caller must be an editor of `retirement_id` (`current_user_is_retirement_editor(retirement_id)`), AND
  - Caller must have authorized access to `connected_id` (`current_user_has_retirement_access(connected_id)`).
- Deletion requires editor permissions on either side of the link.
- Linking does not grant access to the underlying records of the connected project; it only permits authorized multi-project report aggregation.

---

## 10. Retirement-Code Claiming & Rate-Limiting Strategy

### Database Layer Safeguards
- Generic error messages: `'Invalid retirement code'` returned for non-existent codes, trashed codes, or invalid formats.
- Uppercase trimming normalization: `UPPER(TRIM(p_code))`.
- Fixed search path prevents schema injection.

### Required Application-Level Rate Limiter (Phase 2 Task)
PostgreSQL cannot natively detect IP addresses or rate-limit HTTP requests. Before deploying code linking to production, the server proxy must enforce:
- Maximum 5 claim attempts per 15-minute window per authenticated User ID.
- Maximum 15 claim attempts per 15-minute window per IP address.
- Exceeding the threshold returns `429 Too Many Requests` without invoking the database RPC.

---

## 11. Atomic Daily-Record Persistence Design

### Transactional Flow of `upsert_daily_record_hierarchy`
```
1. Authenticate Caller -> auth.uid()
2. Verify Editor Authority -> current_user_is_retirement_editor(p_retirement_id)
3. Upsert Parent Record:
   INSERT INTO daily_records (retirement_id, record_date) ...
   ON CONFLICT (retirement_id, record_date) DO UPDATE ...
   RETURNING id -> v_daily_record_id
4. Clean Existing Sub-Hierarchy:
   DELETE FROM categories WHERE daily_record_id = v_daily_record_id
   (Cascades automatically to expense_items)
5. Loop Categories in Payload:
   INSERT INTO categories (daily_record_id, name, sort_order)
   Loop Items in Category:
     Calculate item amount = round(qty * rate, 2)
     INSERT INTO expense_items (category_id, description, quantity, rate) [amount OMITTED]
     Accumulate category subtotal
   UPDATE categories SET subtotal = v_cat_subtotal
   Accumulate daily total
6. Finalize Daily Total:
   UPDATE daily_records SET daily_total = v_calculated_daily_total
7. Touch Retirement:
   UPDATE retirements SET updated_at = NOW()
8. Append Audit Trail:
   INSERT INTO activity_logs (action: 'Daily Record Saved')
9. Return JSON: { success: true, daily_record_id, daily_total }
```
If any error occurs during step 5 (e.g. invalid item description or negative rate), the entire transaction rolls back cleanly, leaving previous daily records intact.

---

## 12. Administrator Role Architecture Recommendation

### Decision: Dedicated `public.user_roles` Table
- **Why not `user_metadata`?** `user_metadata` is editable by the client via Supabase Auth API, presenting a critical security risk.
- **Why not `app_metadata` alone?** `app_metadata` requires Supabase Service Role API calls for every role query and cannot be directly queried in pure SQL RLS without JWT token parsing.
- **Recommended Approach**:
  - `public.user_roles (user_id UUID REFERENCES auth.users(id), role VARCHAR(50), PRIMARY KEY(user_id, role))`.
  - Protected by RLS: readable by self or admins, writable only by admins.
  - Server endpoints in `server.ts` check `public.user_roles` using service role or check verified `app_metadata`.
  - The insecure endpoint `POST /api/admin/set-service-key` in `server.ts` must be removed in Phase 2; the key will be injected exclusively as a secure environment variable.

---

## 13. Trash Retention and 48-Hour Cleanup Design

### Current Behavior
- Retirement status toggles between `'active'` and `'in_trash'`.
- Deletion sets `deleted_at = NOW()`.
- Local storage prunes records where `Date.now() - deleted_at > 48 hours`.

### Proposed Cloud Cleanup Architecture (Phase 3 Task)
A secured PostgreSQL maintenance function:
```sql
CREATE OR REPLACE FUNCTION public.cleanup_expired_trash()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Permanently delete retirements trashed for more than 48 hours
  -- Cascades automatically to daily_records, categories, expense_items, supplementary, connections, and logs
  WITH deleted AS (
    DELETE FROM public.retirements
    WHERE status = 'in_trash'
      AND deleted_at < NOW() - INTERVAL '48 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;
```
*Scheduling*: Can be invoked nightly via Supabase `pg_cron` (`cron.schedule('0 2 * * *', 'SELECT public.cleanup_expired_trash();')`) or via an external authenticated health check worker.

---

## 14. Offline-First Implementation Architecture

### High-Level Offline Blueprint (For Future Phase)
1. **IndexedDB Local Store**: Replace `localStorage` with IndexedDB for domain entities to avoid the 5MB browser quota.
2. **Persistent Sync Outbox**: Queue offline mutations with client UUIDs.
3. **Sequential Sync Engine**: When connectivity is restored, iterate through the outbox:
   - Daily record saves call `upsert_daily_record_hierarchy`.
   - Retirement creations call `INSERT INTO retirements`.
   - Code claims call `claim_retirement_by_code`.
4. **Conflict Resolution Policy**:
   - Same-date daily record edits from different devices merge categories and append new items. Conflicting item edits (same description, differing rates) trigger a user notification modal.
   - Authorizations revoked while offline trigger a clean quarantine of local unsynced edits with a user alert.
5. **Demo Data Isolation**: Demo records (`isDemo: true`) are never written to the sync outbox and remain strictly local.

---

## 15. Read-Only Preflight SQL Verification Queries

Before any migration is executed in the live Supabase project, an administrator should run these read-only inspection queries in the Supabase SQL Editor to audit existing database state:

```sql
-- 1. Inspect existing tables in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. Inspect existing RLS enablement status
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE pg_namespace.nspname = 'public' AND relkind = 'r'
ORDER BY relname;

-- 3. Inventory all existing RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. Check for existing triggers on auth.users
SELECT trigger_name, event_manipulation, event_object_schema, event_object_table, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

-- 5. Inspect existing functions in public schema
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

---

## 16. Unresolved Questions & Next Steps

1. **Service Role Key Deployment**: How is `SUPABASE_SERVICE_ROLE_KEY` currently injected into the deployment environment? (Should be verified as an environment variable before removing `POST /api/admin/set-service-key`).
2. **Initial Administrator Bootstrap**: Who should be seeded into `public.user_roles` as the initial root administrator? (Recommend seeding the primary site engineer account upon first migration).
3. **Approval Required**: The revised migration file `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql` is ready for human review and requires explicit sign-off before any execution.

---

## 17. Safety & Non-Execution Confirmation

I explicitly confirm that during this task:
- **ZERO SQL statements were executed** against any database.
- **ZERO live Supabase database connections were made**.
- **ZERO application source code files were modified**.
- **ZERO existing files were overwritten or deleted**.
- All new deliverables were created under unique, non-conflicting filenames.
