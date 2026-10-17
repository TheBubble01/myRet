-- ============================================================================
-- myRet: Targeted Corrective Migration — Fix Permanent-Deletion Resurrection
-- Migration: 20261017000100_fix_permanent_deletion_resurrection.sql
-- Purpose:
--   1. Durable cloud tombstone table (public.deleted_retirements) + triggers
--      preventing stale devices from resurrecting permanently deleted retirements.
--   2. Preserve owner RLS access to child records of 'in_trash' retirements
--      during the 48-hour recovery window while keeping reviewers restricted
--      strictly to 'active' retirements.
-- ============================================================================

-- 1. Durable Tombstone Table for Permanently Deleted Retirements
CREATE TABLE IF NOT EXISTS public.deleted_retirements (
  retirement_id UUID PRIMARY KEY,
  code VARCHAR(12),
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  deleted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_retirements_owner ON public.deleted_retirements(owner_id);

ALTER TABLE public.deleted_retirements ENABLE ROW LEVEL SECURITY;

-- Remove any direct client write policies; tombstones are created exclusively by the AFTER DELETE trigger
DROP POLICY IF EXISTS "Owners can insert deleted retirement tombstones" ON public.deleted_retirements;
DROP POLICY IF EXISTS "Owners can update deleted retirement tombstones" ON public.deleted_retirements;

DROP POLICY IF EXISTS "Users can view deleted retirement tombstones" ON public.deleted_retirements;
CREATE POLICY "Users can view deleted retirement tombstones"
  ON public.deleted_retirements FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.deleted_retirements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.deleted_retirements TO authenticated;

-- 2. Triggers to Record Tombstones & Reject Resurrection by Stale Clients
CREATE OR REPLACE FUNCTION public.record_deleted_retirement_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.deleted_retirements (retirement_id, code, owner_id, deleted_at)
  VALUES (OLD.id, OLD.code, OLD.owner_id, TIMEZONE('utc'::text, NOW()))
  ON CONFLICT (retirement_id) DO UPDATE SET
    deleted_at = EXCLUDED.deleted_at;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_retirement_permanently_deleted ON public.retirements;
CREATE TRIGGER on_retirement_permanently_deleted
  AFTER DELETE ON public.retirements
  FOR EACH ROW EXECUTE FUNCTION public.record_deleted_retirement_tombstone();

CREATE OR REPLACE FUNCTION public.prevent_deleted_retirement_resurrection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deleted_retirements
    WHERE retirement_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'PERMANENTLY_DELETED: Retirement % was permanently deleted and cannot be recreated', NEW.id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_retirement_upsert_check_deleted ON public.retirements;
CREATE TRIGGER before_retirement_upsert_check_deleted
  BEFORE INSERT OR UPDATE ON public.retirements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deleted_retirement_resurrection();

-- 3. RLS Helper Functions: Preserve Owner Access to Child Records While in Trash (48h Window)
CREATE OR REPLACE FUNCTION public.current_user_has_retirement_access(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements
    WHERE id = p_ret_id
      AND (
        (owner_id = auth.uid() AND status IN ('active', 'in_trash'))
        OR (
          status = 'active'
          AND EXISTS (
            SELECT 1 FROM public.retirement_access
            WHERE retirement_id = p_ret_id AND user_id = auth.uid()
          )
        )
      )
  );
$$;

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
      AND status IN ('active', 'in_trash')
      AND owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_retirement_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_retirement_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_retirement_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_retirement_owner(UUID) TO authenticated;
