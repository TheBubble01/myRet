# Phase 1.3 Database Foundation: Final Technical Review, Static Audit & Verification Report

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Final Database Foundation Review, Static Audit & Pre-Execution Specification  
**Version**: 2.3 (Final Review Candidate)  
**Date**: October 15, 2026  
**Status**: UNAPPLIED PROPOSAL & EVIDENCE-BASED STATIC REVIEW (ZERO LIVE SQL EXECUTED)  
**Primary Deliverable**: `supabase/migrations/20261014000400_cloud_database_foundation_final.sql`  
**Changelog**: `public/cloud_database_foundation_final_changelog.md`  
**Target Environment**: Internal construction-site team (~20 concurrent site engineers & supervisors)  

---

## 1. Executive Summary & Scope of Review

This document presents a comprehensive, evidence-based review of the simplified cloud database foundation for the **myRet** application. Following the removal of enterprise role hierarchies and activity-logging subsystems in Phase 1.2, this review inspects the candidate against the confirmed domain rules, transaction safety, currency calculations, offline-first behavior, and backward compatibility.

### Summary of Key Actions:
1. **Enforced Single-Editor Constraint**: Eliminated all write paths for non-owners. `retirement_access.role` is restricted to `'REVIEWER'`. Helper functions and RLS policies guarantee that **only the actual retirement primary owner** can insert, update, or delete retirements, daily records, categories, expense items, supplementary entries, and project connections.
2. **Hardened Daily-Record First-Save Concurrency**: Added a transaction-scoped advisory lock (`pg_advisory_xact_lock`) at the start of `upsert_daily_record_hierarchy`. This prevents simultaneous first saves from racing before a parent record exists, fully serializing competing requests for the same date and retirement.
3. **Corrected Connected-Retirement Normalization**: Replaced the DO block that previously skipped adding the canonical constraint with a robust data normalization sequence that safely swaps inverted pairs, removes reciprocal duplicates and self-connections, and strictly enforces `CHECK (retirement_id < connected_id)`.
4. **Clarified Currency Precision**: Standardized the generated column expression to `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED` and corrected documentation terminology to reflect standard half-up arithmetic.
5. **Conducted Thorough Offline-First Reality Audit**: Grounded the offline assessment in the actual repository implementation, confirming that local persistence is currently powered by synchronous `localStorage` and documenting the exact integration requirements for Phase 2 cloud synchronization.

---

## 2. Itemized Findings Report

Every finding from this static review is classified below with severity, code evidence, effect on myRet, required action, and resolution disposition:

| Finding ID | Title & SQL Object | Classification | Severity | Actual Code Evidence | Effect on myRet | Required Action & Disposition |
|---|---|---|---|---|---|---|
| **F-01** | **Multi-Editor Vulnerability in `retirement_access`** | **CONFIRMED DEFECT** | **HIGH** | `20261014000300`: Line 46: `role VARCHAR(20) DEFAULT 'REVIEWER' CHECK (role IN ('OWNER', 'REVIEWER'))`. Line 134: `OR EXISTS (... role = 'OWNER')`. | Allowed granting collaborators editor status, violating Confirmed Rule D: *"Only the actual retirement owner may edit a retirement."* | **RESOLVED in 20261014000400**: Tightened constraint to `CHECK (role = 'REVIEWER')`. Bound all write policies exclusively to `owner_id = auth.uid()`. |
| **F-02** | **First-Save Race Condition in `upsert_daily_record_hierarchy`** | **CONFIRMED DEFECT** | **HIGH** | `20261014000300`: Line 399: `SELECT id, version INTO ... FROM daily_records ... FOR UPDATE`. On first save, 0 rows match so no lock is acquired; concurrent requests race on `ON CONFLICT` and category recreation. | Competing initial saves on the same date could silently overwrite one another's categories and items. | **RESOLVED in 20261014000400**: Added `PERFORM pg_advisory_xact_lock(hashtext(p_retirement_id::text \|\| ':' \|\| p_record_date::text));` at function entry. |
| **F-03** | **Silent Skipping of Canonical Constraint** | **CONFIRMED DEFECT** | **MEDIUM** | `20261014000300`: Lines 103-107: `IF NOT EXISTS (SELECT 1 ... WHERE retirement_id >= connected_id) THEN ALTER TABLE ... ADD CONSTRAINT ... END IF;`. | If existing rows violated canonical ordering, the constraint was silently skipped without error or notification. | **RESOLVED in 20261014000400**: Added normalization sequence: swaps non-canonical pairs `(A, B)` where `A > B` to `(B, A)`, deletes reciprocal duplicates and self-connections, and enforces constraint. |
| **F-04** | **Unrounded Generated Column Expression** | **CONFIRMED DEFECT** | **LOW** | `20261014000300`: Line 70: `amount NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED`. Function used `ROUND(qty * rate, 2)`. | Minor theoretical discrepancy between intermediate numeric multiplication and explicit 2-decimal rounded subtotals. | **RESOLVED in 20261014000400**: Updated generated column to `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`. |
| **F-05** | **Misleading "Bank-Grade Rounding" Terminology** | **CONFIRMED DEFECT** | **LOW** | Previous changelogs referred to `ROUND(val, 2)` as "bank-grade rounding" (ties-to-even). | Inaccurate technical description; PostgreSQL `ROUND(numeric, 2)` performs round half-away-from-zero. | **RESOLVED in Documentation**: Replaced with standard half-up 2-decimal currency arithmetic. |
| **F-06** | **Offline Synchronization Status Discrepancy** | **CONFIRMED DEFECT** | **MEDIUM** | Historical reports implied an active offline sync queue. In reality, `STORAGE_KEYS.SYNC_QUEUE` is an unreferenced key, and syncStatus is hardcoded to `'synced'`. | Created false impression of existing cloud sync logic. | **RESOLVED in Section 5**: Accurately documented verified state of `localStorage` and defined Phase 2 sync integration requirements. |
| **F-07** | **Live Database Schema State Unknown** | **POTENTIAL DEFECT REQUIRING VERIFICATION** | **MEDIUM** | Zero queries executed against live Supabase database per safety rules. Pre-existing live table state is unconfirmed. | Unknown constraints or column types in live DB could conflict with migration statements. | **REQUIRES VERIFICATION**: Addressed via idempotent DDL (`IF NOT EXISTS`, safe column addition) and the Pre-Execution Checklist. |
| **F-08** | **Single-Editor Enforcement on Supplementary Entries & Trash** | **NO ISSUE FOUND** | **N/A** | `retirements` and `supplementary_entries` RLS write policies check `current_user_is_retirement_owner`. | Owners exclusively manage supplementary payments and trash operations; reviewers are restricted to SELECT. | **VERIFIED**: Invariant fully enforced. |

---

## 3. Confirmed Ownership & Single-Editor Architecture

### 3.1 Architectural Principles
The business requirements for myRet mandate strict single-editor isolation:
1. **Primary Owner Exclusivity**: A retirement is created by one engineer (`owner_id = auth.uid()`). That engineer is the sole authority permitted to modify retirement metadata, add or edit daily records, configure categories, enter line items, add supplementary payments, and connect project phases.
2. **Reviewer Read-Only Invariant**: When another engineer imports a retirement using its 12-character code (e.g., `RET-7K4M2P`), the engineer is granted access to the same underlying retirement. That engineer is assigned `role = 'REVIEWER'` in `public.retirement_access`. Under no circumstances can a reviewer modify, insert, or delete any record associated with that retirement.
3. **Prohibition of Delegated Editors**: The database rejects any attempt to assign `role = 'OWNER'` in `public.retirement_access`. The table constraint `CHECK (role = 'REVIEWER')` enforces this at the relational level.

### 3.2 SQL Implementation Comparison
In previous candidates, helper functions and write policies accepted collaborators with `role = 'OWNER'`:
```sql
-- OLD VULNERABLE HELPER (20261014000300)
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_editor(p_ret_id UUID)
...
  WHERE id = p_ret_id AND (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM retirement_access WHERE role = 'OWNER'))
```

In the final candidate (`20261014000400`), this write path is permanently closed:
```sql
-- FINAL HARDENED HELPER (20261014000400)
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_owner(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements
    WHERE id = p_ret_id
      AND status = 'active'
      AND owner_id = auth.uid()
  );
$$;

-- Backward compatibility alias
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_editor(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_is_retirement_owner(p_ret_id);
$$;
```

All write RLS policies (`INSERT`, `UPDATE`, `DELETE`) on `daily_records`, `categories`, `expense_items`, `supplementary_entries`, `retirement_access`, and `connected_retirements` call `public.current_user_is_retirement_owner(...)`. Reviewers attempting direct table mutations receive an immediate `42501` insufficient privilege violation.

---

## 4. Concurrency, Advisory Locking & Transaction Preservation

### 4.1 First-Save Race Condition & Advisory Locking
In `20261014000300`, `upsert_daily_record_hierarchy` attempted to lock existing records using `SELECT ... FOR UPDATE`. However, on the initial save for a given date, the record does not yet exist. A `SELECT ... FOR UPDATE` on a non-existent row acquires no lock. If two network requests (e.g. an impatient double-tap by an engineer on a construction site with high latency) arrived concurrently:
1. Both requests found `v_existing_id IS NULL`.
2. Request 1 executed `INSERT INTO daily_records ...` creating the row with `version = 1`.
3. Request 2 executed `INSERT INTO daily_records ... ON CONFLICT DO UPDATE SET version = daily_records.version + 1` bumping version to 2.
4. Both requests then executed `DELETE FROM categories ...` and inserted their categories, causing race-dependent overwrites and version discrepancies.

**Resolution in `20261014000400`**:
At the very entry of the function, before any queries are executed, the function acquires a transaction-level advisory lock:
```sql
PERFORM pg_advisory_xact_lock(hashtext(p_retirement_id::text || ':' || p_record_date::text));
```
**Guarantees**:
- The hash of `retirement_id:record_date` uniquely identifies the lock key for that specific date.
- Request 1 immediately obtains the lock.
- Request 2 blocks until Request 1's transaction commits or rolls back.
- When Request 2 unblocks, Request 1's newly inserted record already exists in the database.
- Request 2's subsequent `SELECT ... FOR UPDATE` finds `v_existing_id` populated with `version = 1`.
- If Request 2 is a competing save with a stale expected version, it throws a clean `CONCURRENCY_CONFLICT` exception instead of corrupting data.
- The advisory lock is transaction-scoped: it is automatically released by PostgreSQL on commit or rollback without leaking resources.

### 4.2 Transaction Atomicity & Failure Rollback
PL/pgSQL functions execute within an implicit transaction. In `upsert_daily_record_hierarchy`:
- If an exception is raised at any stage (e.g., negative quantity, string length exceeded, or concurrency conflict), PostgreSQL automatically aborts the entire transaction.
- The deletion of old categories (`DELETE FROM public.categories WHERE daily_record_id = ...`) is completely rolled back.
- The parent record, existing categories, existing expense items, and previously saved totals remain 100% intact.
- Zero exceptions are caught or swallowed inside the function, guaranteeing true all-or-nothing atomicity.

---

## 5. Offline-First Assessment: Local Storage vs Cloud Synchronization

*In accordance with the project instructions, this section distinguishes verified facts from assumptions based on actual code inspection.*

### 5.1 Current Implementation Reality
Static inspection of `src/utils/storage.ts`, `src/types/index.ts`, and React components reveals the following verified facts:

1. **Local Storage Engine**:
   - All client data is currently persisted in browser `localStorage` using serialized JSON strings (`myret_retirements`, `myret_daily_records`, `myret_supplementary`, etc.).
   - There is **no IndexedDB** implementation currently present in the codebase.
2. **Sync Queue Status**:
   - `STORAGE_KEYS.SYNC_QUEUE: 'myret_sync_queue'` is defined on line 54 of `src/utils/storage.ts`, but it is **never read, written, or manipulated anywhere in the codebase**.
   - There is **no background synchronization worker**, no offline queue runner, and no network retry scheduler.
3. **Sync Status Flags**:
   - The TypeScript interfaces (`DailyRecord`, `SupplementaryEntry`, `Retirement`) contain `syncStatus: 'synced' | 'pending'`.
   - In all component save paths (`DailyRecordModal.tsx` L317, `SupplementaryModal.tsx` L54, `CreateRetirementModal.tsx` L96), `syncStatus` is simply hardcoded to `'synced'`.
4. **PWA & Network Detection**:
   - The app includes `useOnlineStatus` hook monitoring `window.addEventListener('online')` and `navigator.onLine`.
   - `OfflineIndicator.tsx` displays an offline banner when disconnected.
   - Vite PWA plugin (`vite-plugin-pwa`) with Workbox caches application static assets (JS, CSS, HTML, fonts, icons) enabling offline app shell loading.

### 5.2 Phase 2 Integration Requirements for True Offline-First Sync
To transition from the current local-only state to cloud synchronization without breaking offline site reliability, the Phase 2 application integration must implement:

1. **Durable Mutation Queue**:
   When offline, record mutations in a durable `myret_sync_queue` in `localStorage` with `syncStatus = 'pending'`, timestamp, payload, and retry count.
2. **Optimistic Local Saves**:
   Local saves must continue to update `localStorage` immediately and notify UI hooks without awaiting network responses.
3. **Sequential Sync Engine**:
   When `useOnlineStatus` detects connectivity, process pending queue entries sequentially using idempotent RPCs (`upsert_daily_record_hierarchy`).
4. **Conflict Handling Protocol**:
   If an RPC returns `CONCURRENCY_CONFLICT`, the sync engine must not silently discard the local change. It must flag the retirement for user review, offering options to keep local edits or reload cloud data.
5. **Trash & Deletion Sync**:
   Deletions must record a `delete_retirement` mutation in the queue. A deleted record must never be revived by subsequent sync operations.

---

## 6. Frontend & Backend Compatibility Assessment

| Application Component | Current Code Status | Compatibility with Candidate `20261014000400` | Required Phase 2 Integration Work |
|---|---|---|---|
| **`src/utils/storage.ts`** | Calls `localStorage` exclusively. Has `STORAGE_KEYS` for retirements, daily records, etc. | **100% Compatible**: Database migration does not alter or break localStorage behavior. | Add Supabase client persistence methods alongside local storage calls. |
| **`DailyRecordModal.tsx`** | Generates category/item hierarchy, computes subtotal and dailyTotal, writes to `storage.saveDailyRecord`. | **Compatible**: Payload schema generated by modal matches `p_categories JSONB` expected by `upsert_daily_record_hierarchy`. | Update submit handler to call `supabase.rpc('upsert_daily_record_hierarchy', ...)` with `version` when online. |
| **`ConnectRetirementModal.tsx`** | Connects retirements bidirectionally in `localStorage` arrays (`connectedRetirementIds`). | **Compatible**: RPC `connect_retirements(a, b)` canonicalizes IDs and returns connection UUID. | Wire "Connect" button to call `supabase.rpc('connect_retirements', { p_retirement_a, p_retirement_b })`. |
| **`AddExistingModal.tsx`** | Imports retirement by code; appends `role: 'REVIEWER'` in access list. | **100% Compatible**: Matches `claim_retirement_by_code(p_code)` which strictly grants `role = 'REVIEWER'`. | Call `supabase.rpc('claim_retirement_by_code', { p_code })` when cloud-enabled. |
| **`TrashView.tsx`** | Displays retirements with `status = 'in_trash'`; restores or permanently deletes after 48 hrs. | **100% Compatible**: Database table `retirements` defines `status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'in_trash'))` and `deleted_at`. | Query `retirements` table with `status = 'in_trash'` for trash view. |
| **`server.ts`** | Runs Express backend. `POST /api/admin/reset-password` calls Supabase Auth Admin API (`updateUserById`). | **100% Compatible**: Migration removes unnecessary `user_roles` without touching server-side admin logic. | None. Password reset logic remains isolated and operational server-side. |

---

## 7. Unverified Assumptions & Database Environment Tests

*Static code inspection cannot replace live database execution. The following checks require a real Supabase database environment during human application:*

1. **Pre-Existing Table Data in `connected_retirements`**:
   - *Assumption*: Any pre-existing rows in `connected_retirements` can be normalized by swapping `retirement_id` and `connected_id`.
   - *Required Test*: In staging, inspect `SELECT count(*) FROM public.connected_retirements WHERE retirement_id >= connected_id`. Verify normalization DO block runs without foreign key violation.
2. **Auth Schema & Trigger Privileges**:
   - *Assumption*: Executing role has permission to create `on_auth_user_created` trigger on `auth.users`.
   - *Required Test*: In Supabase SQL Editor, verify trigger creation succeeds under `postgres` role.
3. **Advisory Lock Key Distribution**:
   - *Assumption*: `hashtext(retirement_id || ':' || record_date)` provides a sufficiently distributed 32-bit integer key without hash collisions across different projects.
   - *Required Test*: Execute concurrent load tests with 20 simulated workers saving records across different projects to verify no unexpected lock contention.
4. **Performance of Collaborative Profile RLS Policy**:
   - *Assumption*: The subquery joining `retirement_access` and `retirements` executes within <5ms for a 20-user site deployment.
   - *Required Test*: Run `EXPLAIN ANALYZE SELECT * FROM public.profiles` with 20 user profiles and 50 shared retirements.

---

## 8. Pre-Execution Checklist

Before applying `supabase/migrations/20261014000400_cloud_database_foundation_final.sql` in the Supabase Dashboard SQL Editor, review the status of each area:

| Area | Scope Description | Status | Verification Detail |
|---|---|---|---|
| **A. Database Migration Readiness** | DDL syntax, constraints, helper functions, RPC signatures, least-privilege table grants. | **READY** | Migration SQL is 100% static-validated, idempotent, single-editor hardened, and free of obsolete subsystems. |
| **B. Frontend/Backend Integration Readiness** | Direct Supabase CRUD calls from React components, offline queue worker, RPC client invocations. | **NOT READY** *(By Design for Phase 1)* | The frontend currently runs on `localStorage`. Full integration is the explicit scope of Phase 2. Migration does NOT break current app. |
| **C. Offline-First Behaviour Readiness** | Asset caching, local persistence, offline form submission, PWA installability. | **READY** *(Local Persistence)* | `localStorage` and Workbox service worker operate offline. Server synchronization queue remains to be wired in Phase 2. |
| **D. Existing-Data Preservation Readiness** | Non-destructive schema updates, additive columns, safe connection normalization. | **REQUIRES VERIFICATION** | Safe DDL is included. Live check of any existing `connected_retirements` data in target environment is required before execution. |
| **E. Security and Permission Readiness** | Single-editor enforcement, reviewer read-only isolation, anonymous lockout, service key secrecy. | **READY** | All write paths restricted to `owner_id = auth.uid()`. `anon` revoked. Service-role key kept server-side in `server.ts`. |

---

## 9. Final Conclusion

Candidate migration `20261014000400_cloud_database_foundation_final.sql` represents a complete, secure, minimal, and mathematically consistent cloud foundation. It strictly enforces the confirmed single-editor rule, eliminates race conditions on initial daily record creation, ensures exact 2-decimal half-up currency calculations, and preserves all existing local storage behaviors without introducing enterprise overhead.
