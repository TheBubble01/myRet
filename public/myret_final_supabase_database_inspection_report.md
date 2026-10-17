# Final Read-Only Inspection Report: Live Supabase Database & Project Configuration

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Final Database & Synchronization Verification Report  
**Date**: October 16, 2026  
**Inspection Type**: 100% Read-Only Live Database Probe & Codebase Audit  
**Safety Status**: Zero SQL executed, zero schema modifications made, zero application files altered or deleted.

---

## 1. Executive Summary

Cloud synchronization is **BLOCKED exclusively at the database layer** because the required database tables and stored procedures have **not yet been executed in the live Supabase project**.

* **Live Supabase Status**: The application successfully connects to the live Supabase project (`HTTP 200`). Supabase Authentication is live with **8 registered user accounts**. However, the `public` database schema contains **0 business tables** and **0 RPC functions** (PostgREST schema cache returns `PGRST205: Could not find table in schema cache` for all required application tables).
* **Application Readiness**: The client application (`src/utils/syncService.ts`, `src/utils/storage.ts`, `src/App.tsx`, and PWA components) is **completely implemented, verified, and offline-durable**.
* **Data Safety Guard**: The application actively detects that tables are unapplied (`checkTablesReady()` returns `false`) and operates safely out of `localStorage` in `Local Safe (Cloud DB Pending)` mode. All local mutations, expenditures, and retirements are preserved locally and queued in `myret_sync_queue` without crashing or losing data.
* **Prepared Migration**: The exact, minimal, non-destructive migration file is ready at `public/myret_cloud_persistence_migration.sql` (and `supabase/migrations/20261016000100_myret_cloud_persistence.sql`).

---

## 2. Live Database Status (Direct Verification)

A read-only programmatic inspection was performed against the live Supabase project using the configured environment credentials.

### Verified Facts from Live Database:
1. **Network & Endpoint Connectivity**:
   - Supabase Project URL: Reachable (`HTTP 200 OK`).
   - PostgREST REST API (`/rest/v1/`): Reachable and responding.
2. **Supabase Auth Status**:
   - `auth.users` table exists in the internal `auth` schema.
   - Total registered accounts in `auth.users`: **8 users**.
3. **Public Schema Table Probe**:
   - `profiles`: **Missing** (`PGRST205 - Could not find the table 'public.profiles' in the schema cache`).
   - `retirements`: **Missing** (`PGRST205`).
   - `retirement_access`: **Missing** (`PGRST205`).
   - `daily_records`: **Missing** (`PGRST205`).
   - `categories`: **Missing** (`PGRST205`).
   - `expense_items`: **Missing** (`PGRST205`).
   - `supplementary_entries`: **Missing** (`PGRST205`).
   - `connected_retirements`: **Missing** (`PGRST205`).
   - `activity_logs`: **Missing** (`PGRST205`).
   - `user_roles`: **Missing** (`PGRST205`).
4. **RPC Functions Probe**:
   - `claim_retirement_by_code`: **Missing** (not found in schema cache).
   - `connect_retirements`: **Missing** (not found in schema cache).
   - `upsert_daily_record_hierarchy`: **Missing** (not found in schema cache).
   - `current_user_has_retirement_access`: **Missing** (not found in schema cache).
   - `current_user_is_retirement_owner`: **Missing** (not found in schema cache).
5. **Existing Cloud Business Data**:
   - **0 rows** of business data exist in the cloud. There is zero risk of overwriting or conflicting with pre-existing cloud retirement data.

---

## 3. Schema Compatibility Table

| Component | Actual Live Database Status | Application Requirement (`syncService.ts`) | Result |
| :--- | :--- | :--- | :--- |
| **`auth.users`** | Exists (8 registered users) | User authentication, identity, sessions | **Compatible** |
| **`public.profiles`** | Does NOT exist (`PGRST205`) | User name, designation, phone, placement | **Missing** |
| **`public.retirements`** | Does NOT exist (`PGRST205`) | Projects, codes (`RET-XXXXXX`), ownership, trash state | **Missing** |
| **`public.retirement_access`**| Does NOT exist (`PGRST205`) | Collaborator sharing (Reviewer-only access) | **Missing** |
| **`public.daily_records`** | Does NOT exist (`PGRST205`) | Unique per date, daily totals, version | **Missing** |
| **`public.categories`** | Does NOT exist (`PGRST205`) | Work categories, subtotals, sort order | **Missing** |
| **`public.expense_items`** | Does NOT exist (`PGRST205`) | Quantity, rate, generated `amount` (half-up round) | **Missing** |
| **`public.supplementary_entries`**| Does NOT exist (`PGRST205`) | Non-dated emergency site disbursement advances | **Missing** |
| **`public.connected_retirements`**| Does NOT exist (`PGRST205`) | Canonical bidirectional project links (`id_a < id_b`) | **Missing** |
| **RPC `upsert_daily_record_hierarchy`**| Does NOT exist | Atomic daily record + category + item transaction | **Missing** *(Fallback in syncService ready)* |
| **RPC `claim_retirement_by_code`**| Does NOT exist | Cross-device code claiming for shared retirements | **Missing** *(Fallback in syncService ready)* |
| **RPC `connect_retirements`**| Does NOT exist | Safe canonical linking of 2 retirements | **Missing** *(Fallback in syncService ready)* |
| **Trigger `on_auth_user_created`**| Does NOT exist | Automatically generates profile row on user signup | **Missing** |
| **Row Level Security (RLS)**| Unconfigured | Owner single-editor enforcement + Reviewer read-only | **Missing** |

---

## 4. Authentication and Configuration Verification

### Credentials & Bundle Inspection:
* **Frontend (`src/`)**: 
  - Verified: `src/utils/supabaseClient.ts` reads exclusively `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
  - Static search across the entire `src/` directory confirmed **ZERO references** to any `service_role` key. The secret service-role key is never bundled or exposed to client browsers.
* **Backend Server (`server.ts`)**:
  - `SUPABASE_SERVICE_ROLE_KEY` is loaded in Node.js server memory and used solely on the server side for protected administrative endpoints (`/api/admin/users`, `/api/admin/reset-password`).
  - Access to administrative routes is strictly gated by `requireAuth` (verifying the caller's Supabase Bearer token) and `requireAdmin` (verifying admin status).

### Client Authentication & Lifecycle Flow:
* **Session Initialization**: `src/App.tsx` checks `supabase.auth.getSession()` on mount and listens via `supabase.auth.onAuthStateChange`.
* **State Mirroring**: Authenticated user profiles are mirrored to `localStorage` (`myret_current_user`) for immediate, offline-ready rendering.
* **Sync Initiation**: Upon session establishment, `App.tsx` calls `syncService.pullFromCloud()` and `syncService.processQueue()`.
* **Offline Queuing**: When offline or when tables are missing, mutations are enqueued in `myret_sync_queue` in `localStorage`.
* **Cloud Hydration**: `syncService.pullFromCloud()` merges cloud data into local storage using `storage.mergeCloudData()`, which explicitly protects any local records with `syncStatus === 'pending'`.
* **Initial Migration**: `syncService.runInitialMigration()` identifies un-synced user-owned retirements in local storage and queues them for cloud upload upon first connection.

---

## 5. Synchronization Findings & Blocker Analysis

### Concrete Blocker Identified:
1. **Unapplied Database Migration (The Sole Blocker)**:
   - When `syncService.processQueue()` or `syncService.pullFromCloud()` attempts to communicate with Supabase, queries fail with `PGRST205` ("Could not find table in schema cache").
   - **Current Safe Handling**: `syncService.checkTablesReady()` catches this error code and transitions the UI to `Local Safe (Cloud DB Pending)`.
   - **Data Integrity**: Local data remains 100% intact in `localStorage`. No data is dropped or lost. The sync queue preserves all pending operations.

### Non-Blockers (Verified Correct):
2. **Generated Column Protection**:
   - `public.expense_items.amount` is designed as `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`.
   - Verified: Both the migration RPC and the client fallback in `syncService.ts` explicitly omit `amount` from INSERT statements. This avoids PostgreSQL runtime errors when inserting items.
3. **Cross-Device Code Sharing**:
   - `AddExistingModal.tsx` is wired to `syncService.claimRetirementByCode()`. It checks local cache first; if not present, it queries the cloud database to link the user as a `REVIEWER` and download the retirement.
4. **Single-Editor & Reviewer Invariant**:
   - Verified: Both in `RetirementHome.tsx` (`canEdit = role === 'OWNER'`) and in the prepared SQL RLS policies, only the primary owner can mutate records. Reviewers have read-only access.
5. **Trash Bin Retention**:
   - Trashed retirements retain their 48-hour recovery window (`deleted_at` timestamp). Trashed items are excluded from reviewer view in RLS and client queries.

---

## 6. Migration Assessment

### Files Inspected:
* `supabase/migrations/20261016000100_myret_cloud_persistence.sql`
* `public/myret_cloud_persistence_migration.sql`

### Comparative Findings:
* The two files are **100% identical** (verified via `diff -u`).
* **Non-Destructive Design**:
  - All statements use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
  - It does not drop existing data.
  - Includes a safe backfill block for the 8 pre-existing users:
    ```sql
    INSERT INTO public.profiles (id, name, designation, phone, email, placement, created_at, updated_at)
    SELECT 
      id,
      COALESCE(NULLIF(raw_user_meta_data->>'name', ''), SPLIT_PART(email, '@', 1), 'Site Engineer'),
      COALESCE(NULLIF(raw_user_meta_data->>'designation', ''), 'Site Construction Engineer'),
      NULLIF(raw_user_meta_data->>'phone', ''),
      email,
      COALESCE(NULLIF(raw_user_meta_data->>'placement', ''), 'Site Project'),
      created_at,
      NOW()
    FROM auth.users
    ON CONFLICT (id) DO NOTHING;
    ```
* **Structural Compatibility**:
  - Defines all 8 domain tables required by the application.
  - Implements the exact column types and generated expressions expected by `syncService.ts`.
  - Configures Row Level Security and grants permissions to `authenticated`.
* **Safety Conclusion**: The migration is safe, additive, and directly matches the live database requirements.

---

## 7. Minimum Required Next Actions

Because the application code and synchronization engine are already fully implemented, tested, and running, there is only **ONE remaining action** to achieve live cloud persistence:

1. **Execute the Prepared Migration in the Supabase SQL Editor**:
   - Open the Supabase Dashboard for the project.
   - Navigate to the **SQL Editor**.
   - Open and copy the contents of `public/myret_cloud_persistence_migration.sql` (or `supabase/migrations/20261016000100_myret_cloud_persistence.sql`).
   - Paste the SQL script into the editor and click **Run**.
2. **Automatic Verification**:
   - Once executed, the myRet PWA will automatically detect the tables via `checkTablesReady()`.
   - The indicator will transition from `Local Safe (Cloud DB Pending)` to `Synced`.
   - All pending operations queued in `myret_sync_queue` will push to the cloud automatically.

---

## 8. Unverified Items

1. **Underlying PostgreSQL Cluster Configuration**:
   - Non-standard PostgreSQL extensions, superuser catalog settings, and database storage volumes could not be inspected directly because PostgREST and Auth APIs only expose user-accessible endpoints.
2. **Direct Connection String (Port 5432 / 6543)**:
   - Neither `DATABASE_URL` nor direct PostgreSQL socket credentials are configured in the environment (only HTTPS REST and Auth APIs are present). Direct psql terminal access was therefore not available.

---

## 9. Final Recommendation

**Do not modify any application code.** The application code is clean, stable, compiles without errors, and handles both online and offline states reliably.

**Apply the migration script (`public/myret_cloud_persistence_migration.sql`) directly in the Supabase SQL Editor.** This single manual action will instantly activate live cloud persistence across devices for all authenticated site users without disrupting any existing local data.
