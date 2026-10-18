-- ============================================================================
-- myRet — Incremental Migration: Allow Collaborators to Remove Their Own Imported Retirement
-- File: supabase/migrations/20261018000100_allow_collaborator_remove_imported_retirement.sql
--
-- Purpose:
--   Allows an authenticated reviewer/collaborator to remove their own imported
--   retirement from their workspace by deleting ONLY their own row in
--   public.retirement_access (WHERE user_id = auth.uid()), without modifying
--   or deleting the owner's public.retirements row or any child records.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Collaborators can remove their own access" ON public.retirement_access;
CREATE POLICY "Collaborators can remove their own access"
  ON public.retirement_access FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;
