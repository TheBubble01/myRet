# Phase 1.1 Database Foundation: Corrective Revision Changelog

**Release Candidate**: `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql`  
**Previous Reviewed Candidate**: `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql`  
**Original Candidate**: `supabase/migrations/20261014000000_cloud_database_foundation.sql`  
**Baseline Schema**: `supabase/schema.sql`  
**Execution Status**: UNAPPLIED (Proposal Artifacts Only; ZERO SQL Executed; ZERO Live Database Changes)  
**Date**: October 14, 2026  
**Companion Report**: `public/cloud_database_foundation_corrective_report.md`  

---

## 1. Summary of Non-Destructive Actions

1. **Preservation of Prior Candidates**:
   - `supabase/migrations/20261014000000_cloud_database_foundation.sql` remains **UNMODIFIED**.
   - `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql` remains **UNMODIFIED**.
   - `public/cloud_database_foundation_reviewed_report.md` and `public/cloud_database_foundation_revision_changelog.md` remain **UNMODIFIED**.
2. **Application Source Code Preservation**:
   - ZERO files in `src/`, `server.ts`, or build configuration were modified.
   - PWA assets, localStorage utilities, and React components remain untouched.
3. **New Artifacts Created**:
   - `supabase/migrations/20261014000200_cloud_database_foundation_corrective.sql` (Comprehensive corrected SQL migration).
   - `public/cloud_database_foundation_corrective_report.md` (Technical audit and architectural specification).
   - `public/cloud_database_foundation_corrective_changelog.md` (This document).
   - Identical copies mirrored at the workspace root for direct download and stakeholder review.

---

## 2. Itemized Changes and Rationale

| # | Domain / Component | Previous State (`20261014000100`) | Corrective State (`20261014000200`) | Security & Compatibility Impact | Verification Status |
|---|---|---|---|---|---|
| **1** | **Administrative Role Hierarchy** | Flat `admin` role in `public.user_roles`. Any admin could grant `admin` or higher roles to any account. | Two-tiered hierarchy (`admin` vs `tech-admin`). Policy `Admins can manage roles with hierarchy` prevents ordinary admins from granting or altering `tech-admin`. | **Critical Security Fix**: Eliminates horizontal and vertical privilege escalation between administrators. | Verified against PostgreSQL RLS semantics. |
| **2** | **Initial Admin Bootstrap** | Self-service bootstrap undefined; risked relying on insecure client metadata or arbitrary email prefixes. | Defined explicit manual/seed bootstrap pattern under `service_role` superuser context. Self-service bootstrap strictly rejected. | **Critical Security Fix**: Closes deployment-phase race conditions and removes all hardcoded developer identities. | Verified against production deployment standards. |
| **3** | **Connected-Retirements Authorization** | Discrepancy: Report stated dual-editor, but SQL allowed an editor of Project A to connect Project B if they were merely a read-only `REVIEWER` on B. | Reconciled: Enforces strict dual-editor requirement. Caller must be an active editor (`OWNER`) on **both** retirements to establish a connection. | **Authorization Hardening**: Prevents read-only reviewers from binding independent capital projects into aggregate financials. | Verified from domain financial requirements. |
| **4** | **Connected-Retirements Canonical Symmetry** | Table allowed asymmetric and reciprocal duplicate entries (`(A,B)` and `(B,A)`), creating duplicate aggregations in reports. | Enforced canonical undirected ordering via `CHECK (retirement_id < connected_id)` and `UNIQUE(retirement_id, connected_id)`. Added helper RPC `connect_retirements(...)`. | **Data Integrity Fix**: Eliminates double-counting in report modals and prevents self-referential connections (`A = B`). | Verified against relational schema principles. |
| **5** | **Daily-Record Input Validation** | `upsert_daily_record_hierarchy` accepted unconstrained strings and lacked payload type checking. | Added explicit validations: `jsonb_typeof(p_categories) = 'array'`, category name max 150 chars, item description max 300 chars, quantity and rate >= 0. | **Robustness & Defensive Hardening**: Rejects malformed or oversized payloads before database mutation. | Verified against TypeScript domain types. |
| **6** | **Financial Rounding & Precision** | Category subtotals and daily totals relied on implicit floating-point accumulation. | Explicit bank-grade 2-decimal rounding applied to every line item: `ROUND(qty * rate, 2)` before subtotal accumulation. | **Financial Integrity**: Guarantees database totals match currency display rules down to the kobo. | Verified against Nigerian Naira formatting rules. |
| **7** | **Optimistic Concurrency Control (OCC)** | No concurrency control; concurrent saves to the same daily record silently overwrote earlier saves. | Added `version BIGINT DEFAULT 1` to `daily_records` and `retirements`. RPC checks `p_expected_version` and raises `CONCURRENCY_CONFLICT` on mismatch. | **Data Loss Prevention**: Prevents silent overwrite when multiple engineers edit site records simultaneously. | Verified transaction rollback semantics. |
| **8** | **Generated Column Protection** | Note existed in comments, but verified in RPC logic. | Ensured `expense_items.amount` is never assigned in `INSERT INTO public.expense_items`, preserving PostgreSQL generated-column rules. | **Execution Correctness**: Eliminates PostgreSQL error `42601` (`cannot insert into column "amount"`). | Verified against PostgreSQL documentation. |
| **9** | **Activity-Log Actor Attribution** | Insert policy allowed `user_id IS NULL OR user_id = auth.uid()`, permitting uncredited or spoofed logs. | Policy strictly requires `user_id = auth.uid()`. Zero UPDATE or DELETE policies created; modification privileges revoked. | **Audit Trail Integrity**: Guarantees true non-repudiation and prevents forged or erased audit history. | Verified against compliance audit standards. |
| **10** | **Least-Privilege Table Grants** | Default `PUBLIC` table privileges left in place; only function EXECUTE privileges were revoked. | Added Section 9: Explicit `REVOKE ALL FROM PUBLIC/anon` and granular least-privilege `GRANT` statements for `authenticated`. No delete on profiles/logs. | **Defense-in-Depth**: Hardens database against accidental RLS bypass or misconfiguration. | Verified PostgreSQL privilege model. |

---

## 3. Detailed Verification of Preserved Files

The following files were inspected to confirm zero regression or modification:

- `supabase/schema.sql` (Initial baseline: 9 tables, 8 policies) — **UNCHANGED**
- `supabase/migrations/20261014000000_cloud_database_foundation.sql` (Candidate 1.0) — **UNCHANGED**
- `supabase/migrations/20261014000100_cloud_database_foundation_reviewed.sql` (Candidate 2.0) — **UNCHANGED**
- `public/cloud_database_foundation_reviewed_report.md` (Report 2.0) — **UNCHANGED**
- `public/cloud_database_foundation_revision_changelog.md` (Changelog 2.0) — **UNCHANGED**
- `public/myret_verification_audit_report.md` (Verification audit) — **UNCHANGED**
- `public/myret_storage_audit_report.md` (Storage audit) — **UNCHANGED**
- `src/utils/storage.ts` — **UNCHANGED**
- `src/utils/supabaseClient.ts` — **UNCHANGED**
- `server.ts` — **UNCHANGED**

---

## 4. Next Steps for Phase 2 Implementation

Upon formal review and approval of this candidate:
1. Apply migration `20261014000200_cloud_database_foundation_corrective.sql` to the target Supabase environment.
2. Bootstrap the initial `tech-admin` user via the Supabase SQL Editor.
3. Update `src/types/index.ts` to include `version?: number` on `DailyRecord` and `Retirement`.
4. Update `src/utils/storage.ts` to call `upsert_daily_record_hierarchy` with `p_expected_version` and handle `CONCURRENCY_CONFLICT`.
5. Update `server.ts` to query `public.user_roles` instead of trusting client metadata.
