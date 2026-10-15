# Read-Only Verification Audit Report: Supabase Authorization & Data Architecture

**Target Project**: myRet — Site Expenditure & Retirement Management  
**Audit Scope**: `supabase/schema.sql`, `src/utils/supabaseClient.ts`, `server.ts`, and authorization/storage flows across the codebase  
**Audit Mode**: Strictly Read-Only (no modifications to business logic, no SQL executions, no secrets inspected or printed)  
**Timestamp**: October 13, 2026  

---

## A. Executive Summary

This read-only audit examines the security, authorization, data architecture, and PostgreSQL configuration of myRet prior to migrating business records to Supabase.

1. **Current Production State**: The application currently persists all retirements, daily expense records, supplementary payments, and audit logs inside browser `localStorage`. Supabase is utilized only for Supabase Auth and three administrative Express endpoints (`/api/admin/*`).
2. **Database Schema Blockers**: `supabase/schema.sql` defines **9 tables**, all 9 have RLS enabled, but **only 3 tables have any policies defined** (totaling 8 active policies). The remaining 6 tables (`retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, and `activity_logs`) have **zero policies**. Under PostgreSQL Row Level Security, any query against a table with RLS enabled and no matching policy is **denied by default**. Connecting client code today would immediately fail with `42501 (permission denied)`.
3. **Privilege Escalation Vulnerability**: `src/utils/supabaseClient.ts` (L23–26) and `server.ts` (L52) evaluate `user.user_metadata?.role` to grant administrative status. Because Supabase Auth allows any authenticated user to update their own `user_metadata` directly via `supabase.auth.updateUser({ data: { role: 'admin' } })`, **any regular user can grant themselves system administrator privileges**. Furthermore, both the frontend and backend grant admin status to any email starting with `admin@` (e.g., `admin@trashmail.com`), regardless of domain verification.
4. **Missing Profile Provisioning**: `schema.sql` has no trigger on `auth.users` to populate `public.profiles`. Signup fails to guarantee a profile record, and `public.profiles` has no `INSERT` policy, creating foreign-key violations when creating retirements.
5. **Retirement Sharing by Code**: The current design in `AddExistingModal.tsx` assumes the client can query a retirement by its code. Under strict multi-tenant RLS, a user cannot query a private retirement they do not already own or share. A secure PostgreSQL RPC (`SECURITY DEFINER` function) with rate limiting and code validation is required.

---

## B. Verified Table & RLS Policy Inventory

### Verified Metrics from `supabase/schema.sql`
- **Total Tables Defined**: 9
- **Tables with RLS Enabled**: 9 (`ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;` executed for all 9)
- **Total RLS Policies Defined**: 8 *(Correction to prior assumptions: there are exactly 8 policies in the file, not 9)*
- **Tables with Policies**: 3 (`profiles`, `retirements`, `daily_records`)
- **Tables with ZERO Policies**: 6 (`retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, `activity_logs`)

### Complete Inventory of Active Policies

| # | Table | Policy Name | Command | Target Role | USING / WITH CHECK Clause (Verbatim) |
|---|---|---|---|---|---|
| 1 | `public.profiles` | "Public profiles are viewable by authenticated users" | `SELECT` | `authenticated` | `USING (true)` |
| 2 | `public.profiles` | "Users can update their own profile" | `UPDATE` | `authenticated` | `USING (auth.uid() = id)` |
| 3 | `public.retirements` | "Users can view retirements they own or have access to" | `SELECT` | `authenticated` | `USING (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.retirement_access WHERE retirement_access.retirement_id = retirements.id AND retirement_access.user_id = auth.uid()))` |
| 4 | `public.retirements` | "Owners can insert and update their retirements" | `INSERT` | `authenticated` | `WITH CHECK (owner_id = auth.uid())` |
| 5 | `public.retirements` | "Owners can update their retirements" | `UPDATE` | `authenticated` | `USING (owner_id = auth.uid())` |
| 6 | `public.retirements` | "Owners can delete their retirements" | `DELETE` | `authenticated` | `USING (owner_id = auth.uid())` |
| 7 | `public.daily_records` | "Daily records viewable by retirement participants" | `SELECT` | `authenticated` | `USING (EXISTS (SELECT 1 FROM public.retirements r WHERE r.id = daily_records.retirement_id AND (r.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.retirement_access ra WHERE ra.retirement_id = r.id AND ra.user_id = auth.uid()))))` |
| 8 | `public.daily_records` | "Daily records modifiable by owners" | `ALL` | `authenticated` | `USING (EXISTS (SELECT 1 FROM public.retirements r WHERE r.id = daily_records.retirement_id AND r.owner_id = auth.uid()))` |

### Critical Defects Identified in Schema & Policies
1. **The 6 Defenseless Tables**:
   `public.retirement_access`, `public.categories`, `public.expense_items`, `public.supplementary_entries`, `public.connected_retirements`, and `public.activity_logs` all execute `ENABLE ROW LEVEL SECURITY`, but declare **zero policies**. When RLS is enabled on a table with no policies, PostgreSQL defaults to **DENY ALL** for non-superusers. All client operations against these tables will fail immediately.
2. **Missing `INSERT` Policy on `public.profiles`**:
   `profiles` defines only `SELECT` and `UPDATE`. Any client-side `INSERT` or `upsert` into `profiles` (such as in `ProfileModal.tsx` L59) will be denied by RLS unless the profile was created via a server trigger.
3. **Primary Owner vs Participant OWNER Disconnect**:
   Policy 8 (`"Daily records modifiable by owners"`) checks `r.owner_id = auth.uid()`. If a user is granted `role = 'OWNER'` in `retirement_access`, they are **blocked** from inserting, updating, or deleting daily records because the policy only checks the single creator (`r.owner_id`).
4. **Infinite Recursion Risk in Subqueries**:
   Policy 3 on `retirements` performs `SELECT ... FROM public.retirement_access`. When policies are subsequently added to `retirement_access` that check `retirements`, cyclical policy evaluation can cause PostgreSQL error `42P17 (infinite recursion detected in policy for relation)`. Security functions or clean subquery structures must be used.

---

## C. Administrator Authorization Findings

### Verified Code Analysis
In `src/utils/supabaseClient.ts`:
```ts
// Lines 20-26:
const isAdminEmail =
  (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') ||
  (user.email && user.email.toLowerCase().startsWith('admin@'));
const role =
  (appMeta.role as string) ||
  (meta.role as string) ||
  (isAdminEmail ? 'admin' : 'user');
```
```ts
// Lines 40-46:
export function isUserAdmin(user: UserProfile | null): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'tech-admin') return true;
  if (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') return true;
  if (user.email && user.email.toLowerCase().startsWith('admin@')) return true;
  return false;
}
```

In `server.ts`:
```ts
// Lines 49-71:
function isUserAdmin(user: User): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as Record<string, unknown>)?.role;
  const userRole = (user.user_metadata as Record<string, unknown>)?.role;

  if (appRole === 'admin' || appRole === 'tech-admin') return true;
  if (userRole === 'admin' || userRole === 'tech-admin') return true;

  if (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') return true;
  if (user.email && user.email.toLowerCase().startsWith('admin@')) return true;

  const envAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && envAdmins.includes(user.email.toLowerCase())) return true;

  return false;
}
```

### Vulnerability Classification & Paths to Privilege Escalation

| Path | Mechanism | Vulnerability Status | Practical Consequence |
|---|---|---|---|
| **Path 1: `user_metadata` Self-Update** | Client calls `supabase.auth.updateUser({ data: { role: 'admin' } })` | **CRITICAL VULNERABILITY** | Supabase Auth permits users to update their own `user_metadata` arbitrarily. Since both `supabaseClient.ts` and `server.ts` check `user.user_metadata?.role === 'admin'`, any registered user can escalate to full administrator in both UI and backend APIs. |
| **Path 2: Arbitrary `admin@*` Signup** | Register any account starting with `admin@` (e.g. `admin@tempmail.org`) | **CRITICAL VULNERABILITY** | Because the rule checks `user.email.toLowerCase().startsWith('admin@')` without domain restrictions, anyone registering an `admin@...` address instantly acquires administrative powers. |
| **Path 3: Hardcoded Email (`elmubaraq69@gmail.com`)** | Check matches `elmubaraq69@gmail.com` | **HIGH RISK (Fragile Design)** | Legitimate bootstrap mechanism, but embedding personal emails in client and server code makes authority transfer impossible without code redeployment. |
| **Path 4: Database RLS Bypass via Client Claim** | Client assumes role claim protects database | **HIGH RISK** | The SQL schema currently has **no concept of admin role**. An admin user in the UI has no special bypass in PostgreSQL unless `service_role` is used or an admin policy exists. |

### Recommended Secure Design
1. **Never Trust `user_metadata` for Authorization**: `user_metadata` is writable by clients. Role authorization must only read from `app_metadata` (writable only via the Supabase Service Role / Admin API) or a dedicated PostgreSQL table (e.g., `public.user_roles`).
2. **Remove the `admin@` Prefix Wildcard**: Remove `startsWith('admin@')` immediately from both client and server code.
3. **Establish a Centralized Admin Store**:
   - Store administrative status in a protected table `public.user_roles (user_id UUID, role TEXT, PRIMARY KEY(user_id, role))` with RLS permitting edits only by existing administrators or service role.
   - Alternatively, store the role in `auth.users.app_metadata.role` using server-side endpoints only.

---

## D. Profile Creation & Management Findings

### Verified Code State
1. **Signup Flow (`AuthModal.tsx` L103–136)**:
   ```ts
   const { data, error: signUpError } = await supabase.auth.signUp({
     email: cleanEmail,
     password,
     options: {
       data: {
         name: name.trim(),
         designation: designation.trim() || 'Site Construction Engineer',
         phone: phone.trim() || '',
         placement: placement.trim() || 'Site Project Placement',
       },
     },
   });
   ```
   - Only updates `auth.users` metadata.
   - **Does NOT insert into `public.profiles`**.
2. **Profile Update Flow (`ProfileModal.tsx` L58–71)**:
   ```ts
   try {
     await supabase.from('profiles').upsert({
       id: currentUser.id,
       name: formData.name.trim(),
       designation: formData.designation.trim(),
       phone: formData.phone.trim(),
       email: formData.email.trim(),
       placement: formData.placement.trim(),
       updated_at: new Date().toISOString(),
     });
   } catch (dbErr) {
     console.log('Profiles table sync skipped/unreachable:', dbErr);
   }
   ```
   - `ProfileModal.tsx` attempts an `upsert`, but wraps it in a silent `try/catch` because the author knew the table might not exist or might fail.
   - **Crucially: `profiles` has no `INSERT` policy in `schema.sql`**, so `upsert` fails under RLS for regular authenticated users!
3. **Database Trigger**:
   - **Verified Fact**: There is **NO trigger** (`on_auth_user_created`) in `supabase/schema.sql` or anywhere in the codebase.
4. **Foreign Key Consequence**:
   - `public.retirements` defines: `owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL`.
   - If a user signs up and immediately tries to create a retirement, PostgreSQL will throw foreign key violation `23503 (insert or update on table "retirements" violates foreign key constraint)` because no corresponding row exists in `public.profiles`.

### Required Fixes
- Create a PostgreSQL trigger function that executes with `SECURITY DEFINER` on `auth.users` `AFTER INSERT`, inserting `id`, `name`, `email`, `designation`, `phone`, and `placement` directly into `public.profiles`.
- Add an explicit `INSERT` policy on `public.profiles`: `WITH CHECK (auth.uid() = id)`.

---

## E. Table-by-Table Permission Matrix

The table below contrasts the **Required Business Behavior** against the **Current Database Schema Enforcement** for each of the 9 tables:

| Table | Primary Owner | Participant (OWNER) | Participant (REVIEWER) | Unrelated Authenticated User | Current Schema Status & Failure Points |
|---|---|---|---|---|---|
| **1. `profiles`** | Read: All<br>Update: Self<br>Insert: Self | Read: All<br>Update: Self | Read: All<br>Update: Self | Read: All<br>Update: Self | **Defective**: Has `SELECT (true)` and `UPDATE (auth.uid() = id)`, but **no `INSERT` policy**. New user registration cannot create its own profile record. |
| **2. `retirements`** | Read, Insert, Update, Delete: Full | Read: Yes<br>Update: Yes<br>Delete: No (or Trash only) | Read: Yes<br>Update: No<br>Delete: No<br>Export: Yes | Read: No<br>Write: No | **Defective**: Current `UPDATE` policy checks `owner_id = auth.uid()`. Participant with `OWNER` role cannot update title/project in cloud. |
| **3. `retirement_access`** | Read, Insert, Update, Delete: Full | Read: Yes<br>Grant/Revoke: As permitted | Read: Yes (own access)<br>Write: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. All access management operations fail with Permission Denied. |
| **4. `daily_records`** | Read, Insert, Update, Delete: Full | Read, Insert, Update, Delete: Full | Read: Yes<br>Write: No | Read: No<br>Write: No | **Defective**: Policy 8 (`"Daily records modifiable by owners"`) checks `r.owner_id = auth.uid()`. Participant with `OWNER` role is blocked from inserting or editing daily records. |
| **5. `categories`** | Read, Insert, Update, Delete: Full | Read, Insert, Update, Delete: Full | Read: Yes<br>Write: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. All category read and write operations fail with Permission Denied. |
| **6. `expense_items`** | Read, Insert, Update, Delete: Full | Read, Insert, Update, Delete: Full | Read: Yes<br>Write: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. Note: `amount` is a `GENERATED ALWAYS AS STORED` column; client must not send `amount` on insert. |
| **7. `supplementary_entries`** | Read, Insert, Update, Delete: Full | Read, Insert, Update, Delete: Full | Read: Yes<br>Write: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. All supplementary read and write operations fail with Permission Denied. |
| **8. `connected_retirements`** | Read, Insert, Delete: Full | Read, Insert, Delete: Full | Read: Yes<br>Write: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. Bidirectional linking fails with Permission Denied. |
| **9. `activity_logs`** | Read: Full<br>Insert: Auto<br>Delete: No | Read: Full<br>Insert: Auto<br>Delete: No | Read: Yes<br>Insert: Auto<br>Delete: No | Read: No<br>Write: No | **CRITICAL FAILURE**: RLS enabled with **ZERO policies**. Reading audit history fails with Permission Denied. |

---

## F. Administrative Server Endpoints Security Findings (`server.ts`)

### 1. `POST /api/admin/set-service-key` (L129–178)
- **What it does**: Receives `{ serviceRoleKey }` from an HTTP POST request, tests it against Supabase Admin API, and writes it directly to `.env` using `fs.writeFileSync`.
- **Risks**:
  1. **Privilege Escalation**: Because `requireAdmin` relies on `isUserAdmin`, any user who set `user_metadata.role = 'admin'` or signed up with `admin@...` can call this endpoint.
  2. **Secret Ingestion via HTTP**: An administrative web API should not ingest root service keys from the browser. The service key possesses total superuser bypass for the entire database.
  3. **Filesystem Mutation**: Writing to `.env` at runtime fails in containerized/read-only cloud environments (e.g., Cloud Run, Kubernetes) and risks corrupting environment configuration.
- **Recommendation**: Remove this endpoint. The service role key must be configured exclusively as a secure environment variable (`process.env.SUPABASE_SERVICE_ROLE_KEY`) injected at deployment time.

### 2. `GET /api/admin/users` (L181–215)
- **What it does**: Uses `adminClient.auth.admin.listUsers()` to return all registered user accounts.
- **Risks**:
  1. Accessible by unauthorized users due to flawed `requireAdmin` middleware.
  2. Returns full user lists including metadata.
- **Recommendation**: Protect strictly with server-verified admin roles.

### 3. `POST /api/admin/reset-password` (L218–295)
- **What it does**: Allows setting a temporary password for any target user via `adminClient.auth.admin.updateUserById()`.
- **Risks**:
  1. **Account Takeover**: An attacker who escalates to admin via `user_metadata` can reset the password of any user in the organization, including legitimate administrators.
- **Recommendation**: Enforce rigid role verification against `auth.users.app_metadata.role === 'admin'` before allowing password overrides.

---

## G. Retirement-Code Linking Architecture Recommendation

### The Business Requirement
In `src/components/dashboard/AddExistingModal.tsx`, a site engineer enters a code like `RET-7K4M2P` to link an existing retirement to their dashboard as a `REVIEWER`.

### The Security Problem under RLS
- In a secure database, an unrelated user cannot run `SELECT * FROM retirements WHERE code = 'RET-7K4M2P'` because RLS blocks access to unlinked retirements.
- If we weaken the RLS policy on `retirements` to allow `SELECT USING (true)`, any authenticated user could dump the entire company's project titles, expenditure codes, and budgets.

### The Solution: Narrowly Scoped PostgreSQL RPC
Create a dedicated PostgreSQL function:
```sql
CREATE OR REPLACE FUNCTION public.claim_retirement_by_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_retirement_id UUID;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 1. Look up active retirement by code
  SELECT id, status INTO v_retirement_id, v_status
  FROM public.retirements
  WHERE UPPER(code) = UPPER(TRIM(p_code));

  IF v_retirement_id IS NULL THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  IF v_status = 'in_trash' THEN
    RAISE EXCEPTION 'Cannot claim a retirement that is in the trash';
  END IF;

  -- 2. Insert or update reviewer access
  INSERT INTO public.retirement_access (retirement_id, user_id, role, granted_at)
  VALUES (v_retirement_id, v_user_id, 'REVIEWER', NOW())
  ON CONFLICT (retirement_id, user_id) DO NOTHING;

  -- 3. Log the activity
  INSERT INTO public.activity_logs (retirement_id, user_id, action, details)
  VALUES (v_retirement_id, v_user_id, 'Access Granted via Code', 'User claimed Reviewer access using code');

  RETURN v_retirement_id;
END;
$$;
```

### Essential Safeguards (Why `SECURITY DEFINER` Alone Is Not Enough)
1. **`SET search_path = public, pg_temp`**: Prevents search-path hijacking attacks.
2. **Explicit `auth.uid()` validation**: Guarantees the caller is genuinely authenticated.
3. **No Information Leakage on Failure**: Returns generic `'Invalid retirement code'` without disclosing whether the project exists, who owns it, or its title.
4. **Rate Limiting**: Code guessing must be rate-limited (either via a simple attempts counter table or via server proxy) to prevent brute-forcing short codes.

---

## H. Minimum Safe Changes for Phase 1

The smallest safe set of database and authorization changes required before connecting application data:

1. **Schema & Policy Completion (`supabase/schema.sql`)**:
   - Add RLS policies for the 6 missing tables: `retirement_access`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, and `activity_logs`.
   - Update `daily_records`, `categories`, `expense_items`, and `supplementary_entries` policies so participants with `role = 'OWNER'` in `retirement_access` can create and edit records.
   - Add `INSERT` policy for `public.profiles`.
2. **Automated Profile Provisioning Trigger**:
   - Add `on_auth_user_created` trigger in `schema.sql` on `auth.users` to automatically insert into `public.profiles`.
3. **Claim Code RPC Function**:
   - Deploy `claim_retirement_by_code(p_code)` in PostgreSQL so `AddExistingModal.tsx` can link retirements across different user accounts without breaking RLS.
4. **Hardened Role Resolution**:
   - Modify `src/utils/supabaseClient.ts` and `server.ts` to remove reliance on `user.user_metadata?.role` and remove `startsWith('admin@')`. Check only server-controlled claims (`app_metadata.role`).
5. **Remove Insecure Service Key Endpoint**:
   - Deprecate/remove `POST /api/admin/set-service-key` from `server.ts`. Provide the key exclusively through environment variables.

---

## I. Prioritized Implementation-Readiness Checklist

| Priority | Severity | Component / Evidence | Practical Consequence | Required Remediation | Phase Gate |
|---|---|---|---|---|---|
| **1** | **CRITICAL** | `supabase/schema.sql` (L117–126)<br>6 tables have RLS enabled with 0 policies | All child records (expenses, categories, supplementary, sharing) fail with `42501 permission denied`. | Add read/write policies for participants to all 6 tables. | **Pre-Phase 1 Blocker** |
| **2** | **CRITICAL** | `src/utils/supabaseClient.ts` (L23)<br>`server.ts` (L52)<br>`user_metadata.role` checked | Any user can escalate to administrator via client SDK. | Disallow `user_metadata` for role determination; use `app_metadata` only. | **Pre-Phase 1 Blocker** |
| **3** | **CRITICAL** | `src/utils/supabaseClient.ts` (L22)<br>`server.ts` (L61)<br>`startsWith('admin@')` rule | Any visitor signing up as `admin@anything` gets full admin rights. | Remove `admin@` prefix rule completely. | **Pre-Phase 1 Blocker** |
| **4** | **CRITICAL** | `supabase/schema.sql`<br>No trigger on `auth.users` to populate `profiles` | Creating retirements fails with foreign-key violation `23503`. | Create `on_auth_user_created` trigger on `auth.users`. | **Pre-Phase 1 Blocker** |
| **5** | **HIGH** | `supabase/schema.sql` (L172–179)<br>Daily records check only `r.owner_id = auth.uid()` | Shared participants with `OWNER` role cannot edit expenses. | Expand policy to check `retirement_access` for `role = 'OWNER'`. | **Pre-Phase 1 Blocker** |
| **6** | **HIGH** | `src/components/dashboard/AddExistingModal.tsx` (L36)<br>Direct code lookup | Linking retirements created by other engineers fails under RLS. | Deploy `claim_retirement_by_code` RPC function. | **Pre-Phase 1 Blocker** |
| **7** | **HIGH** | `server.ts` (L129–178)<br>`POST /api/admin/set-service-key` | Secret key accepted via HTTP and written to `.env`. | Remove endpoint; use static environment variable. | **Pre-Phase 1 Blocker** |
| **8** | **MEDIUM** | `supabase/schema.sql` (L69)<br>`amount GENERATED ALWAYS AS STORED` | If client sends `amount`, PostgreSQL rejects insert with error `42601`. | Ensure data layer excludes `amount` from insert/update payloads. | **Phase 2 (Data Layer)** |
| **9** | **MEDIUM** | `src/utils/storage.ts` (L54)<br>`SYNC_QUEUE` declared but never processed | Offline changes are not uploaded when connection is restored. | Implement real offline queue processor. | **Phase 3 (Offline Sync)** |
| **10** | **LOW** | `supabase/schema.sql`<br>No 48h auto-pruning trigger for trash | Trashed records stay indefinitely in PostgreSQL until queried. | Implement pg_cron or periodic cleanup RPC for expired trash. | **Phase 4 (Maintenance)** |

---

## J. Uncertainties & Items Not Verifiable from Available Code

1. **Live Supabase Project State**:
   - The current audit is conducted on repository code (`supabase/schema.sql`). It cannot be verified from local files whether this schema has already been executed in the live Supabase project, or if partial tables/policies exist in the remote database.
2. **Supabase Auth Email Confirmation Setting**:
   - The remote Supabase Auth configuration (whether email confirmation is enabled or disabled) cannot be determined from client code. `AuthModal.tsx` contains branching logic for both cases.
3. **Service Role Key Deployment**:
   - Whether `SUPABASE_SERVICE_ROLE_KEY` is already present in the production deployment environment cannot and should not be inspected directly, but `server.ts` indicates it falls back to empty string if unconfigured.
