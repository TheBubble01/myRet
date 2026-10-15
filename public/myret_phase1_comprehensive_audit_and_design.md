# Phase 1: Comprehensive Database Foundation Audit, Security Review, Offline-First Architecture Design, and Migration Preparation

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Execution Date**: October 14, 2026  
**Status**: READ-ONLY PREPARATION AUDIT & ARCHITECTURAL SPECIFICATION  
**Scope Compliance**: ZERO application source code modified; ZERO SQL executed; NO live database access; NO localStorage data migrated; NO UI/calculation changes.

---

## A. Executive Summary

This Phase 1 deliverable provides an architectural audit, security review, offline-first design, and migration preparation for the **myRet** application.

### Current Architectural Reality
myRet is currently a client-side Single Page Application (PWA) operating on React 19, TypeScript, Tailwind CSS, Vite, and an Express development/static server (`server.ts`). All business entities—retirements, daily consolidated expenditures, categories, line items, supplementary payments, connected retirement links, and activity logs—reside exclusively in browser `localStorage` managed by `StorageService` (`src/utils/storage.ts`).

Supabase is currently wired only for authentication (`supabase.auth.*`) and three administrative server endpoints in `server.ts`. No business records are currently queried from or written to Supabase.

### Primary Risks Identified
1. **Critical Database RLS Flaw**: `supabase/schema.sql` enables Row Level Security (RLS) on all 9 tables, but provides policies for only 3 tables (`profiles`, `retirements`, `daily_records`). The remaining 6 tables (`retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, `activity_logs`) have **zero policies**. Under PostgreSQL rules, enabling RLS with no policies results in a default `DENY ALL` for non-superusers. Any attempt to write or read child records would fail immediately with `42501 permission denied`.
2. **Critical Role Escalation Vulnerabilities**:
   - In `src/utils/supabaseClient.ts` (L23–26) and `server.ts` (L52), user authorization checks `user.user_metadata?.role === 'admin'`. Because Supabase Auth allows any authenticated client to freely update their own `user_metadata` via `supabase.auth.updateUser()`, any user can promote themselves to full system administrator.
   - Both client and server grant administrator access to any user whose email begins with `admin@` (L22 in client, L61 in server), allowing anyone to register an arbitrary address like `admin@tempmail.com` and obtain full administrative control.
3. **Missing Automated Profile Provisioning & Foreign Key Risk**: There is no trigger on `auth.users` to populate `public.profiles`. Signup only creates the auth record. Because `public.retirements.owner_id` has a foreign key constraint referencing `public.profiles(id)`, creating a retirement immediately after signup will fail with foreign key violation `23503`. Furthermore, `public.profiles` has no `INSERT` policy, preventing the client from self-provisioning.
4. **Primary Owner vs Participant OWNER Disconnect**: The policy on `daily_records` restricts modification to `r.owner_id = auth.uid()`. An authorized team member granted `role = 'OWNER'` in `retirement_access` is blocked by RLS from creating or editing daily expenditures.
5. **Offline Sync Queue Non-Existence**: While `syncStatus: 'synced' | 'pending'` and `myret_sync_queue` exist as symbols in TypeScript and storage keys, **no synchronization queue processing, retry logic, or offline upload mechanism exists in the codebase**.

### Migration Readiness Verdict
The application **cannot safely connect to the database in its current state**. A carefully prepared, additive database foundation migration (`supabase/migrations/20261014000000_cloud_database_foundation.sql`) must first establish complete RLS policies, an automated profile trigger, a secure RPC for retirement-code claiming, a protected daily record upsert transaction, and server-side role resolution before frontend synchronization is implemented.

---

## B. Files Inspected

The following repository files were thoroughly inspected to establish factual findings:

1. `supabase/schema.sql`: PostgreSQL schema definitions, constraints, indexes, and initial RLS policies.
2. `src/types/index.ts`: TypeScript data models (`Retirement`, `DailyRecord`, `Category`, `ExpenseItem`, `SupplementaryEntry`, `ActivityLog`, `UserProfile`, `RetirementAccess`).
3. `src/utils/storage.ts`: Complete localStorage CRUD implementation, calculations, normalization, trash lifecycle, and demo data management.
4. `src/utils/supabaseClient.ts`: Supabase browser client initialization, user metadata formatting, and client-side admin check.
5. `server.ts`: Express backend, authentication middleware (`requireAuth`, `requireAdmin`), administrative endpoints, and Vite middleware integration.
6. `src/components/auth/AuthModal.tsx`: Login, signup, password reset request, and user metadata submission logic.
7. `src/components/auth/ProfileModal.tsx`: User profile editing, auth metadata updates, and attempted `public.profiles` upsert.
8. `src/components/admin/AdminUserManagement.tsx` & `AdminResetPasswordModal.tsx`: Admin user management portal, password reset requests, and service key configuration UI.
9. `src/components/retirement/RetirementHome.tsx`: Core retirement dashboard, calculations, daily record CRUD, supplementary CRUD, and activity log rendering.
10. `src/components/retirement/DailyRecordModal.tsx`: Daily expense form, category/item creation, financial calculation, and validation logic.
11. `src/components/retirement/SupplementaryModal.tsx`: Supplementary payment entry modal.
12. `src/components/retirement/ShareModal.tsx`: Access control, collaborator management, role assignment (`OWNER` vs `REVIEWER`).
13. `src/components/retirement/ConnectRetirementModal.tsx`: Bidirectional retirement linking and aggregated totals inspection.
14. `src/components/retirement/ExportPdfModal.tsx` & `src/utils/pdfGenerator.ts`: Report generation and multi-retirement aggregation.
15. `src/components/dashboard/TrashView.tsx`: 48-hour trash display, restoration, and permanent deletion logic.
16. `src/components/dashboard/AddExistingModal.tsx`: Retirement linking via 12-character human-readable code.
17. `src/components/pwa/OfflineIndicator.tsx` & `src/hooks/useOnlineStatus.ts`: PWA connectivity indicator and offline banner.
18. `vite.config.ts`: Vite PWA plugin configuration, service worker caching rules, and asset manifest.
19. `src/utils/currency.ts`: Nigerian Naira formatting and `calculateAmount(quantity, rate)` precision rules.

*Files that could not be inspected*: Live Supabase remote database instances or remote dashboard settings, as live network database querying is strictly prohibited in this phase.

---

## C. Verified Current State

### 1. Database Schema (`supabase/schema.sql`)
- **Tables (9 total)**: `profiles`, `retirements`, `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, `activity_logs`.
- **Foreign Keys**:
  - `profiles.id` -> `auth.users.id` (ON DELETE CASCADE)
  - `retirements.owner_id` -> `profiles.id` (ON DELETE CASCADE)
  - `retirement_access.retirement_id` -> `retirements.id` (ON DELETE CASCADE)
  - `retirement_access.user_id` -> `profiles.id` (ON DELETE CASCADE)
  - `daily_records.retirement_id` -> `retirements.id` (ON DELETE CASCADE)
  - `categories.daily_record_id` -> `daily_records.id` (ON DELETE CASCADE)
  - `expense_items.category_id` -> `categories.id` (ON DELETE CASCADE)
  - `supplementary_entries.retirement_id` -> `retirements.id` (ON DELETE CASCADE)
  - `connected_retirements.retirement_id` -> `retirements.id` (ON DELETE CASCADE)
  - `connected_retirements.connected_id` -> `retirements.id` (ON DELETE CASCADE)
  - `activity_logs.retirement_id` -> `retirements.id` (ON DELETE CASCADE)
  - `activity_logs.user_id` -> `profiles.id` (ON DELETE SET NULL)
- **Constraints**:
  - `retirements.code`: `UNIQUE`
  - `retirements.status`: `CHECK (status IN ('active', 'in_trash'))`
  - `retirement_access`: `UNIQUE(retirement_id, user_id)`
  - `retirement_access.role`: `CHECK (role IN ('OWNER', 'REVIEWER'))`
  - `daily_records`: `UNIQUE(retirement_id, record_date)`
  - `expense_items.quantity`: `CHECK (quantity >= 0)`
  - `expense_items.rate`: `CHECK (rate >= 0)`
  - `expense_items.amount`: `NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED`
  - `supplementary_entries.amount`: `CHECK (amount >= 0)`
  - `connected_retirements`: `UNIQUE(retirement_id, connected_id)`
- **RLS Status**: Enabled on all 9 tables. Exactly 8 policies defined across 3 tables (`profiles`, `retirements`, `daily_records`). 6 tables have zero policies.
- **Triggers**: ZERO triggers exist. No automatic profile creation on user signup.
- **Functions/RPCs**: ZERO PostgreSQL functions exist in `schema.sql`.

### 2. Application Logic & Storage State
- All financial calculations (`calculateTotals`, `mergeRecordCategories`, subtotals) occur synchronously in memory inside `src/utils/storage.ts`.
- `storage.saveDailyRecord()` enforces one record per date by consolidating incoming categories and items into existing date records via case-insensitive category matching.
- Trash lifecycle is evaluated on read: `cleanupExpiredTrash()` filters records where `Date.now() - deletedAt > 48 hours`.
- Demo data loads two complete fixture retirements (`DEMO-7K4M2P`, `DEMO-3N9X8Q`) directly into localStorage with `isDemo: true`.

---

## D. Findings and Risks (Ranked by Importance)

| Rank | Severity | Domain | Finding Description |
|---|---|---|---|
| **1** | **CRITICAL** | Authorization / Security | **Client-Editable Role Self-Escalation**: `supabaseClient.ts` (L23) and `server.ts` (L52) evaluate `user_metadata.role`. Any user can execute `supabase.auth.updateUser({ data: { role: 'admin' } })` to grant themselves system admin rights. |
| **2** | **CRITICAL** | Authorization / Security | **Insecure Email Prefix Rule**: Anyone registering an email starting with `admin@` (e.g., `admin@disposable.com`) is granted administrative privileges across client and server. |
| **3** | **CRITICAL** | Database RLS | **Defenseless Child Tables**: 6 of 9 tables have RLS enabled with 0 policies. Non-superusers are blocked by PostgreSQL default deny from accessing categories, items, supplementary expenses, access records, connections, and audit logs. |
| **4** | **CRITICAL** | Data Integrity | **Missing Profile Trigger / Foreign Key Failure**: No database trigger exists on `auth.users`. New signups do not create a `public.profiles` row. Retirement inserts fail immediately with foreign key constraint violation `23503`. |
| **5** | **HIGH** | Authorization / Business Logic | **Participant OWNER Lockout**: `daily_records` RLS only permits `r.owner_id = auth.uid()`. Collaborators granted `role = 'OWNER'` in `retirement_access` cannot edit daily expenses in the database. |
| **6** | **HIGH** | Authorization / Data Leakage | **Insecure Code Linking**: `AddExistingModal.tsx` assumes it can query an arbitrary retirement by code. Under strict RLS, a user cannot query unowned retirements. Without a secure RPC, either linking fails or `retirements` must be made publicly queryable, leaking sensitive project data. |
| **7** | **HIGH** | Security / Secret Handling | **Runtime Secret Ingestion Endpoint**: `POST /api/admin/set-service-key` in `server.ts` accepts the Supabase Service Role key over HTTP and attempts to write it to disk (`.env`). This exposes root database credentials and fails in read-only container environments. |
| **8** | **MEDIUM** | Schema Mismatch | **Generated Amount Column Collision**: `expense_items.amount` is `GENERATED ALWAYS AS STORED`. If client code sends `amount` during insertion or updates, PostgreSQL aborts the transaction with error `42601`. |
| **9** | **MEDIUM** | Offline Synchronization | **Unimplemented Sync Engine**: The sync queue key `myret_sync_queue` and `syncStatus` flags exist in types, but no queue runner, conflict detection, or background retry code exists. |

---

## E. Recommended Architecture

### 1. Database & Security Architecture
- **Server-Controlled Roles**: Remove all reliance on `user_metadata` and email prefix matching. Store administrator roles in a dedicated table `public.user_roles (user_id UUID, role TEXT, PRIMARY KEY(user_id, role))` or strictly within `auth.users.app_metadata.role` (managed solely by the Supabase service role).
- **Automated Profile Provisioning**: A PostgreSQL trigger function `handle_new_user()` executing `SECURITY DEFINER` with `SET search_path = public, pg_temp` on `auth.users` `AFTER INSERT` creates the user's `public.profiles` record safely, handling null/empty metadata with clean defaults.
- **Two-Tier Participant Model**:
  - `PRIMARY OWNER` (`retirements.owner_id = auth.uid()`): Complete authority. Can rename, delete/trash, restore, permanently delete, transfer ownership, and manage participant access.
  - `OWNER PARTICIPANT` (`retirement_access.role = 'OWNER'`): Can insert, update, and delete daily records, categories, items, and supplementary entries. Cannot delete the retirement, cannot remove the primary owner, and cannot alter other owners' access.
  - `REVIEWER` (`retirement_access.role = 'REVIEWER'`): Read-only access to retirement records and export permissions. Cannot alter data or participant access.
- **Non-Recursive RLS Helper Functions**: Avoid recursive policy execution between `retirements` and `retirement_access` by creating `SECURITY DEFINER` helper functions (`is_retirement_editor(ret_id, user_id)` and `has_retirement_access(ret_id, user_id)`) with strict search paths.

### 2. Transactional Persistence & Financial Integrity
- **Atomic Daily Record Upsert (`upsert_daily_record_hierarchy`)**: A transactional PostgreSQL RPC that accepts the complete daily record with nested categories and items. It validates participant permissions, enforces one record per retirement per date, performs category consolidation, derives item amounts safely without assigning the generated column, recalculates category subtotals and daily totals, updates `retirements.updated_at`, and appends an audit log entry in a single atomic database transaction.
- **Protected Code Claiming (`claim_retirement_by_code`)**: A `SECURITY DEFINER` function that validates code format, ensures the retirement is active (not trashed), grants `REVIEWER` access, records an audit log, and returns the retirement ID without leaking ungranted data.

### 3. Offline-First Architecture
- **Local Storage Engine**: Future transition from `localStorage` to **IndexedDB** (via lightweight wrapper like `idb` or Dexie.js) to store structured relational entities and handle large attachment/audit datasets without hitting the 5MB browser quota.
- **Client-Generated UUIDs**: Client assigns standard RFC 4122 v4 UUIDs to new retirements, daily records, categories, items, and supplementary records upon creation offline. The database respects client-provided UUIDs on synchronization, eliminating the need to re-map IDs.
- **Persistent Outbox Queue**: An IndexedDB object store `sync_outbox` recording mutation events:
  - Structure: `{ id, operation, table, recordId, payload, clientTimestamp, attempts, status, lastError }`.
  - Statuses: `pending`, `syncing`, `synced`, `conflict`, `failed`.
- **Conflict Handling Strategy**:
  - *Daily Records (Same Date)*: If two devices edit the same date offline, the server consolidates categories and appends distinct items rather than overwriting the whole day.
  - *Retirement Details*: Optimistic concurrency via `updated_at` timestamps. If server `updated_at > client_base_updated_at`, flag conflict for user review.
  - *Revoked Access*: If an offline user was revoked while disconnected, the synchronization RPC rejects the payload with an explicit `PERMISSION_REVOKED` code, moving the outbox item to a local quarantine store without corrupting cloud state.
- **Demo Data Isolation**: Demo records remain strictly in local storage and are never enqueued to the outbox. The sync engine explicitly filters out any record with `isDemo: true` or ID matching demo fixtures.

---

## F. Schema Mapping: TypeScript Models to PostgreSQL Tables

| TypeScript Field (`src/types/index.ts`) | PostgreSQL Column (`supabase/schema.sql`) | Type Mapping & Transformation Rules |
|---|---|---|
| `UserProfile.id` | `profiles.id` | `UUID PRIMARY KEY REFERENCES auth.users(id)` |
| `UserProfile.name` | `profiles.name` | `TEXT NOT NULL` |
| `UserProfile.designation` | `profiles.designation` | `TEXT DEFAULT 'Site Construction Engineer'` |
| `UserProfile.phone` | `profiles.phone` | `TEXT` |
| `UserProfile.email` | `profiles.email` | `TEXT NOT NULL` |
| `UserProfile.placement` | `profiles.placement` | `TEXT DEFAULT 'Site Project'` |
| `UserProfile.avatarUrl` | `profiles.avatar_url` | `TEXT` |
| `Retirement.id` | `retirements.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (Accepts client-generated UUID) |
| `Retirement.code` | `retirements.code` | `VARCHAR(12) NOT NULL UNIQUE` (Upper-case normalized) |
| `Retirement.title` | `retirements.title` | `TEXT NOT NULL` |
| `Retirement.project` | `retirements.project` | `TEXT NOT NULL` |
| `Retirement.ownerId` | `retirements.owner_id` | `UUID REFERENCES profiles(id) NOT NULL` |
| `Retirement.status` | `retirements.status` | `VARCHAR(20) CHECK (status IN ('active', 'in_trash'))` |
| `Retirement.deletedAt` | `retirements.deleted_at` | `TIMESTAMPTZ` (Used for 48h recovery calculations) |
| `Retirement.access` | `public.retirement_access` | **Normalized Relation**: Array of `{ user_id, role, granted_at }` stored as child rows. |
| `Retirement.connectedRetirementIds` | `public.connected_retirements` | **Normalized Relation**: Stored as bidirectional rows in join table. |
| `Retirement.isDemo` | *Local Only* | Excluded from PostgreSQL persistence. Kept strictly in client storage. |
| `DailyRecord.id` | `daily_records.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `DailyRecord.retirementId` | `daily_records.retirement_id` | `UUID REFERENCES retirements(id)` |
| `DailyRecord.date` | `daily_records.record_date` | `DATE NOT NULL` (Canonical `YYYY-MM-DD` string mapped to SQL `DATE`) |
| `DailyRecord.dailyTotal` | `daily_records.daily_total` | `NUMERIC(15, 2) NOT NULL DEFAULT 0.00` |
| `DailyRecord.categories` | `public.categories` | **Normalized Relation**: Stored in child table linked via `daily_record_id`. |
| `Category.id` | `categories.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `Category.name` | `categories.name` | `TEXT NOT NULL` |
| `Category.subtotal` | `categories.subtotal` | `NUMERIC(15, 2) NOT NULL DEFAULT 0.00` |
| `Category.items` | `public.expense_items` | **Normalized Relation**: Stored in child table linked via `category_id`. |
| `ExpenseItem.id` | `expense_items.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `ExpenseItem.description` | `expense_items.description` | `TEXT NOT NULL` |
| `ExpenseItem.quantity` | `expense_items.quantity` | `NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0)` |
| `ExpenseItem.rate` | `expense_items.rate` | `NUMERIC(15, 2) NOT NULL CHECK (rate >= 0)` |
| `ExpenseItem.amount` | `expense_items.amount` | `NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED` (Omitted in insert/update) |
| `SupplementaryEntry.id` | `supplementary_entries.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `SupplementaryEntry.retirementId` | `supplementary_entries.retirement_id` | `UUID REFERENCES retirements(id)` |
| `SupplementaryEntry.description` | `supplementary_entries.description` | `TEXT NOT NULL` |
| `SupplementaryEntry.amount` | `supplementary_entries.amount` | `NUMERIC(15, 2) NOT NULL CHECK (amount >= 0)` |
| `ActivityLog.id` | `activity_logs.id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `ActivityLog.retirementId` | `activity_logs.retirement_id` | `UUID REFERENCES retirements(id)` |
| `ActivityLog.userId` | `activity_logs.user_id` | `UUID REFERENCES profiles(id) ON DELETE SET NULL` |
| `ActivityLog.action` | `activity_logs.action` | `TEXT NOT NULL` |
| `ActivityLog.details` | `activity_logs.details` | `TEXT` |
| `ActivityLog.timestamp` | `activity_logs.created_at` | `TIMESTAMPTZ DEFAULT NOW()` |

---

## G. Candidate Migration File Specification

A new, non-conflicting migration file has been prepared for review:
`supabase/migrations/20261014000000_cloud_database_foundation.sql`

### Scope & Structure of Proposed Migration
1. **Schema Integrity & Table Definitions**: Creates all 9 tables safely with explicit constraints, UUID primaries, and foreign keys.
2. **Automated User Profile Trigger**:
   ```sql
   CREATE OR REPLACE FUNCTION public.handle_new_user()
   RETURNS TRIGGER
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $$ ... $$;
   ```
   Attaches to `auth.users` on `AFTER INSERT`, extracting profile fields with resilient fallback defaults.
3. **Role-Based Security & Helper Functions**:
   - `public.is_retirement_editor(ret_id, user_id)`: Checks if user is primary owner OR has `role = 'OWNER'`.
   - `public.has_retirement_access(ret_id, user_id)`: Checks if user is primary owner OR has any role (`OWNER` or `REVIEWER`).
4. **Complete RLS Policy Coverage**:
   - `public.profiles`: Authenticated read, self-insert, self-update.
   - `public.retirements`: Participant read, owner insert/update/delete.
   - `public.retirement_access`: Participant read; primary owner insert/update/delete.
   - `public.daily_records`: Participant read; editor (`primary owner` or `OWNER participant`) insert/update/delete.
   - `public.categories`: Inherited editor read/write.
   - `public.expense_items`: Inherited editor read/write.
   - `public.supplementary_entries`: Inherited editor read/write.
   - `public.connected_retirements`: Inherited editor read/write.
   - `public.activity_logs`: Participant read; authenticated append.
5. **Secure RPC Operations**:
   - `public.claim_retirement_by_code(p_code TEXT)`: Securely links user as `REVIEWER` using code.
   - `public.upsert_daily_record_hierarchy(...)`: Transactional upsert preserving same-date category consolidation without column errors on generated fields.

*Status*: Unapplied. Designed as a standalone proposal file requiring explicit approval prior to execution.

---

## H. Security Review

### 1. Administrator Authorization
- Remove frontend reliance on `user_metadata.role` and email patterns (`admin@*`).
- Establish administrative role checks against `auth.users.app_metadata.role === 'admin'` or a dedicated table `public.user_roles`.
- Server endpoints in `server.ts` must query `app_metadata` or the database directly before permitting user listing or password overrides.

### 2. Service Role Key Protection
- The endpoint `POST /api/admin/set-service-key` must be removed from `server.ts`.
- The service role key must only be supplied via environment variable `SUPABASE_SERVICE_ROLE_KEY` at deployment time.
- Browser client code (`supabaseClient.ts`) uses strictly the public anonymous key (`VITE_SUPABASE_ANON_KEY`).

### 3. Profile Privacy
- Email addresses and phone numbers are protected: `public.profiles` policy should restrict full profile visibility to collaborators sharing at least one active retirement, or require an authenticated user match.

### 4. Retirement Code Security
- Code guessing is mitigated by making `claim_retirement_by_code` return identical generic error messages for invalid, expired, or non-existent codes.
- An application-level or Redis/PostgreSQL rate limiter must cap code claim attempts to 5 attempts per 15 minutes per IP/User to prevent brute force.

---

## I. Offline-First Design Specification

### 1. Local Database & Storage Architecture
- **Engine**: IndexedDB (using `idb` or Dexie.js).
- **Stores**:
  - `retirements` (Local cache of active/trashed retirements)
  - `daily_records` (Consolidated date records with category trees)
  - `supplementary_entries`
  - `activity_logs`
  - `sync_outbox` (Persistent queue of mutations waiting for upload)
  - `sync_conflicts` (Quarantined records requiring resolution)

### 2. Sync Outbox Item Lifecycle
```
[User Action Offline]
       │
       ▼
[Save to IndexedDB] ──► [Append to sync_outbox (status: 'pending')]
                               │
                               ▼
                    [Network Becomes Online]
                               │
                               ▼
               [Process Outbox Queue In Order]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     [HTTP 200 OK]                         [HTTP Error]
            │                                     │
            ▼                          ┌──────────┴──────────┐
  [status: 'synced']                   ▼                     ▼
  [Delete from Outbox]          [Transient/Network]   [403 Auth Revoked]
                                       │                     │
                                       ▼                     ▼
                             [Exponential Backoff]   [status: 'conflict']
                             [Retry up to 5 times]   [Alert User in UI]
```

### 3. PWA Asset Caching & Offline Launch
- `vite.config.ts` currently configures `workbox.globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}']`.
- Verified: Font files (`NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`) and core assets are precached.
- PDF generation libraries (`jspdf`, `jspdf-autotable`) are bundled in the client distribution chunks, ensuring full offline PDF creation capability without external API dependencies.

---

## J. Verification Checklist

The following 51 verification tests are defined to validate the foundation before and during deployment:

### Database & User Profiles
- [ ] **Test 1**: Register a new user via Supabase Auth and verify that exactly one corresponding row appears in `public.profiles`.
- [ ] **Test 2**: Register a user with empty metadata and verify default values ('Site Construction Engineer', 'Site Project') are populated.
- [ ] **Test 3**: Attempt to create a duplicate profile for an existing user ID and verify duplicate insertion is prevented.
- [ ] **Test 4**: Verify that if profile creation fails, the signup error is caught and reported cleanly.
- [ ] **Test 5**: Confirm that an unauthenticated user cannot read any rows from `public.profiles`.
- [ ] **Test 6**: Execute `supabase.auth.updateUser({ data: { role: 'admin' } })` from a regular account and confirm that the user does NOT gain administrative access.
- [ ] **Test 7**: Verify that server administrative endpoints return `403 Forbidden` for users without verified `app_metadata.role === 'admin'`.

### Retirement Access & Sharing
- [ ] **Test 8**: User B attempts to query User A's retirement and receives 0 rows.
- [ ] **Test 9**: Primary owner (User A) updates retirement title and verifies the update persists.
- [ ] **Test 10**: Participant granted `role = 'OWNER'` creates a daily expenditure record and verifies successful persistence.
- [ ] **Test 11**: Participant granted `role = 'OWNER'` attempts to delete the parent retirement and is blocked by RLS.
- [ ] **Test 12**: Participant granted `role = 'REVIEWER'` attempts to insert a daily expenditure record and is blocked by RLS.
- [ ] **Test 13**: Unrelated User C attempts to grant access to User A's retirement and is blocked by RLS.
- [ ] **Test 14**: Attempt to insert two retirements with the same code and verify unique constraint violation `23505`.
- [ ] **Test 15**: Enter an invalid retirement code in `claim_retirement_by_code` and verify generic error `'Invalid retirement code'`.
- [ ] **Test 16**: Claiming an existing code links the user as `REVIEWER` in `public.retirement_access`.
- [ ] **Test 17**: Attempt duplicate code linking and confirm idempotency (no duplicate rows created).
- [ ] **Test 18**: Connecting Retirement A to Retirement B does not allow User B to view Retirement A if User B has no access grant.

### Financial Data & Daily Records
- [ ] **Test 19**: Attempt to insert two daily records for the same retirement and date; verify `UNIQUE(retirement_id, record_date)` enforces single record.
- [ ] **Test 20**: In `upsert_daily_record_hierarchy`, simulate an item constraint failure; verify the entire daily record transaction rolls back.
- [ ] **Test 21**: Retry an identical daily record upsert and verify no duplicate categories or items are created.
- [ ] **Test 22**: Verify inserting an item without providing `amount` correctly generates `amount = quantity * rate`.
- [ ] **Test 23**: Verify precision: `quantity = 3.33`, `rate = 100.00` yields `amount = 333.00`.
- [ ] **Test 24**: Verify category subtotal equals exact sum of item amounts, and daily total equals sum of subtotals.
- [ ] **Test 25**: Add supplementary entries and verify they are reflected in general totals without altering daily category subtotals.
- [ ] **Test 26**: Connect two retirements and verify PDF export aggregates totals without double-counting items.
- [ ] **Test 27**: Verify activity logs record genuine `auth.uid()` and server timestamps.

### Trash Lifecycle & Retention
- [ ] **Test 28**: Move retirement to trash; verify `status = 'in_trash'` and `deleted_at` is set.
- [ ] **Test 29**: Restore retirement within 48 hours; verify `status = 'active'` and `deleted_at IS NULL`.
- [ ] **Test 30**: Non-owner attempts to permanently delete a trashed retirement; verify operation is rejected.
- [ ] **Test 31**: Permanently delete a retirement; verify cascading deletion removes all child records (`daily_records`, `categories`, `items`, `supplementary`, `logs`).
- [ ] **Test 32**: Restore an item that was permanently deleted remotely; verify local device receives deletion confirmation and purges local copy.

### Offline-First Architecture
- [ ] **Test 33**: Create retirement offline; verify client-generated UUID persists unchanged upon cloud synchronization.
- [ ] **Test 34**: Add daily record while offline, restart browser, verify record remains in pending queue.
- [ ] **Test 35**: Simulate server timeout during sync; verify item remains in outbox and retries.
- [ ] **Test 36**: Trigger repeated synchronization of the same outbox item; verify idempotency prevents duplicate records.
- [ ] **Test 37**: Sync a daily record with 3 categories and 10 items; verify complete hierarchy appears in PostgreSQL atomically.
- [ ] **Test 38**: Edit same date on Device A and Device B while offline; verify server merges categories without data loss.
- [ ] **Test 39**: Verify sync requests include Bearer token and are evaluated against RLS upon re-connection.
- [ ] **Test 40**: Revoke user access on cloud while user is offline; verify subsequent offline sync attempts are rejected with 403.
- [ ] **Test 41**: Verify handling of locally queued edits against a retirement permanently deleted on the server.
- [ ] **Test 42**: Disconnect internet, refresh application in browser, verify application shell and UI load completely from Service Worker cache.
- [ ] **Test 43**: Generate PDF report while offline using local data; verify successful download.
- [ ] **Test 44**: Load demo data; verify outbox remains empty and zero demo records synchronize to cloud.
- [ ] **Test 45**: Verify UI sync indicator transitions accurately: `Synced` (green) -> `Syncing...` (yellow) -> `Offline Mode`.

### Security & Deployment
- [ ] **Test 46**: Inspect client bundle and network requests; confirm `SUPABASE_SERVICE_ROLE_KEY` is nowhere present in client code.
- [ ] **Test 47**: Send unauthorized request to `/api/admin/users`; confirm `401 Unauthorized` or `403 Forbidden`.
- [ ] **Test 48**: Attempt direct REST insert into `public.categories` as unauthenticated user; confirm rejection.
- [ ] **Test 49**: Verify `is_retirement_editor` cannot be executed by arbitrary unauthenticated callers.
- [ ] **Test 50**: Verify rate limiting blocks rapid brute-force calls to `claim_retirement_by_code`.
- [ ] **Test 51**: Confirm all existing localStorage features function unchanged prior to enabling cloud mode.

*Verification Note*: None of the above tests have been executed against a live database yet. All tests are specified for execution during Phase 2 and Phase 3 validation.

---

## K. Unresolved Architectural Questions

The following decisions must be resolved and approved before applying the database migration:

1. **User Role Storage**: Should administrative roles be stored in a new dedicated database table `public.user_roles (user_id UUID, role TEXT)`, or in Supabase Auth's `auth.users.app_metadata.role` managed exclusively via server-side Admin API calls?
2. **Profile Discoverability**: Should authenticated users be able to look up user names by email when sharing a retirement, or should invitations be blind until the recipient claims the link?
3. **Trash Cleanup Execution**: How should the 48-hour trash expiration be permanently pruned in production: via Supabase `pg_cron`, a nightly GitHub Action / server cron calling a secured RPC, or evaluated lazily on query?
4. **Offline Database Technology**: Shall IndexedDB be implemented using the native browser API, `idb` (minimal promise wrapper), or `Dexie.js` for reactive schema handling?

---

## L. Safety Confirmation

I explicitly confirm the following safety parameters for Phase 1:
1. **Existing Application Source Code**: ZERO modified.
2. **Existing Files**: ZERO overwritten, renamed, or deleted.
3. **New Candidate Migration File**: Created only as a non-conflicting, unapplied proposal (`supabase/migrations/20261014000000_cloud_database_foundation.sql`).
4. **SQL Execution**: ZERO SQL commands executed against any database.
5. **Live Database Access**: ZERO connections or queries made to remote Supabase instances.
6. **LocalStorage Data**: ZERO data migrated or removed.
7. **UI & Calculations**: ZERO changes made to application appearance, financial logic, or navigation.

---

**Phase 1 Preparation Complete. Standing by for review and explicit approval before any further action.**
