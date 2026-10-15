# Pre-Implementation Audit Report: myRet Supabase Database Storage

**Project**: myRet — Digital Construction-Site Expenditure and Retirement Management  
**Audit Date**: October 12, 2026  
**Auditor**: Lead System Engineer  

---

## Executive Summary

This technical audit reviews the current architecture of **myRet** before introducing persistent Supabase database storage. The audit evaluates `src/utils/storage.ts`, `src/utils/supabaseClient.ts`, `src/types/index.ts`, `server.ts`, `supabase/schema.sql`, and all frontend components managing retirements, daily expense records, supplementary payments, sharing access, connected projects, activity audit logs, trash lifecycle, PDF exports, and user administration.

### Key Takeaways
1. **Current Storage Architecture**: The application currently runs almost entirely on browser `localStorage` wrapped by the singleton `StorageService` in `src/utils/storage.ts`.
2. **Supabase Usage**: Supabase is currently utilized strictly for Auth (`signInWithPassword`, `signUp`, `getSession`, password resets) and server-side administrative endpoints in `server.ts`. No business records (retirements, daily records, expenses, logs) are saved to Supabase yet.
3. **Database Schema State**: `supabase/schema.sql` defines 9 relational tables, but 6 of them currently enable Row Level Security (RLS) with **zero policies**, meaning client queries to those tables will fail by default.
4. **Offline Synchronization**: While types and keys for offline sync exist, **no queue processing or actual offline-to-cloud synchronization mechanism is currently implemented**.
5. **Security Vulnerability**: User roles can currently be self-escalated by regular users in the browser because `supabaseClient.ts` trusts `user_metadata.role`, which any authenticated user can alter via the client SDK.

---

## 1. Storage Method Inventory & Calling Files

Every persistence operation currently routes through `storage` (`src/utils/storage.ts`), backed by browser `localStorage`. Below is the complete catalog of methods and their invocation points across the codebase:

| Storage Method | Method Signature & Purpose | Calling Files & Line References |
| :--- | :--- | :--- |
| `getCurrentUser()` | Returns `UserProfile \| null` from `localStorage` | `src/components/modals/AboutModal.tsx` (L19)<br>`src/utils/storage.ts` (L124, L168, L186, L581, L598) |
| `setCurrentUser(user)` | Saves user profile to `myret_current_user` and syncs into `myret_users_list` | `src/App.tsx` (L86, L106)<br>`src/components/auth/AuthModal.tsx` (L84, L132) |
| `clearCurrentUser()` | Removes `myret_current_user` from `localStorage` | `src/App.tsx` (L91, L111, L212) |
| `getAllUsers()` | Returns `UserProfile[]` cached in `myret_users_list` | `src/utils/storage.ts` (L105) |
| `updateProfile(profile)` | Updates `myret_current_user`, syncs `myret_users_list`, and updates `ownerName`/`designation`/`phone` on all owned retirements | `src/components/auth/ProfileModal.tsx` (L83) |
| `getSupabaseConfig()` | Reads custom URL/Key or defaults to Vite env vars | `src/components/modals/AboutModal.tsx` (L15, L16) |
| `setSupabaseConfig(config)` | Saves Supabase connection details to `myret_supabase_config` | `src/components/modals/AboutModal.tsx` (L26) |
| `getRetirements(includeTrash)` | Filters retirements by current user (owner or in `access[]`) and `status === 'active'` (pruning expired trash) | `src/App.tsx` (L69)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L34) |
| `getTrashRetirements()` | Returns items with `status === 'in_trash'` belonging to owner or admin | `src/App.tsx` (L219)<br>`src/components/dashboard/TrashView.tsx` (L19) |
| `getRetirementById(id)` | Finds retirement by internal UUID string | `src/App.tsx` (L168)<br>`src/components/retirement/RetirementHome.tsx` (L80)<br>`src/components/retirement/ExportPdfModal.tsx` (L57)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L40, L108)<br>`src/utils/storage.ts` (L457, L468, L492, L503) |
| `getRetirementByCode(code)` | Case-insensitive lookup by human-friendly code (e.g. `RET-XXXXXX`) | `src/components/dashboard/AddExistingModal.tsx` (L36)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L92) |
| `saveRetirement(retirement)` | Inserts or updates retirement object in `myret_retirements` | `src/components/dashboard/CreateRetirementModal.tsx` (L58, L99)<br>`src/components/dashboard/AddExistingModal.tsx` (L70)<br>`src/components/retirement/ShareModal.tsx` (L79, L102)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L65, L66, L111, L117)<br>`src/utils/storage.ts` (L459, L470, L494, L505) |
| `moveToTrash(id)` | Sets `status = 'in_trash'`, records `deletedAt = ISO`, and logs activity | `src/App.tsx` (L172, L179)<br>`src/components/retirement/RetirementHome.tsx` (L100) |
| `restoreFromTrash(id)` | Resets `status = 'active'`, deletes `deletedAt`, logs activity | `src/components/dashboard/TrashView.tsx` (L27) |
| `permanentlyDelete(id)` | Deletes retirement, all associated `daily_records`, `supplementary`, and `activity_logs` | `src/components/dashboard/TrashView.tsx` (L33) |
| `cleanupExpiredTrash()` | Prunes retirements where `now - deletedAt > 48h` (private, called automatically by getters) | `src/utils/storage.ts` (L69, L166, L184) |
| `getDailyRecords(retirementId)` | Retrieves daily records for a retirement, normalizes calendar dates (`YYYY-MM-DD`), consolidates duplicate dates via `mergeRecordCategories`, and sorts chronologically | `src/App.tsx` (L544)<br>`src/components/retirement/RetirementHome.tsx` (L54, L82)<br>`src/components/retirement/DailyRecordModal.tsx` (L265)<br>`src/components/retirement/ExportPdfModal.tsx` (L58)<br>`src/utils/storage.ts` (L511) |
| `saveDailyRecord(record)` | Calculates subtotals/totals, consolidates with existing same-date record if present, saves to `myret_daily_records`, touches retirement `updatedAt` | `src/components/retirement/RetirementHome.tsx` (L150) |
| `deleteDailyRecord(id, retId)` | Deletes record from `myret_daily_records`, touches retirement `updatedAt` | `src/components/retirement/RetirementHome.tsx` (L166) |
| `getSupplementaryEntries(retId)` | Retrieves supplementary entries sorted by `createdAt` | `src/App.tsx` (L545)<br>`src/components/retirement/RetirementHome.tsx` (L57, L83)<br>`src/components/retirement/ExportPdfModal.tsx` (L59)<br>`src/utils/storage.ts` (L519) |
| `saveSupplementaryEntry(entry)` | Inserts/updates in `myret_supplementary`, touches retirement `updatedAt` | `src/components/retirement/RetirementHome.tsx` (L177) |
| `deleteSupplementaryEntry(id, retId)` | Deletes from `myret_supplementary`, touches retirement `updatedAt` | `src/components/retirement/RetirementHome.tsx` (L187) |
| `calculateTotals(retId, start, end)` | Computes `dailyRetirementTotal`, `supplementaryTotal`, `generalTotal`, category summaries, and daily summaries | `src/components/dashboard/RetirementCard.tsx` (L38)<br>`src/components/retirement/RetirementHome.tsx` (L88)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L191) |
| `getActivityLogs(retirementId)` | Retrieves audit logs for retirement sorted newest first | `src/components/retirement/RetirementHome.tsx` (L731) |
| `logActivity(retId, action, details)` | Appends log with current user ID/name to `myret_activity_logs` (max 200 logs) | `src/components/admin/AdminResetPasswordModal.tsx` (L117)<br>`src/components/dashboard/CreateRetirementModal.tsx` (L59, L100)<br>`src/components/dashboard/AddExistingModal.tsx` (L71)<br>`src/components/retirement/RetirementHome.tsx` (L151, L167, L178, L188)<br>`src/components/retirement/ShareModal.tsx` (L80, L103)<br>`src/components/retirement/ConnectRetirementModal.tsx` (L68, L118)<br>`src/components/retirement/ExportPdfModal.tsx` (L84)<br>`src/utils/storage.ts` (L224, L237) |
| `loadDemoData(activeUser)` | Seeds two interconnected demo retirements (`DEMO-7K4M2P` and `DEMO-3N9X8Q`), daily entries, and logs, assigned to active user | `src/App.tsx` (L191) |
| `clearDemoData()` | Removes all records with `isDemo === true` and their child items | `src/App.tsx` (L201) |
| `hasDemoData()` | Returns boolean whether any demo retirement exists in storage | `src/App.tsx` (L220) |

---

## 2. Current State of Database & Storage Operations

Across the codebase, operations fall into three distinct operational states:

### A. Operations Communicating with Supabase
1. **User Authentication & Session Management**:
   - `supabase.auth.signInWithPassword()` (`AuthModal.tsx`)
   - `supabase.auth.signUp()` with metadata (`AuthModal.tsx`)
   - `supabase.auth.resetPasswordForEmail()` (`AuthModal.tsx`)
   - `supabase.auth.resend()` (`AuthModal.tsx`)
   - `supabase.auth.getSession()` and `supabase.auth.onAuthStateChange()` (`App.tsx`, `AdminUserManagement.tsx`)
   - `supabase.auth.signOut()` (`App.tsx`)
2. **User Profile Sync**:
   - `supabase.auth.updateUser()` (`ProfileModal.tsx`)
   - `supabase.from('profiles').upsert()` (`ProfileModal.tsx`, wrapped in a try/catch acknowledging the table may not exist yet)
3. **Administrative Backend Routes (`server.ts`)**:
   - `adminClient.auth.admin.listUsers()` (`/api/admin/users`)
   - `adminClient.auth.admin.updateUserById()` (`/api/admin/reset-password`)
   - Service Role Key verification (`/api/admin/set-service-key`)

### B. Operations Currently Solely in `localStorage`
1. **Retirements**: Creation, editing, title/project changes, moving to trash, restoring, permanent deletion.
2. **Daily Expenditure Records**: Creating, editing, grouping by date, category and expense item mutations.
3. **Supplementary Expenses**: Creating, editing, deleting.
4. **Access Control & Sharing**: Adding reviewers/owners via email/user ID (`retirement.access[]`).
5. **Connecting Retirements**: Bidirectional linking (`retirement.connectedRetirementIds[]`).
6. **Activity History / Audit Logging**: All activity logging (`storage.logActivity`).
7. **Trash Bin Lifecycle**: 48-hour expiration calculation and local pruning.
8. **Demo Data**: Storing, toggling, and clearing demo records.

### C. Operations With No Database Implementation at All
- **No data sync between clients**: Changes made on one device or browser tab do not reach other users or devices.
- **`storage.getRetirementByCode()`**: Searches only the local browser's `localStorage`. Linking an existing retirement created by another engineer on another machine fails because that retirement does not exist in the second browser's local store.
- **Consolidated PDF Export across users**: Aggregates only data cached locally.

---

## 3. SQL Schema Analysis (`supabase/schema.sql`)

The `supabase/schema.sql` file defines **9 tables**, **9 indexes**, and **9 RLS policies**:

### 1. `public.profiles`
- **Columns**: `id` (UUID, PK, `REFERENCES auth.users ON DELETE CASCADE`), `name` (TEXT NOT NULL), `designation` (TEXT DEFAULT 'Site Construction Engineer'), `phone` (TEXT), `email` (TEXT NOT NULL), `placement` (TEXT DEFAULT 'Site Project'), `avatar_url` (TEXT), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `updated_at` (TIMESTAMPTZ DEFAULT NOW()).
- **RLS**: Enabled.
  - Policy: `"Public profiles are viewable by authenticated users"` (`SELECT TO authenticated USING (true)`).
  - Policy: `"Users can update their own profile"` (`UPDATE TO authenticated USING (auth.uid() = id)`).
- **Defect**: No `INSERT` policy exists for `profiles`. If users insert their profile on signup via client, it will fail unless a database trigger on `auth.users` creates it or an `INSERT` policy is defined.

### 2. `public.retirements`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `code` (VARCHAR(12) NOT NULL UNIQUE), `title` (TEXT NOT NULL), `project` (TEXT NOT NULL), `owner_id` (UUID `REFERENCES public.profiles(id) ON DELETE CASCADE` NOT NULL), `status` (VARCHAR(20) DEFAULT 'active' `CHECK (status IN ('active', 'in_trash'))`), `deleted_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `updated_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Indexes**: `idx_retirements_owner` (`owner_id`), `idx_retirements_code` (`code`), `idx_retirements_status` (`status`).
- **RLS**: Enabled.
  - Policy: `"Users can view retirements they own or have access to"` (`SELECT USING (owner_id = auth.uid() OR EXISTS in retirement_access)`).
  - Policy: `"Owners can insert and update their retirements"` (`INSERT WITH CHECK (owner_id = auth.uid())`).
  - Policy: `"Owners can update their retirements"` (`UPDATE USING (owner_id = auth.uid())`).
  - Policy: `"Owners can delete their retirements"` (`DELETE USING (owner_id = auth.uid())`).

### 3. `public.retirement_access`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `retirement_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `user_id` (UUID `REFERENCES public.profiles(id) ON DELETE CASCADE` NOT NULL), `role` (VARCHAR(20) DEFAULT 'REVIEWER' `CHECK (role IN ('OWNER', 'REVIEWER'))`), `granted_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Constraints**: `UNIQUE(retirement_id, user_id)`.
- **RLS**: Enabled.
  - **Critical Defect**: `ALTER TABLE public.retirement_access ENABLE ROW LEVEL SECURITY;` is executed, but **ZERO POLICIES** are defined for `retirement_access`. Any `SELECT`, `INSERT`, `UPDATE`, or `DELETE` on `retirement_access` by client roles will be rejected with `permission denied`.

### 4. `public.daily_records`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `retirement_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `record_date` (DATE NOT NULL), `daily_total` (NUMERIC(15, 2) DEFAULT 0.00 NOT NULL), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `updated_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Constraints**: `UNIQUE(retirement_id, record_date)`.
- **Indexes**: `idx_daily_records_ret` (`retirement_id`), `idx_daily_records_date` (`record_date`).
- **RLS**: Enabled.
  - Policy: `"Daily records viewable by retirement participants"` (`SELECT`).
  - Policy: `"Daily records modifiable by owners"` (`ALL USING (owner_id = auth.uid())`).
  - **Defect**: Non-owner participants granted `OWNER` role in `retirement_access` cannot edit daily records under this policy (only the primary `retirements.owner_id` can).

### 5. `public.categories`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `daily_record_id` (UUID `REFERENCES public.daily_records(id) ON DELETE CASCADE` NOT NULL), `name` (TEXT NOT NULL), `subtotal` (NUMERIC(15, 2) DEFAULT 0.00 NOT NULL), `sort_order` (INT DEFAULT 0).
- **Indexes**: `idx_categories_record` (`daily_record_id`).
- **RLS**: Enabled.
  - **Critical Defect**: RLS is enabled, but **ZERO POLICIES** are defined for `public.categories`.

### 6. `public.expense_items`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `category_id` (UUID `REFERENCES public.categories(id) ON DELETE CASCADE` NOT NULL), `description` (TEXT NOT NULL), `quantity` (NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0)), `rate` (NUMERIC(15, 2) NOT NULL CHECK (rate >= 0)), `amount` (NUMERIC(15, 2) `GENERATED ALWAYS AS (quantity * rate) STORED`), `created_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Indexes**: `idx_expense_items_cat` (`category_id`).
- **RLS**: Enabled.
  - **Critical Defect**: RLS is enabled, but **ZERO POLICIES** are defined for `public.expense_items`.

### 7. `public.supplementary_entries`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `retirement_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `description` (TEXT NOT NULL), `amount` (NUMERIC(15, 2) NOT NULL CHECK (amount >= 0)), `created_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Indexes**: `idx_supplementary_ret` (`retirement_id`).
- **RLS**: Enabled.
  - **Critical Defect**: RLS is enabled, but **ZERO POLICIES** are defined for `public.supplementary_entries`.

### 8. `public.connected_retirements`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `retirement_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `connected_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `created_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Constraints**: `UNIQUE(retirement_id, connected_id)`.
- **RLS**: Enabled.
  - **Critical Defect**: RLS is enabled, but **ZERO POLICIES** are defined for `public.connected_retirements`.

### 9. `public.activity_logs`
- **Columns**: `id` (UUID DEFAULT `gen_random_uuid()` PK), `retirement_id` (UUID `REFERENCES public.retirements(id) ON DELETE CASCADE` NOT NULL), `user_id` (UUID `REFERENCES public.profiles(id) ON DELETE SET NULL`), `action` (TEXT NOT NULL), `details` (TEXT), `created_at` (TIMESTAMPTZ DEFAULT NOW()).
- **Indexes**: `idx_activity_logs_ret` (`retirement_id`).
- **RLS**: Enabled.
  - **Critical Defect**: RLS is enabled, but **ZERO POLICIES** are defined for `public.activity_logs`.

---

## 4. Discrepancies Between TypeScript Models & SQL Schema

| Dimension | TypeScript Model (`src/types/index.ts`) | SQL Schema (`supabase/schema.sql`) | Technical Impact |
| :--- | :--- | :--- | :--- |
| **Retirement Structure** | `Retirement` embeds `access: RetirementAccess[]` and `connectedRetirementIds: string[]` directly on the object. Also has denormalized `ownerName`, `ownerDesignation`, `ownerPhone`. | `public.retirements` only stores `owner_id`. Access and connected IDs are normalized into separate tables (`retirement_access`, `connected_retirements`). | When reading from Supabase, queries must JOIN `profiles`, `retirement_access`, and `connected_retirements` to assemble the expected TypeScript `Retirement` object. |
| **Demo Flag** | `Retirement.isDemo?: boolean` exists in TS. | `isDemo` column **does not exist** in `public.retirements`. | Demo retirements cannot be stored in the database without adding the column, or demo data must be strictly isolated to `localStorage` (recommended). |
| **Daily Record Tree Structure** | `DailyRecord` embeds `categories: Category[]`, and each `Category` embeds `items: ExpenseItem[]` as a 3-level nested JSON object. | Normalization into 3 relational tables: `daily_records` -> `categories` -> `expense_items`. | Writing a single daily record requires inserting/updating `daily_records`, child `categories`, and `expense_items`. Deleting an item or category requires explicit deletion in SQL. |
| **Date Field Naming** | `DailyRecord.date: string` (`YYYY-MM-DD`). | `daily_records.record_date: DATE`. | Field name mismatch (`date` vs `record_date`). Conversion required on read/write. |
| **Generated Column in Items** | `ExpenseItem.amount: number` is calculated in TS via `calculateAmount(quantity, rate)`. | `expense_items.amount` is a `GENERATED ALWAYS AS (quantity * rate) STORED` column. | Client **must not send** `amount` in `INSERT` or `UPDATE` payloads to Supabase, or PostgreSQL will throw error `42601 (cannot insert into column "amount")`. |
| **Activity Log User Info** | `ActivityLog` has `userName: string`. | `activity_logs` has only `user_id UUID REFERENCES profiles(id)`. | Reading logs requires joining `profiles(name)` or mapping `user_id` to profile name. |
| **User Role Column** | `UserProfile.role?: string` ('admin' \| 'tech-admin' \| 'user'). | `profiles` table has **no role column**! Roles are currently inferred from auth metadata or hardcoded emails. | An admin role cannot be securely queried via database RLS without storing or checking roles in PostgreSQL. |

---

## 5. Critical Application Behaviors That Must Be Preserved

1. **Same-Date Daily-Record Consolidation**:
   - `storage.ts` enforces that **one calendar date = one Daily Retirement record**.
   - If a user inputs expenses on a date that already exists, `mergeRecordCategories()` combines categories with case-insensitive matching (`c.name.trim().toLowerCase()`), updates identical items, and recalculates category subtotals and `dailyTotal`.
   - In SQL, `daily_records` enforces this via `UNIQUE(retirement_id, record_date)`. A database upsert/transaction must perform this same consolidation.

2. **Accurate Currency Calculations**:
   - Currency is Nigerian Naira (₦). Quantities and rates must be rounded to two decimal places: `Math.round(qty * rate * 100) / 100`.
   - Category subtotals = sum of item amounts.
   - `dailyTotal` = sum of category subtotals.
   - `generalTotal` = `dailyRetirementTotal + supplementaryTotal`.

3. **Supplementary Expenses Independence**:
   - Supplementary disbursements (emergency repairs, extra logistics) are recorded separately without being bound to daily expenditure categories, but are included in `RetirementTotals` and PDF reconciliation summaries.

4. **Connected-Retirements Bi-directional Aggregation**:
   - Connecting Retirement A to Retirement B connects Retirement B to Retirement A.
   - On PDF export or project views, connected retirements' records and figures can be consolidated while preserving each retirement's individual identity and ownership.

5. **Sharing Permissions & Roles**:
   - `OWNER` can edit records, add supplementary entries, trash/restore, manage access, and export.
   - `REVIEWER` has read-only access plus export privileges.
   - Add-by-code grants `REVIEWER` access to the participant.

6. **48-Hour Trash Recovery Lifecycle**:
   - Trashed items remain in `status = 'in_trash'` with `deletedAt = timestamp`.
   - After 48 hours (`TRASH_RETENTION_MS = 172,800,000 ms`), records must expire.
   - Restoring removes `deletedAt` and sets `status = 'active'`.

7. **Audit & Activity History**:
   - Every significant mutation (Create, Update, Trash, Restore, Share, Connect, PDF Export, Password Reset) logs an `ActivityLog` entry.

8. **Demo Data Strict Isolation**:
   - The user can "Try Demo Data" (`DEMO-7K4M2P`, `DEMO-3N9X8Q`) and "Clear Demo Data".
   - Demo records must never leak into other users' cloud accounts or overwrite live production data.

---

## 6. Authentication & Authorization Risks

1. **Role Self-Escalation via `user_metadata`**:
   - In `supabaseClient.ts`:
     ```ts
     const role = (appMeta.role as string) || (meta.role as string) || (isAdminEmail ? 'admin' : 'user');
     ```
   - In Supabase Auth, any authenticated user can call `supabase.auth.updateUser({ data: { role: 'admin' } })` to edit their own `user_metadata`.
   - Because `supabaseClient.ts` trusts `meta.role`, **any regular user could grant themselves the admin role in the browser!**
   - **Remedy**: `isUserAdmin` and role-based access must only trust `app_metadata` (which is server-only and cannot be updated by the client) or check a secure `user_roles` database table with RLS.

2. **Insecure RLS Policies in `schema.sql`**:
   - 6 out of 9 tables (`retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, `activity_logs`) currently have RLS enabled with **zero policies**. If deployed as-is, all client queries to these tables will immediately fail with `42501 (permission denied)`.
   - `daily_records` only permits the primary owner (`retirements.owner_id = auth.uid()`) to perform mutations. Users granted `role = 'OWNER'` in `retirement_access` are blocked from saving daily records.

3. **Client-Side Code Lookup Security**:
   - `AddExistingModal.tsx` links retirements using `storage.getRetirementByCode(cleanCode)`.
   - In a multi-tenant database with strict RLS, a user cannot query `retirements` where they are not yet the owner or in `retirement_access`.
   - Therefore, a direct `SELECT * FROM retirements WHERE code = ?` will return 0 rows under current RLS.
   - **Remedy**: A PostgreSQL stored procedure (`SECURITY DEFINER` function, e.g. `claim_retirement_by_code(code)`) is required to safely look up and grant reviewer access without exposing all retirements to public queries.

---

## 7. Analysis of Offline Synchronization & Sync Queue

1. **Storage Key Defined**:
   - `STORAGE_KEYS.SYNC_QUEUE: 'myret_sync_queue'` is declared at `src/utils/storage.ts` (L54).
2. **Types Defined**:
   - `syncStatus: 'synced' | 'pending'` exists on `Retirement`, `DailyRecord`, and `SupplementaryEntry` in `src/types/index.ts`.
3. **UI Elements Present**:
   - `OfflineIndicator.tsx` renders a pending message if `pendingCount > 0`: `"Syncing {pendingCount} records..."`.
4. **Verified Code Reality**:
   - **Zero code reads, writes, or flushes `myret_sync_queue`.**
   - Every creation sets `syncStatus: 'synced'` hardcoded (e.g. `SupplementaryModal.tsx` L54, `DailyRecordModal.tsx` L317, `CreateRetirementModal.tsx` L96).
   - In `DashboardHeader.tsx`, `<OfflineIndicator />` is rendered with no props, defaulting `pendingCount = 0`.
   - **Conclusion**: Genuine background sync and offline queuing do not exist in the codebase today. Storage is strictly local to `window.localStorage`.

---

## 8. Recommended Phased Implementation Plan

### Phase 1: Database Schema & RLS Hardening (`supabase/schema.sql`)
1. **Complete Missing RLS Policies**:
   - Add RLS policies for `retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, and `activity_logs`.
   - Allow read/write access to participants with `OWNER` role in `retirement_access`, not solely `retirements.owner_id`.
2. **Add Trigger for Profile Creation**:
   - Add a PostgreSQL `on_auth_user_created` trigger on `auth.users` to automatically populate `public.profiles`.
3. **Add RPC for Retirement Code Linking**:
   - Create a `SECURITY DEFINER` function `link_retirement_by_code(p_code TEXT)` that validates the code and adds the calling user to `retirement_access` as `REVIEWER`.
4. **Fix Generated Column Handling**:
   - Document and structure database repository queries so `amount` in `expense_items` is never sent in mutations.
5. **Isolate Demo Data to `localStorage`**:
   - Keep demo data exclusively in `localStorage` so demo accounts never touch the live cloud database.

### Phase 2: Supabase Data Access Layer (`src/services/db/` or `src/utils/supabaseDb.ts`)
1. Create strongly typed Supabase database service functions:
   - `fetchRetirements()`, `fetchRetirementDetails(id)`
   - `saveRetirementRecord()`, `deleteRetirementRecord()`
   - `upsertDailyRecord(record)` (handling categories and items in a single transactional RPC or coordinated batch)
   - `deleteDailyRecord(recordId)`
   - `upsertSupplementary(entry)`, `deleteSupplementary(entryId)`
   - `linkRetirement(code)`, `unlinkRetirement(targetId)`
   - `updateAccess(retId, email, role)`, `removeAccess(retId, userId)`
   - `fetchActivityLogs(retId)`, `logActivity(retId, action, details)`
2. Preserve `mergeRecordCategories()` consolidation logic inside the daily record persistence flow.

### Phase 3: Hybrid Storage Integration & Transparent Fallback
1. Update `storage.ts` or introduce a unified data manager:
   - When Supabase is configured and the user has an active session: fetch and mutate against Supabase.
   - Maintain cache in `localStorage` for fast initial render and seamless offline fallback.
   - When user is offline (`!navigator.onLine`): save locally, flag `syncStatus = 'pending'`, and record to `myret_sync_queue`.
   - When online status restores: process `myret_sync_queue` and update `OfflineIndicator`.

### Phase 4: Component Integration & Behavior Verification
1. Update components calling storage methods to support asynchronous loading states:
   - `App.tsx` (refresh retirements on auth change from database)
   - `RetirementHome.tsx` (load daily records and supplementary from cloud)
   - `DailyRecordModal.tsx` & `SupplementaryModal.tsx`
   - `ShareModal.tsx` & `ConnectRetirementModal.tsx`
   - `TrashView.tsx` (cloud trash with 48h recovery)
2. Verify calculations, PDF generation, and demo data isolation.

---

## 9. Files That Would Require Modification for Implementation

1. **`supabase/schema.sql`**: Complete missing RLS policies, add `profiles` trigger, and add `link_retirement_by_code` RPC function.
2. **`src/types/index.ts`**: Add database row types or adapt existing interfaces for relational mapping.
3. **`src/utils/supabaseClient.ts`**: Secure role resolution against `user_metadata` tampering.
4. **`src/utils/storage.ts`**: Wire database sync into existing storage API, or delegate to a new cloud service.
5. **`src/services/supabaseService.ts`** *(New File)*: Clean, isolated queries and transactions for all 9 tables.
6. **`src/App.tsx`**: Update state management to handle async data loading and sync status.
7. **`src/components/retirement/RetirementHome.tsx`**: Support async data refresh for daily records and supplementary items.
8. **`src/components/dashboard/AddExistingModal.tsx`**: Call cloud RPC to link retirements by code across different users.
9. **`src/components/retirement/ConnectRetirementModal.tsx`**: Cloud-enabled connected retirements linking.
10. **`src/components/retirement/ShareModal.tsx`**: Real-time permission management against `public.retirement_access`.
11. **`src/components/dashboard/TrashView.tsx`**: Cloud-backed trash management and 48-hour recovery.
12. **`src/components/pwa/OfflineIndicator.tsx`**: Connect to real sync queue count.
