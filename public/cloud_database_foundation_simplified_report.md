# Phase 1.2 Database Foundation: Simplified Technical Review & Validation Report

**Project**: myRet — Site Expenditure & Retirement Management PWA  
**Document**: Simplified Database Foundation Review & Static Validation Report  
**Version**: 2.2 (Phase 1.2 Practical Candidate)  
**Date**: October 15, 2026  
**Status**: UNAPPLIED PROPOSAL & ARCHITECTURAL REVIEW (ZERO LIVE SQL EXECUTED)  
**Primary Deliverable**: `supabase/migrations/20261014000300_cloud_database_foundation_simplified.sql`  
**Changelog**: `public/cloud_database_foundation_simplified_changelog.md`  
**Target Environment**: Internal construction-site team (~20 concurrent site engineers & supervisors)  

---

## 1. Executive Summary

This review completes the simplification and correction of the myRet cloud database foundation. Previous candidate revisions introduced enterprise-scale abstractions (such as an administrative role hierarchy, two-tiered privilege models, and a separate activity audit subsystem) that were disproportionate to the actual operational needs of a 20-person site team.

The revised candidate (`20261014000300_cloud_database_foundation_simplified.sql`):
1. **Removes the Administrative Hierarchy**: Drops `public.user_roles` and administrative bypasses from RLS policies. Password resets are handled via the existing trusted server-side Supabase Admin API in `server.ts`.
2. **Removes the Activity-Logging Subsystem**: Eliminates `public.activity_logs`, related triggers, RLS policies, and log insertions inside stored procedures.
3. **Corrects `connect_retirements` RPC**: Fixes the critical bug where existing connections returned `NULL`, adds self-connection rejection, and enforces canonical ordering (`LEAST(a, b)`, `GREATEST(a, b)`).
4. **Hardens Daily Record Persistence**: Serializes concurrent edits with a PostgreSQL `FOR UPDATE` lock, validates string lengths and payload types, enforces bank-grade rounding to 2 decimal places, and preserves generated column rules.
5. **Ensures Schema Compatibility**: Provides safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for existing tables, ensuring backward compatibility with tables initialized from `supabase/schema.sql`.

---

## 2. Scope & Methodology: What Was Checked

Every finding and design choice is grounded in static inspection of repository files:
1. `supabase/schema.sql`: Analyzed baseline schema (9 tables, initial RLS rules). Verified that child tables depend on `daily_records.retirement_id` and `retirements.id`.
2. `supabase/migrations/20261014000000_cloud_database_foundation.sql`: Inspected initial migration proposal.
3. `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql`: Inspected first reviewed candidate.
4. `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql`: Inspected previous corrective candidate.
5. `src/types/index.ts`: Verified domain entities (`Retirement`, `DailyRecord`, `Category`, `ExpenseItem`, `SupplementaryEntry`, `UserProfile`). Verified that `activityLogs` in TypeScript domain is currently handled in local storage.
6. `src/utils/storage.ts`: Confirmed that `ACTIVITY_LOGS: 'myret_activity_logs'` is purely a localStorage key with zero Supabase client calls. Confirmed that removing `activity_logs` from the SQL migration has zero impact on frontend execution.
7. `server.ts`: Confirmed that `POST /api/admin/reset-password` uses `adminClient.auth.admin.updateUserById`, requiring no database role table.

---

## 3. What Was Changed

### 3.1 Removed Unnecessary Subsystems
- **Removed `public.user_roles`**: Deleted table definition, unique constraints, and policies.
- **Removed Admin Helper Functions**: Deleted `current_user_is_admin()` and `current_user_is_tech_admin()`.
- **Removed Admin Bypasses**: Removed all `OR public.current_user_is_admin()` clauses from RLS policies on `profiles`, `retirements`, `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, and `connected_retirements`.
- **Removed `public.activity_logs`**: Deleted table, indexes, RLS policies, and table grants.
- **Removed Audit Insertion Logic**: Removed all log generation queries, user name lookups, and insert statements from `claim_retirement_by_code` and `upsert_daily_record_hierarchy`.

### 3.2 Corrected Functions & RPCs
- **`connect_retirements(p_retirement_a, p_retirement_b)`**:
  - Rejects null IDs and self-connections (`p_retirement_a = p_retirement_b`).
  - Orders IDs canonically (`LEAST` and `GREATEST`).
  - Enforces dual-editor authorization (`current_user_is_retirement_editor`).
  - Fixed return value: If connection already exists, queries and returns the existing connection's `id` instead of `NULL`.
- **`upsert_daily_record_hierarchy(...)`**:
  - Added row-level lock (`SELECT ... FOR UPDATE`) on existing records to serialize concurrent edits within PostgreSQL transactions.
  - Added defensive payload validation: `jsonb_typeof(p_categories) = 'array'`, category name <= 150 chars, item description <= 300 chars, quantity and rate >= 0.
  - Preserved existing primary key if present (`COALESCE(v_existing_id, p_record_id, gen_random_uuid())`).
  - Enforced 2-decimal rounding (`ROUND(qty * rate, 2)`) matching `expense_items.amount`.
  - Excluded generated column `amount` from `INSERT INTO public.expense_items`.

### 3.3 Hardened Table Grants & Security
- Revoked all permissions from `PUBLIC` and `anon` on all public tables and sequences.
- Granted explicit least-privilege operations to `authenticated` for the 8 core tables only.

---

## 4. What Was Not Changed

1. **Zero Application Source Code Changes**: No files in `src/`, `server.ts`, or project configurations were modified.
2. **Historical Candidates Preserved**: All previous migrations (`20261014000000`, `20261014000100`, `20261014000200`) remain untouched.
3. **Core Domain Functionality**:
   - Retirement ownership and sharing roles (`OWNER` vs `REVIEWER`).
   - One daily record per retirement per date constraint (`UNIQUE(retirement_id, record_date)`).
   - Generated column calculation: `amount GENERATED ALWAYS AS (quantity * rate) STORED`.
   - 48-hour trash lifecycle (`status = 'in_trash'`, `deleted_at`).
   - Automated profile creation on user signup (`handle_new_user` trigger).

---

## 5. Validation Summary: Static Checks Performed

The following static checks were performed across the migration file without connecting to Supabase:

| Check Item | Validation Method | Result / Verification |
|---|---|---|
| **SQL Syntax & Parser Integrity** | Static syntax structure inspection of all DDL, DML, plpgsql blocks, and dollar-quoting (`$$`). | **PASS**: All blocks closed, variables declared, and semicolons matched. |
| **Removed Subsystem References** | Grep analysis for `activity_logs`, `user_roles`, `is_admin`, and `tech_admin` in `20261014000300`. | **PASS**: Zero active references. Only clean drops (`DROP TABLE IF EXISTS ... CASCADE`) included. |
| **Table & Column References** | Cross-referenced every column in foreign keys, indexes, triggers, and RPCs against base table DDL. | **PASS**: All column names match 100% (`owner_id`, `record_date`, `daily_total`, etc.). |
| **Foreign Key Consistency** | Verified referencing table and target table types (all UUIDs). | **PASS**: All FKs target existing primary keys with `ON DELETE CASCADE`. |
| **Unique Constraints & Canonical Ordering** | Verified unique constraints on `daily_records(retirement_id, record_date)` and `connected_retirements(retirement_id, connected_id)`. | **PASS**: Dual-key uniqueness prevents duplicates; `CHECK (retirement_id < connected_id)` prevents symmetry duplicates. |
| **RLS Policy Coverage** | Verified that all 8 core tables have RLS enabled and have explicit policies for SELECT, INSERT, UPDATE, and DELETE. | **PASS**: Full matrix coverage. Non-owners cannot read or modify private data. |
| **Generated Column Exclusion** | Inspected `INSERT INTO public.expense_items` in `upsert_daily_record_hierarchy`. | **PASS**: `amount` is omitted from the insert column list. |
| **Grant Coverage** | Inspected `GRANT` statements in Section 9. | **PASS**: Matches exact table list. No grants on dropped tables. `anon` has zero table access. |

---

## 6. Real Database Environment Requirements: What Must Be Verified on Supabase

*Note: In accordance with safety boundaries, zero SQL was executed against the live database. The following items must be verified during human review when applying the migration:*

1. **Existing Tables Status**: Confirm whether `retirements` or `daily_records` already exist in the target database. The migration uses `ADD COLUMN IF NOT EXISTS` for `status`, `deleted_at`, and `version`, which executes safely whether columns exist or not.
2. **Existing Connected Retirements Data**: If `connected_retirements` already contains rows where `retirement_id >= connected_id`, the migration safely checks before adding the `CHECK` constraint. If non-canonical rows exist, they should be normalized prior to constraint enforcement.
3. **Superuser Permissions for Trigger**: The `on_auth_user_created` trigger attaches to `auth.users`, which requires standard Supabase database admin privileges (available by default when running via the Supabase Dashboard SQL Editor).
4. **Service Role Key Secrecy**: Verify that `SUPABASE_SERVICE_ROLE_KEY` is defined exclusively in the backend server environment (`.env`) and is never packaged into client Vite bundles.

---

## 7. Conclusion

Migration candidate `20261014000300_cloud_database_foundation_simplified.sql` delivers a clean, secure, and maintainable cloud foundation tailored specifically for the myRet team. Unnecessary enterprise subsystems have been completely removed, practical concurrency and financial rounding have been hardened, and existing application behavior remains completely preserved.
