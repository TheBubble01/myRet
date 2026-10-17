# myRet — Site Expenditure & Retirement

> **Progressive Web App (PWA)** for digital construction-site expenditure and retirement management, designed to replace physical retirement books with automated calculations, collaborative reviewer access, audit-ready PDF reporting, and offline-first cloud synchronization.

---

## 1. Project Overview

**myRet** streamlines on-site financial accounting for construction site engineers, supervisors, and administrative project managers. It replaces cumbersome physical notebooks with a resilient digital platform that tracks daily expenditures, emergency disbursements, and multi-project retirements while functioning seamlessly both on-site (offline) and in connected environments.

### Core Capabilities
* **Daily Expenditure Tracking**: Aggregate daily items with automated quantity-rate calculations, category-level subtotals, and half-up currency rounding.
* **Supplementary Payments**: Manage advance payments, emergency site cash infusions, and adjustments linked directly to specific retirements.
* **Connected Retirements**: Establish canonical links between related project retirements for consolidated tracking and cross-site reference.
* **Single-Editor & Reviewer RBAC**: 
  * **Owner (Editor)**: Has exclusive editing privileges for their created retirements.
  * **Reviewer (Auditor)**: Read-only access granted via project codes (`RET-XXXXXX`) or explicit sharing.
* **48-Hour Trash Recovery**: Soft-delete safety net allowing 48 hours to restore trashed retirements before permanent deletion.
* **Audit-Ready PDF Export**: Client-side vector PDF generation featuring detailed itemized breakdowns, category summaries, supplementary disbursements, and signature blocks.
* **Offline-First Resilience**: Full operational availability without an internet connection using local caching and an intelligent background sync queue.

---

## 2. Technology Stack & Architecture

* **UI Framework**: React 19, TypeScript
* **Build System**: Vite 8, Tailwind CSS v4, Motion (Framer Motion)
* **PWA & Offline**: `vite-plugin-pwa` with service worker caching and `localStorage` durable state storage
* **Authentication & Cloud Database**: Supabase Auth (JWT) & Supabase PostgreSQL (PostgREST API)
* **Backend Server**: Express 4 with `tsx` (`server.ts`) for dev serving and server-side administrative endpoints (gated user management and password resets)
* **PDF Engine**: `jspdf` & `jspdf-autotable`

---

## 3. Key Findings from Final Read-Only Inspection Report

A comprehensive read-only audit of the codebase and the live Supabase project was conducted to assess cloud database readiness. Below is a summary of the findings:

### 3.1 Live Database State
* **Connectivity**: The application successfully connects to the Supabase REST (`/rest/v1/`) and Auth endpoints (`HTTP 200`).
* **Existing Accounts**: The internal `auth.users` table exists and contains **8 registered user accounts**.
* **Public Schema Tables**: The live `public` schema currently has **0 business tables** applied. Queries to required tables (`profiles`, `retirements`, `retirement_access`, `daily_records`, `categories`, `expense_items`, `supplementary_entries`, `connected_retirements`, `activity_logs`) return PostgREST error `PGRST205: Could not find table in schema cache`.
* **RPC Functions**: Required stored procedures (`upsert_daily_record_hierarchy`, `claim_retirement_by_code`, `connect_retirements`) are not yet present in the live schema cache.
* **Cloud Business Data**: Exactly **0 business records** exist in the cloud database, meaning there is zero risk of data conflicts, regressions, or accidental data overwrites when applying the schema.

### 3.2 Application Resilience & Local Safety
* **Active Guardrail**: The synchronization engine (`src/utils/syncService.ts`) actively evaluates database readiness using `checkTablesReady()`. When tables are missing, the UI gracefully enters **`Local Safe (Cloud DB Pending)`** mode.
* **Data Integrity**: All expenditures, daily records, and local modifications remain 100% durable in `localStorage`. Mutations are stored in `myret_sync_queue` and are held until cloud tables become available.
* **Security & Credential Isolation**: Client bundles (`src/`) only contain the public anonymous key (`VITE_SUPABASE_ANON_KEY`). The `SUPABASE_SERVICE_ROLE_KEY` is strictly confined to server memory in `server.ts` for protected administrative routes.

### 3.3 Prepared Migration Script
* The complete, non-destructive migration script is ready and validated at:
  * `public/myret_cloud_persistence_migration.sql`
  * `supabase/migrations/20261016000100_myret_cloud_persistence.sql`
* **Features of the Migration**:
  * Fully idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
  * Non-destructive: Does not drop any schemas or tables.
  * Automatic profile backfill: Safely inserts profile records for the 8 pre-existing `auth.users`.
  * Enforces Row Level Security (RLS) guaranteeing owner-only edit rights and reviewer read-only access.
  * Defines stored-generated column `amount` on `expense_items` (`GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED`).

---

## 4. Maintenance & Operations Guide

### 4.1 Enabling Live Cloud Persistence
To connect the live database tables to the existing frontend application:
1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open the project associated with `VITE_SUPABASE_URL`.
3. Go to the **SQL Editor** in the left sidebar.
4. Copy the entire contents of `public/myret_cloud_persistence_migration.sql`.
5. Paste into the SQL Editor and click **Run**.
6. **Verification**: Refresh the myRet application. The sync status indicator will transition from `Local Safe (Cloud DB Pending)` to `Synced`. All queued operations will automatically sync to the database.

### 4.2 Local Development Commands
```bash
# Install dependencies
npm install

# Start local full-stack development server (Express + Vite)
npm run dev

# Run TypeScript compilation check
npm run lint

# Build production bundle
npm run build

# Preview production build
npm run preview
```

### 4.3 Key Source Files & Responsibilities
* `src/utils/storage.ts`: Core data storage operations, localStorage management, local cache hydration, and currency formatting.
* `src/utils/syncService.ts`: Bidirectional cloud synchronization engine, table readiness verification, conflict management, and sync queue processor.
* `src/utils/supabaseClient.ts`: Supabase client initialization and authentication helpers.
* `src/utils/pdfGenerator.ts`: Official audit report PDF formatting and generation engine.
* `src/components/retirement/`: Core retirement views, daily expenditure logs, category modals, and share modals.
* `server.ts`: Express server mounting Vite middleware in dev and providing administrative user management API endpoints.

---

## 5. Audit & Documentation History
For in-depth historical inspection and design documentation, refer to the following reports:
* `myret_final_supabase_database_inspection_report.md` (and `public/myret_final_supabase_database_inspection_report.md`) — Final database audit report.
* `myret_application_source_code_inspection_report.md` — Complete static source code inspection.
* `myret_cloud_persistence_implementation_report.md` — Implementation specifications and offline sync architecture.
