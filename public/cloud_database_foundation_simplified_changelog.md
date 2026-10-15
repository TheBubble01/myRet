# Phase 1.2 Database Foundation: Simplified Revision Changelog

**Release Candidate**: `supabase/migrations/20261014000300_cloud_database_foundation_simplified.sql`  
**Previous Corrective Candidate**: `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql`  
**Baseline Schema**: `supabase/schema.sql`  
**Execution Status**: UNAPPLIED PROPOSAL (Proposal Artifact Only; ZERO SQL Executed; ZERO Live Database Changes)  
**Date**: October 15, 2026  
**Companion Report**: `public/cloud_database_foundation_simplified_report.md`  

---

## 1. Summary of Architectural Simplification

myRet is an internal site expenditure and retirement utility designed for a team of ~20 concurrent construction site engineers and supervisors. Following stakeholder review, this revision eliminates speculative enterprise abstractions and over-engineered subsystems, focusing strictly on practical domain integrity and reliable performance.

All historical migration candidates (`20261014000000`, `20261014000100`, `20261014000200`) and historical audit reports remain preserved without modification. Zero application source files in `src/` or `server.ts` were touched.

---

## 2. Itemized Changes and Rationale

| # | Domain / Component | Previous State (`20261014000200`) | Simplified State (`20261014000300`) | Practical Rationale & Operational Impact |
|---|---|---|---|---|
| **1** | **Administrative Role System** | Dedicated `public.user_roles` table with two-tier hierarchy (`admin` vs `tech-admin`), bootstrap scripts, and `current_user_is_admin()`. | **Removed Completely**: No `user_roles` table, no role hierarchy, no helper functions. | Password resets are handled securely server-side via Supabase Admin API in `server.ts`. No database role infrastructure is needed for a 20-person site team. |
| **2** | **Administrative RLS Bypasses** | RLS policies on business tables included `OR public.current_user_is_admin()` or `OR public.current_user_is_tech_admin()`. | **Removed Bypasses**: Business data access is strictly governed by ownership and explicit collaborator sharing (`retirement_access`). | Prevents administrators from having unrestricted access to private retirement books merely because of an admin flag. |
| **3** | **Activity-Logging Subsystem** | `public.activity_logs` table, indexes, append policies, table grants, and audit log insertions in all RPCs. | **Removed Completely**: `public.activity_logs` table and all log insertion logic removed. Cleaned up variables (`v_user_name`) and log queries. | Audit logging is not currently required for myRet's core site expenditure workflow. Eliminates unnecessary database overhead. |
| **4** | **`connect_retirements` RPC Bug** | Used `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. When connection already existed, returned `NULL`. | **Fixed**: When `ON CONFLICT DO NOTHING` produces no insert, queries and returns the existing connection's `id`. | Callers always receive a valid connection UUID, preventing `null` reference errors on the client. |
| **5** | **`connect_retirements` Self-Check** | Checked self-connection after variable assignments. | Added explicit guard: rejects `p_retirement_a = p_retirement_b` and validates both IDs are non-null. | Prevents invalid self-referencing connections. |
| **6** | **Daily Record Concurrency & Serialization** | Queried `daily_records` without row locks; relied solely on version comparison. | Added `FOR UPDATE` lock on `SELECT id, version FROM public.daily_records ...` to serialize concurrent edits within PostgreSQL transactions. | Guarantees atomic isolation when multiple site engineers edit the same daily record simultaneously. |
| **7** | **Daily Record Identity & ID Handling** | Upsert could overwrite existing daily record ID if `p_record_id` differed. | Preserves existing `id` via `COALESCE(v_existing_id, p_record_id, gen_random_uuid())`. | Maintains stable primary keys for daily records across edits. |
| **8** | **Financial Rounding Consistency** | Implicit numeric arithmetic. | Explicit bank-grade rounding to 2 decimal places (`ROUND(qty * rate, 2)`) for item totals, category subtotals, and daily totals. | Guarantees perfect consistency down to the kobo between line items and parent totals, matching `expense_items.amount`. |
| **9** | **Generated Column Protection** | Comment noted generated column rule. | Verified and enforced: `expense_items.amount` is excluded from all `INSERT` statements in `upsert_daily_record_hierarchy`. | Eliminates PostgreSQL `42601` error (`cannot insert into generated column`). |
| **10** | **Safe Additive Schema Alterations** | Relied primarily on `CREATE TABLE IF NOT EXISTS`. | Added explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `status`, `deleted_at`, and `version` on existing tables. Added safe canonical constraint verification. | Guarantees existing tables in Supabase receive necessary columns without recreating or dropping tables. |
| **11** | **Table Grants & Least Privilege** | Grants included `user_roles` and `activity_logs`. | Cleaned grants: revokes all privileges from `PUBLIC` and `anon`; grants explicit least-privilege operations to `authenticated` for the 8 core tables only. | Eliminates grants on non-existent objects and ensures anonymous callers have zero access. |

---

## 3. Retained Core Domain Tables (8 Tables)

The simplified foundation consists strictly of 8 domain tables:
1. `public.profiles`: User identity linked 1:1 with `auth.users`.
2. `public.retirements`: Core site expenditure projects (owner, status, trash lifecycle, version).
3. `public.retirement_access`: Sharing permissions (`OWNER` vs `REVIEWER`).
4. `public.daily_records`: Daily expense records (1 record per retirement/date, version).
5. `public.categories`: Expense categories within a daily record (subtotal, sort order).
6. `public.expense_items`: Detailed line items (`amount GENERATED ALWAYS AS (quantity * rate) STORED`).
7. `public.supplementary_entries`: Direct site payments outside daily log.
8. `public.connected_retirements`: Undirected links between projects (`retirement_id < connected_id`).

---

## 4. Preservation Confirmation

The following historical and application files were preserved without modification:
- `supabase/migrations/20261014000000_cloud_database_foundation.sql` (Candidate 1.0) — **UNTOUCHED**
- `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql` (Candidate 2.0) — **UNTOUCHED**
- `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql` (Candidate 2.1) — **UNTOUCHED**
- `supabase/schema.sql` (Baseline) — **UNTOUCHED**
- `public/cloud_database_foundation_corrective_report.md` — **UNTOUCHED**
- `public/cloud_database_foundation_corrective_changelog.md` — **UNTOUCHED**
- All frontend components in `src/` and backend code in `server.ts` — **UNTOUCHED**

---

## 5. Next Steps for Phase 2 Implementation

When approved for application integration:
1. Apply `supabase/migrations/20261014000300_cloud_database_foundation_simplified.sql` in Supabase SQL Editor.
2. In `src/utils/storage.ts`, implement cloud persistence functions calling `upsert_daily_record_hierarchy` and `connect_retirements`.
3. In `DailyRecordModal.tsx`, pass `version` from the loaded daily record to support optimistic concurrency conflict detection.
