# Phase 1.3 Database Foundation: Final Revision Changelog

**Release Candidate**: `supabase/migrations/20261014000400_cloud_database_foundation_final.sql`  
**Previous Simplified Candidate**: `supabase/migrations/20261014000300_cloud_database_foundation_simplified.sql`  
**Baseline Schema**: `supabase/schema.sql`  
**Execution Status**: UNAPPLIED PROPOSAL (Static Review Artifact Only; ZERO SQL Executed; ZERO Live Database Changes)  
**Date**: October 15, 2026  
**Companion Report**: `public/cloud_database_foundation_final_review_report.md`  

---

## 1. Summary of Non-Destructive Actions & Artifacts

- **Preservation of All Prior Migration Proposals**:
  - `supabase/migrations/20261014000000_cloud_database_foundation.sql` (Initial Candidate) — **UNTOUCHED**
  - `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql` (Reviewed Candidate) — **UNTOUCHED**
  - `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql` (Corrective Candidate) — **UNTOUCHED**
  - `supabase/migrations/20261014000300_cloud_database_foundation_simplified.sql` (Simplified Candidate) — **UNTOUCHED**
  - `supabase/schema.sql` (Baseline Reference) — **UNTOUCHED**
- **Application Source Code**: ZERO modifications across `src/`, `server.ts`, or build configurations.
- **New Deliverables Created**:
  1. `supabase/migrations/20261014000400_cloud_database_foundation_final.sql`
  2. `public/cloud_database_foundation_final_review_report.md` (and mirrored at `./cloud_database_foundation_final_review_report.md`)
  3. `public/cloud_database_foundation_final_changelog.md` (and mirrored at `./cloud_database_foundation_final_changelog.md`)

---

## 2. Itemized Changes and Rationale

| # | Domain / Component | Previous State (`20261014000300`) | Final Corrected State (`20261014000400`) | Security, Concurrency & Operational Impact |
|---|---|---|---|---|
| **1** | **Single-Editor Rule: `retirement_access.role`** | Contained `role VARCHAR(20) DEFAULT 'REVIEWER' CHECK (role IN ('OWNER', 'REVIEWER'))`. Allowed assigning collaborators as editors. | **Enforced Single Editor**: `CHECK (role = 'REVIEWER')`. Collaborators can never be assigned editor or owner roles. | **Critical Invariant**: Strictly enforces Confirmed Rule D: Only the actual retirement primary owner can edit retirement data. Collaborators are strictly read-only. |
| **2** | **Single-Editor Rule: Helper Functions** | `current_user_is_retirement_editor` permitted collaborators with `role = 'OWNER'`. | Refactored: `current_user_is_retirement_owner(p_ret_id)` checks exclusively `owner_id = auth.uid()`. `current_user_is_retirement_editor` is retained as an alias for backward compatibility. | **Authorization Hardening**: Closes any write path through helper functions to non-owners. |
| **3** | **Single-Editor Rule: RLS Write Policies** | Mutation policies on `daily_records`, `categories`, `expense_items`, `supplementary_entries`, and `connected_retirements` allowed secondary editors. | Changed all mutation policies (`INSERT`, `UPDATE`, `DELETE`) to check `public.current_user_is_retirement_owner(retirement_id)`. | **Zero Leaks**: Reviewers have SELECT-only access and cannot alter any business records through direct table operations. |
| **4** | **First-Save Concurrency Protection** | `upsert_daily_record_hierarchy` used `SELECT ... FOR UPDATE`, which matched 0 rows when creating a brand new record, allowing competing simultaneous requests to race. | Added transaction-level advisory lock at procedure entry: `PERFORM pg_advisory_xact_lock(hashtext(p_retirement_id::text \|\| ':' \|\| p_record_date::text));`. | **Concurrency Isolation**: Fully serializes competing first-save attempts on the exact same date and retirement before any SELECT or INSERT occurs. |
| **5** | **Canonical Constraint Non-Skipping** | The DO block skipped adding `connected_retirements_canonical_check` if any non-conforming rows existed, leaving the constraint unapplied. | Added safe data normalization: (1) Swaps non-canonical pairs `(A, B)` where `A > B` to `(B, A)` if `(B, A)` doesn't exist; (2) Deletes reciprocal duplicates; (3) Deletes self-connections; (4) Explicitly enforces `CHECK (retirement_id < connected_id)`. | **Data Integrity Fix**: Eliminates silent skipping and guarantees reciprocal consistency across existing and new databases. |
| **6** | **Explicit Generated Column Rounding** | `amount` was defined as `GENERATED ALWAYS AS (quantity * rate) STORED`. | Explicitly defined as `GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`. | **Mathematical Precision**: Guarantees identical 2-decimal half-up currency rounding between PostgreSQL generated storage and procedure calculations. |
| **7** | **Accurate Currency Rounding Terminology** | Documentation incorrectly referred to standard rounding as "bank-grade rounding" (ties-to-even). | Corrected documentation: Clarified that PostgreSQL `ROUND(numeric, 2)` performs standard round half-away-from-zero arithmetic, appropriate for Nigerian Naira and kobo. | **Technical Accuracy**: Reconciles documentation with actual database math behavior. |
| **8** | **Preserved Existing Data & Backward Compatibility** | `p_expected_version BIGINT DEFAULT NULL` retained. | Preserved: Clients passing `NULL` bypass OCC checks without error, allowing existing frontend code to save records while enabling version-based OCC in future integration. | **Compatibility**: Guarantees smooth multi-phase transition from localStorage to Supabase. |

---

## 3. Retained Core Domain Tables (8 Tables)

The cloud database foundation is strictly focused on the 8 necessary domain tables:
1. `public.profiles`: User profiles linked 1:1 with `auth.users`.
2. `public.retirements`: Core site expenditure projects (owner, status, 48-hr trash lifecycle, version).
3. `public.retirement_access`: Collaborator permissions (STRICTLY `REVIEWER` only).
4. `public.daily_records`: Daily expenditure records (1 per retirement/date, version).
5. `public.categories`: Expense categories under daily records (subtotal, sort order).
6. `public.expense_items`: Detailed line items (`amount GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`).
7. `public.supplementary_entries`: Direct site payments outside daily records.
8. `public.connected_retirements`: Undirected canonical links between projects (`retirement_id < connected_id`).

All obsolete structures (`user_roles`, `activity_logs`) remain completely removed.
