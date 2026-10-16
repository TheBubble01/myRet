# Read-Only Inspection Report: Actual Application Source Code

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Application Source Code & Cloud Database Integration Readiness Inspection  
**Date**: October 16, 2026  
**Status**: 100% Read-Only Static Audit Complete  
**Verification**: App builds cleanly (`npm run build` / `compile_applet` passed; `tsc --noEmit` linting passed with zero errors). No application source code files were modified or deleted.

---

## 1. Executive Summary & Verification Boundaries

This inspection examined the **actual running source code** of the myRet application to establish how data is modeled, stored, manipulated, and presented today. 

* The application is a fully functional Progressive Web App (React 18 + TypeScript + Vite + Tailwind CSS) with offline caching and an Express backend (`server.ts`) hosting Vite middleware and admin endpoints.
* **Current Storage Reality**: All business domain data (Retirements, Daily Records, Categories, Expense Items, Supplementary Payments, Connected Retirements, Activity Logs) is actively stored in browser `localStorage` via `src/utils/storage.ts`.
* **Current Supabase Reality**: Supabase is **already live and configured** for User Authentication (Sign up, Sign in, Session persistence, Password reset) via `src/utils/supabaseClient.ts` and `src/components/auth/AuthModal.tsx`. In addition, `server.ts` exposes administrative endpoints (`/api/admin/users`, `/api/admin/reset-password`) protected by Supabase Bearer tokens.
* **Target Objective**: Connect the existing business data layer to the proposed cloud database (`supabase/migrations/20261014000400_cloud_database_foundation_final.sql`) so that data syncs across devices for the team (~20 concurrent site engineers) while maintaining offline-first local storage and preserving 100% of the current UI/UX.

---

## 2. Actual Codebase Architecture & Data Flow

### 2.1 File Map & Responsibilities

| File Path | Role in Current Application | Cloud Persistence Status |
| :--- | :--- | :--- |
| `src/types/index.ts` | Canonical TypeScript data interfaces | Domain types defined (matches SQL) |
| `src/utils/storage.ts` | Local storage service, calculations, business rules | Active (all business data in `localStorage`) |
| `src/utils/supabaseClient.ts` | Supabase SDK client & auth user formatting | Active (Auth sessions, profiles, admin checks) |
| `src/App.tsx` | Main application shell, state routing, session listener | Active (manages `currentUser`, `retirements`) |
| `src/components/auth/AuthModal.tsx` | Sign In, Sign Up, and Forgot Password modal | Active (calls `supabase.auth.*`) |
| `src/components/auth/ProfileModal.tsx` | Profile editing & opportunistic profile sync | Active (updates auth metadata & `profiles` table) |
| `src/components/dashboard/CreateRetirementModal.tsx` | Retirement creation & edit modal | Active (writes to `storage`) |
| `src/components/dashboard/AddExistingModal.tsx` | Claim shared retirement via 6-character code | Active (searches local `storage` by code) |
| `src/components/dashboard/TrashView.tsx` | 48-Hour Trash Bin recovery & permanent purge | Active (checks `deletedAt` + 48h in `storage`) |
| `src/components/retirement/RetirementHome.tsx` | Core workspace, filtering, totals, permissions | Active (enforces `canEdit = role === 'OWNER'`) |
| `src/components/retirement/DailyRecordModal.tsx` | Multi-category, multi-item daily record editor | Active (calculates subtotal & daily totals) |
| `src/components/retirement/SupplementaryModal.tsx` | Non-dated supplementary payments | Active (writes to `storage`) |
| `src/components/retirement/ConnectRetirementModal.tsx` | Connects two retirements for unified reporting | Active (updates `connectedRetirementIds` array) |
| `src/components/retirement/ShareModal.tsx` | Code sharing & collaborator access list | Active (modifies `retirement.access` array) |
| `src/components/retirement/ActivityHistoryModal.tsx` | Displays chronological site audit log | Active (reads from `storage.getActivityLogs()`) |
| `src/components/retirement/ExportPdfModal.tsx` | PDF report dialog & configuration | Active (calls `pdfGenerator.ts`) |
| `src/utils/pdfGenerator.ts` | Unicode-compliant (₦) PDF report generator | Active (jsPDF + autotable + Noto Sans) |
| `src/utils/currency.ts` | Naira formatting, parsing, and rounding | Active (`calculateAmount` rounds to 2 decimals) |
| `src/utils/codeGenerator.ts` | Generates `RET-XXXXXX` codes and UUIDs | Active (unambiguous alphanumeric characters) |
| `server.ts` | Express server, Vite middleware, Admin API routes | Active (Supabase service role admin routes) |

---

## 3. Detailed Data Structures & Business Rules in Current Code

### 3.1 Authentication & User Profiles
* **Auth Provider**: Supabase Auth (`supabase.auth`).
* **Profile Attributes**: `id` (UUID from `auth.users`), `name`, `designation`, `phone`, `email`, `placement`, `avatarUrl`, `role`.
* **Role Resolution**:
  * `elmubaraq69@gmail.com` or any email starting with `admin@` is resolved as `admin`.
  * `app_metadata.role` or `user_metadata.role` overrides fallback.
* **Profile Updates**: `ProfileModal.tsx` updates `supabase.auth.updateUser({ data: {...} })` and already has code attempting to upsert to `public.profiles`:
  ```typescript
  await supabase.from('profiles').upsert({
    id: currentUser.id,
    name: formData.name.trim(),
    designation: formData.designation.trim(),
    phone: formData.phone.trim(),
    email: formData.email.trim(),
    placement: formData.placement.trim(),
    updated_at: new Date().toISOString(),
  });
  ```

### 3.2 Retirements & Single-Editor Rule
* **Structure**: `id` (UUID), `code` (`RET-XXXXXX`), `title`, `project`, `ownerId`, `ownerName`, `ownerDesignation`, `ownerPhone`, `status` (`'active' | 'in_trash'`), `deletedAt`, `access` (`RetirementAccess[]`), `connectedRetirementIds` (`string[]`), `syncStatus`.
* **Code Format**: `RET-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}` (excludes `0, O, 1, I, L`).
* **Permissions in `RetirementHome.tsx`**:
  ```typescript
  const isOwner = retirement.ownerId === currentUser.id;
  const userAccess = retirement.access.find(
    (a) => a.userId === currentUser.id || a.userEmail.toLowerCase() === currentUser.email.toLowerCase()
  );
  const role = isOwner ? 'OWNER' : userAccess?.role || 'REVIEWER';
  const canEdit = role === 'OWNER';
  const canDelete = isOwner || isUserAdmin(currentUser);
  ```
  * **Verified Fact**: In the UI today, **only the primary owner can edit records, categories, items, and supplementary payments**. Reviewers can view, inspect, calculate totals, and export PDFs, but cannot mutate data.

### 3.3 48-Hour Trash Bin & Lifecycle
* **Soft Delete**: `storage.moveToTrash(id)` sets `status = 'in_trash'` and `deletedAt = new Date().toISOString()`.
* **Pruning**: `TRASH_RETENTION_MS = 48 * 60 * 60 * 1000` (48 hours). `cleanupExpiredTrash()` automatically removes expired items on every read.
* **Permanent Purge**: `storage.permanentlyDelete(id)` cascades deletion across:
  * Associated `daily_records`
  * Associated `supplementary`
  * Associated `activity_logs`

### 3.4 Daily Records, Expense Categories & Expense Items
* **Calendar Date Invariant**: Calendar date is strictly normalized to `YYYY-MM-DD` via `normalizeDate()`.
* **One Record Per Day**: If a user saves an entry for a date that already has a daily record, `mergeRecordCategories()` in `storage.ts` combines categories by name and appends/updates items rather than throwing an error or creating duplicate days.
* **Financial Calculations**:
  * Item amount: `calculateAmount(quantity, rate) = Math.round(quantity * rate * 100) / 100`.
  * Category subtotal: sum of item amounts.
  * Daily total: sum of category subtotals.
  * Currency: Nigerian Naira (`₦`) formatted via `formatNaira()`.

### 3.5 Supplementary Payments
* Non-dated expenditures directly linked to `retirementId`:
  * `id` (UUID)
  * `retirementId` (UUID)
  * `description` (TEXT)
  * `amount` (NUMERIC)
  * `createdAt` (ISO String)
* Factored into `RetirementTotals.generalTotal = dailyRetirementTotal + supplementaryTotal`.

### 3.6 Connected Retirements
* In local storage: represented as an array of IDs on the retirement object (`connectedRetirementIds: string[]`).
* When connecting in `ConnectRetirementModal.tsx`:
  * Bi-directional connection: appends target ID to source, and source ID to target.
  * Prevents self-connection (`p_retirement_a !== p_retirement_b`).
* In PDF export (`pdfGenerator.ts`):
  * Connected retirements are exported as distinct sections following the main retirement report (1-level only).

### 3.7 Sharing via Retirement Code
* In `AddExistingModal.tsx`:
  * User inputs code `RET-XXXXXX`.
  * Looks up retirement by code.
  * If found and user is not owner/collaborator, appends user to `retirement.access` with `role: 'REVIEWER'`.

---

## 4. Cross-Verification: Actual Code vs. Database Foundation Candidate (`20261014000400`)

| Dimension | Actual Application Source Code | Cloud Migration Candidate (`20261014000400`) | Alignment Status |
| :--- | :--- | :--- | :--- |
| **User Profiles** | `UserProfile`: `id`, `name`, `designation`, `phone`, `email`, `placement`, `avatarUrl` | Table `public.profiles`: identical columns + `created_at`, `updated_at` | **Exact Match** |
| **Profile Trigger** | Client currently relies on client-side upsert in `ProfileModal.tsx` | Trigger `on_auth_user_created` creates profile row automatically on signup from `raw_user_meta_data` | **Compatible & Superior** (prevents missing profiles) |
| **Retirements** | `id`, `code`, `title`, `project`, `ownerId`, `status`, `deletedAt` | Table `public.retirements`: identical fields + `version`, `created_at`, `updated_at` | **Exact Match** |
| **Retirement Sharing** | `access: [{ userId, userEmail, userName, role: 'REVIEWER', grantedAt }]` | Table `public.retirement_access`: `(retirement_id, user_id, role = 'REVIEWER')` | **Exact Match** (code only allows Reviewers) |
| **Code Claiming** | `AddExistingModal.tsx` looks up `getRetirementByCode()` in localStorage | RPC `claim_retirement_by_code(p_code)` locates active retirement and grants `REVIEWER` access | **Exact Match** (implements cross-device claiming) |
| **Daily Records** | `id`, `retirementId`, `date` (`YYYY-MM-DD`), `dailyTotal` | Table `public.daily_records`: identical columns + unique `(retirement_id, record_date)` | **Exact Match** |
| **Atomic Hierarchy Save** | `DailyRecordModal.tsx` builds full object with `categories` and `items` | RPC `upsert_daily_record_hierarchy(p_record_id, p_retirement_id, p_record_date, p_categories, ...)` | **Exact Match** (atomic transaction replaces items) |
| **Expense Items Amount** | `calculateAmount(quantity, rate)` rounds to 2 decimals | `amount NUMERIC(15, 2) GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED` | **Exact Match** |
| **Supplementary Entries** | `id`, `retirementId`, `description`, `amount`, `createdAt` | Table `public.supplementary_entries`: identical columns | **Exact Match** |
| **Connected Retirements** | Client stores `connectedRetirementIds: string[]` on `Retirement` | Table `public.connected_retirements` with canonical constraint `retirement_id < connected_id` + RPC `connect_retirements` | **Structural Transformation Required** (see Section 5) |
| **Activity History** | Client stores `ActivityLog` in `localStorage` (`myret_activity_logs`) | Migration 000400 dropped `public.activity_logs` table | **Divergence**: Client logs locally; table dropped in 000400 |

---

## 5. Integration Analysis & Technical Gaps to Bridge

When we move to the live implementation phase, the following adjustments will connect the application to Supabase:

### Gap 1: Asynchronous Cloud Repository Layer
* **Current State**: `src/utils/storage.ts` is synchronous, writing directly to `localStorage`.
* **Integration Strategy**: Create a dedicated repository/sync module (e.g. `src/utils/supabaseSync.ts` or an async wrapper in `storage.ts`) that:
  1. Reads from `localStorage` immediately for instant offline rendering.
  2. Background-syncs active retirements, daily records, and supplementary entries with Supabase when online.
  3. Writes local mutations optimistically, then syncs to Supabase.

### Gap 2: Connected Retirements Schema Mapping
* **Current State**: `Retirement.connectedRetirementIds` is a simple string array on the `Retirement` object.
* **Database State**: Table `public.connected_retirements` stores pairs `(retirement_id, connected_id)` with `retirement_id < connected_id`.
* **Integration Strategy**:
  * On loading a retirement from Supabase: query `SELECT * FROM connected_retirements WHERE retirement_id = :id OR connected_id = :id` and populate `connectedRetirementIds` with the other ID of each pair.
  * When connecting: call the RPC `supabase.rpc('connect_retirements', { p_retirement_a, p_retirement_b })`.

### Gap 3: Cross-Device Code Claiming
* **Current State**: `AddExistingModal.tsx` calls `storage.getRetirementByCode(cleanCode)`. In a multi-user cloud setting, another user's retirement won't exist in local `localStorage` until claimed.
* **Integration Strategy**:
  * `AddExistingModal.tsx` calls `supabase.rpc('claim_retirement_by_code', { p_code: cleanCode })`.
  * Upon receiving the `retirement_id`, the client fetches the retirement and its daily records from Supabase and caches them locally.

### Gap 4: Generated Column Guard on Expense Items
* **Current State**: Client sends `{ id, description, quantity, rate, amount }`.
* **Database State**: `public.expense_items.amount` is `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`. Postgres throws an error if an INSERT or UPDATE explicitly assigns a value to a generated column.
* **Integration Strategy**:
  * The RPC `upsert_daily_record_hierarchy` already omits `amount` from its `INSERT INTO public.expense_items (id, category_id, description, quantity, rate, created_at)`.
  * If client-side direct table inserts are ever used, `amount` must be omitted from the insert payload. Using the RPC is the recommended and safest path.

### Gap 5: Activity Logs Handling
* **Current State**: `RetirementHome.tsx` has an Activity History button opening `ActivityHistoryModal.tsx`.
* **Decision Point**: Since migration candidate 000400 removed `public.activity_logs` to simplify cloud tables for the ~20 person site team, activity logs can continue to be tracked in `localStorage` per device without cloud synchronization, OR `public.activity_logs` can be preserved if cloud history is desired. Leaving activity logs in local storage keeps cloud RPCs and RLS simple and fast.

---

## 6. Recommended Next Steps for Implementation Phase

1. **Keep Safety First**: Never apply migrations or edit files until explicitly requested by the user.
2. **Apply Final Migration**: When approved by the user, apply `supabase/migrations/20261014000400_cloud_database_foundation_final.sql` to the live Supabase instance.
3. **Implement Non-Breaking Sync Adapter**:
   * Add Supabase query methods for fetching user retirements (`owner_id = user.id` OR in `retirement_access`).
   * Add hook to load data on sign-in and cache in `localStorage`.
   * Wire `CreateRetirementModal`, `DailyRecordModal`, and `SupplementaryModal` to persist to Supabase via RPCs while updating local storage.
4. **Preserve Offline Capability**: If `navigator.onLine` is false or Supabase is unreachable, continue operating seamlessly out of `localStorage` and queue changes for later sync.
