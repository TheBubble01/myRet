-- ============================================================================
-- myRet — Stage 2 Additive Migration: Global PDF Header & Report Metadata Customisation
-- File: supabase/migrations/20261019000100_global_pdf_customisation.sql
--
-- Purpose:
--   1. Defines `public.current_user_is_admin()` matching the existing Admin
--      identity and role conventions in `src/utils/supabaseClient.ts` and `server.ts`.
--   2. Creates the single-row `public.global_settings` table (`id = 'global'`)
--      storing `company_header` (JSONB) and `report_metadata` (JSONB).
--   3. Enables Row Level Security (RLS) allowing all `authenticated` users to
--      read (`SELECT`) global settings while restricting `INSERT`, `UPDATE`,
--      and `DELETE` to Admin users.
--   4. Seeds the default `'global'` configuration record idempotently.
-- ============================================================================

BEGIN;

-- 1. Helper function to evaluate whether the current authenticated JWT belongs to an Admin
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims JSONB;
  v_email TEXT;
  v_user_role TEXT;
  v_app_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_email := LOWER(COALESCE(v_claims ->> 'email', ''));
  v_user_role := LOWER(COALESCE(v_claims -> 'user_metadata' ->> 'role', ''));
  v_app_role := LOWER(COALESCE(v_claims -> 'app_metadata' ->> 'role', ''));

  RETURN (
    v_email = 'elmubaraq69@gmail.com'
    OR v_email LIKE 'admin@%'
    OR v_user_role IN ('admin', 'tech-admin')
    OR v_app_role IN ('admin', 'tech-admin')
  );
END;
$$;

-- 2. Single-row Global Settings table
CREATE TABLE IF NOT EXISTS public.global_settings (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  company_header JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- Read access for all authenticated users
DROP POLICY IF EXISTS "Authenticated users can read global settings" ON public.global_settings;
CREATE POLICY "Authenticated users can read global settings"
  ON public.global_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert restricted to existing Admin
DROP POLICY IF EXISTS "Admins can insert global settings" ON public.global_settings;
CREATE POLICY "Admins can insert global settings"
  ON public.global_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_is_admin());

-- Update restricted to existing Admin
DROP POLICY IF EXISTS "Admins can update global settings" ON public.global_settings;
CREATE POLICY "Admins can update global settings"
  ON public.global_settings
  FOR UPDATE
  TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

-- Delete restricted to existing Admin
DROP POLICY IF EXISTS "Admins can delete global settings" ON public.global_settings;
CREATE POLICY "Admins can delete global settings"
  ON public.global_settings
  FOR DELETE
  TO authenticated
  USING (public.current_user_is_admin());

-- 4. Seed the single global configuration row with default values
INSERT INTO public.global_settings (id, company_header, report_metadata)
VALUES (
  'global',
  '{
    "companyName": "myRet",
    "address": "",
    "phone": "",
    "email": "",
    "website": "",
    "subtitle": "Your Site Expenditure, Digitized. | Official Audit Record",
    "logoDataUrl": "",
    "updatedAt": "1970-01-01T00:00:00.000Z"
  }'::jsonb,
  '{
    "fields": [
      { "id": "retirement", "label": "RETIREMENT", "enabled": true },
      { "id": "project_site", "label": "PROJECT / SITE", "enabled": true },
      { "id": "period", "label": "PERIOD", "enabled": true },
      { "id": "site_engineer_owner", "label": "SITE ENGINEER / OWNER", "enabled": true },
      { "id": "designation", "label": "DESIGNATION", "enabled": true },
      { "id": "date_generated", "label": "DATE GENERATED", "enabled": true }
    ],
    "updatedAt": "1970-01-01T00:00:00.000Z"
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
