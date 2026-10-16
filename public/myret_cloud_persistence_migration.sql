-- ============================================================================
-- myRet: Live Cloud Database Persistence & Synchronization Migration
-- Migration: 20261016000100_myret_cloud_persistence.sql
-- Purpose: Complete, minimal, non-destructive schema for myRet PWA
-- Target: Live Supabase PostgreSQL Database (~20 concurrent site engineers)
-- Non-negotiable Invariants:
--   1. Single-Editor: Only the retirement primary owner can edit retirement data.
--   2. Read-Only Reviewers: Shared collaborators are strictly read-only.
--   3. One Record Per Date: Unique (retirement_id, record_date) with atomic upsert.
--   4. Standard Half-Up Currency Rounding: Round(quantity * rate, 2).
--   5. Canonical Connected Retirements: Canonical check (retirement_id < connected_id).
--   6. Profile Auto-creation: Trigger on auth.users + backfill for existing users.
-- ============================================================================

-- ============================================================================
-- 1. BASE TABLES DEFINITION & CONSTRAINTS (8 DOMAIN TABLES)
-- ============================================================================

-- 1.1 User Profiles (linked 1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT DEFAULT 'Site Construction Engineer',
  phone TEXT,
  email TEXT NOT NULL,
  placement TEXT DEFAULT 'Site Project',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Backfill any existing users from auth.users who signed up before migration
INSERT INTO public.profiles (id, name, designation, phone, email, placement, created_at, updated_at)
SELECT 
  id,
  COALESCE(NULLIF(raw_user_meta_data->>'name', ''), SPLIT_PART(email, '@', 1), 'Site Engineer'),
  COALESCE(NULLIF(raw_user_meta_data->>'designation', ''), 'Site Construction Engineer'),
  NULLIF(raw_user_meta_data->>'phone', ''),
  email,
  COALESCE(NULLIF(raw_user_meta_data->>'placement', ''), 'Site Project'),
  created_at,
  NOW()
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 1.2 Retirements (Core site expenditure projects)
CREATE TABLE IF NOT EXISTS public.retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(12) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'in_trash')),
  deleted_at TIMESTAMPTZ,
  version BIGINT DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Safe additive columns if retirements table pre-exists
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS version BIGINT DEFAULT 1 NOT NULL;

-- 1.3 Retirement Access (Collaborator permissions: STRICTLY REVIEWER ONLY)
CREATE TABLE IF NOT EXISTS public.retirement_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'REVIEWER' NOT NULL CHECK (role = 'REVIEWER'),
  granted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, user_id)
);

-- 1.4 Daily Records (Enforces exactly 1 record per retirement per date)
CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  record_date DATE NOT NULL,
  daily_total NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  version BIGINT DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, record_date)
);

ALTER TABLE public.daily_records ADD COLUMN IF NOT EXISTS version BIGINT DEFAULT 1 NOT NULL;

-- 1.5 Expense Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_record_id UUID REFERENCES public.daily_records(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subtotal NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  sort_order INT DEFAULT 0
);

-- 1.6 Expense Items
-- Amount is GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED.
-- Insert and update operations MUST NOT explicitly assign or write to 'amount'.
CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0),
  rate NUMERIC(15, 2) NOT NULL CHECK (rate >= 0),
  amount NUMERIC(15, 2) GENERATED ALWAYS AS (ROUND(quantity * rate, 2)) STORED,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.7 Supplementary Entries (Direct site payments outside daily log)
CREATE TABLE IF NOT EXISTS public.supplementary_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.8 Connected Retirements (Canonical ordering: retirement_id < connected_id)
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id),
  CHECK (retirement_id < connected_id)
);

-- ============================================================================
-- 2. INDEXES FOR QUERY OPTIMIZATION
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_retirements_owner ON public.retirements(owner_id);
CREATE INDEX IF NOT EXISTS idx_retirements_code ON public.retirements(code);
CREATE INDEX IF NOT EXISTS idx_retirements_status ON public.retirements(status);
CREATE INDEX IF NOT EXISTS idx_retirement_access_user ON public.retirement_access(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_ret ON public.daily_records(retirement_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON public.daily_records(record_date);
CREATE INDEX IF NOT EXISTS idx_categories_record ON public.categories(daily_record_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_cat ON public.expense_items(category_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_ret ON public.supplementary_entries(retirement_id);
CREATE INDEX IF NOT EXISTS idx_connected_ret_conn ON public.connected_retirements(connected_id);

-- ============================================================================
-- 3. SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================================

-- Helper 1: Checks if caller has active access (Owner OR Granted Reviewer)
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
      AND status = 'active'
      AND (
        owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.retirement_access
          WHERE retirement_id = p_ret_id AND user_id = auth.uid()
        )
      )
  );
$$;

-- Helper 2: Confirmed Single-Editor Check (ONLY the primary owner)
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

REVOKE ALL ON FUNCTION public.current_user_has_retirement_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_retirement_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_retirement_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_retirement_owner(UUID) TO authenticated;

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirement_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplementary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_retirements ENABLE ROW LEVEL SECURITY;

-- 4.1 Profiles Policies
DROP POLICY IF EXISTS "Profiles viewable by self and collaborators" ON public.profiles;
CREATE POLICY "Profiles viewable by self and collaborators"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.retirement_access ra_self
      JOIN public.retirement_access ra_other ON ra_self.retirement_id = ra_other.retirement_id
      JOIN public.retirements r ON r.id = ra_self.retirement_id
      WHERE ra_self.user_id = auth.uid()
        AND ra_other.user_id = profiles.id
        AND r.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.retirements r
      WHERE r.status = 'active'
        AND (
          (r.owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.retirement_access WHERE retirement_id = r.id AND user_id = profiles.id))
          OR (r.owner_id = profiles.id AND public.current_user_has_retirement_access(r.id))
        )
    )
  );

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4.2 Retirements Policies (Single-Editor: Owner only modifies)
DROP POLICY IF EXISTS "Users can view retirements they own or have access to" ON public.retirements;
CREATE POLICY "Users can view retirements they own or have access to"
  ON public.retirements FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (status = 'active' AND public.current_user_has_retirement_access(id))
  );

DROP POLICY IF EXISTS "Owners can insert their retirements" ON public.retirements;
CREATE POLICY "Owners can insert their retirements"
  ON public.retirements FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can update their retirements" ON public.retirements;
CREATE POLICY "Owners can update their retirements"
  ON public.retirements FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can delete their retirements" ON public.retirements;
CREATE POLICY "Owners can delete their retirements"
  ON public.retirements FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 4.3 Retirement Access Policies (Owner manages sharing; Reviewers view)
DROP POLICY IF EXISTS "Participants can view access list" ON public.retirement_access;
CREATE POLICY "Participants can view access list"
  ON public.retirement_access FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Primary owners can manage access" ON public.retirement_access;
CREATE POLICY "Primary owners can manage access"
  ON public.retirement_access FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- 4.4 Daily Records Policies (Owner modifies; Participants view)
DROP POLICY IF EXISTS "Daily records viewable by retirement participants" ON public.daily_records;
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Daily records modifiable by primary owner" ON public.daily_records;
CREATE POLICY "Daily records modifiable by primary owner"
  ON public.daily_records FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- 4.5 Categories Policies
DROP POLICY IF EXISTS "Categories viewable by retirement participants" ON public.categories;
CREATE POLICY "Categories viewable by retirement participants"
  ON public.categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id
        AND public.current_user_has_retirement_access(dr.retirement_id)
    )
  );

DROP POLICY IF EXISTS "Categories modifiable by primary owner" ON public.categories;
CREATE POLICY "Categories modifiable by primary owner"
  ON public.categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id
        AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id
        AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  );

-- 4.6 Expense Items Policies
DROP POLICY IF EXISTS "Expense items viewable by retirement participants" ON public.expense_items;
CREATE POLICY "Expense items viewable by retirement participants"
  ON public.expense_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id
        AND public.current_user_has_retirement_access(dr.retirement_id)
    )
  );

DROP POLICY IF EXISTS "Expense items modifiable by primary owner" ON public.expense_items;
CREATE POLICY "Expense items modifiable by primary owner"
  ON public.expense_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id
        AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id
        AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  );

-- 4.7 Supplementary Entries Policies
DROP POLICY IF EXISTS "Supplementary viewable by retirement participants" ON public.supplementary_entries;
CREATE POLICY "Supplementary viewable by retirement participants"
  ON public.supplementary_entries FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Supplementary modifiable by primary owner" ON public.supplementary_entries;
CREATE POLICY "Supplementary modifiable by primary owner"
  ON public.supplementary_entries FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- 4.8 Connected Retirements Policies
DROP POLICY IF EXISTS "Connected retirements viewable by participants" ON public.connected_retirements;
CREATE POLICY "Connected retirements viewable by participants"
  ON public.connected_retirements FOR SELECT TO authenticated
  USING (
    public.current_user_has_retirement_access(retirement_id)
    OR public.current_user_has_retirement_access(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements insertable by owners" ON public.connected_retirements;
CREATE POLICY "Connected retirements insertable by owners"
  ON public.connected_retirements FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_retirement_owner(retirement_id) 
    AND public.current_user_is_retirement_owner(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements deletable by either owner" ON public.connected_retirements;
CREATE POLICY "Connected retirements deletable by either owner"
  ON public.connected_retirements FOR DELETE TO authenticated
  USING (
    public.current_user_is_retirement_owner(retirement_id)
    OR public.current_user_is_retirement_owner(connected_id)
  );

-- ============================================================================
-- 5. AUTOMATED PROFILE CREATION TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, designation, phone, email, placement, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), SPLIT_PART(NEW.email, '@', 1), 'Site Engineer'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'designation', ''), 'Site Construction Engineer'),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'placement', ''), 'Site Project'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 6. RETIREMENT-CODE CLAIMING RPC (STRICTLY REVIEWER ACCESS)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_retirement_by_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_retirement_id UUID;
  v_owner_id UUID;
  v_status TEXT;
  v_already_access BOOLEAN;
  v_clean_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_clean_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF length(v_clean_code) < 6 OR length(v_clean_code) > 12 OR v_clean_code ~ '[^A-Z0-9-]' THEN
    RAISE EXCEPTION 'Invalid retirement code format';
  END IF;

  SELECT id, owner_id, status INTO v_retirement_id, v_owner_id, v_status
  FROM public.retirements
  WHERE UPPER(code) = v_clean_code;

  IF v_retirement_id IS NULL OR v_status = 'in_trash' THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  -- Owner claiming own code returns immediately
  IF v_owner_id = v_user_id THEN
    RETURN v_retirement_id;
  END IF;

  -- Idempotent reviewer grant
  SELECT EXISTS (
    SELECT 1 FROM public.retirement_access WHERE retirement_id = v_retirement_id AND user_id = v_user_id
  ) INTO v_already_access;

  IF NOT v_already_access THEN
    INSERT INTO public.retirement_access (retirement_id, user_id, role, granted_at)
    VALUES (v_retirement_id, v_user_id, 'REVIEWER', NOW())
    ON CONFLICT (retirement_id, user_id) DO NOTHING;
  END IF;

  RETURN v_retirement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_retirement_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_retirement_by_code(TEXT) TO authenticated;

-- ============================================================================
-- 7. CONNECTED RETIREMENTS RPC (CANONICAL ORDERING)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.connect_retirements(
  p_retirement_a UUID,
  p_retirement_b UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_first UUID;
  v_second UUID;
  v_connection_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_retirement_a IS NULL OR p_retirement_b IS NULL THEN
    RAISE EXCEPTION 'Both retirement IDs are required';
  END IF;

  IF p_retirement_a = p_retirement_b THEN
    RAISE EXCEPTION 'Cannot connect a retirement to itself';
  END IF;

  -- Enforce canonical ordering: retirement_id < connected_id
  v_first := LEAST(p_retirement_a, p_retirement_b);
  v_second := GREATEST(p_retirement_a, p_retirement_b);

  IF NOT (
    public.current_user_is_retirement_owner(v_first) 
    AND public.current_user_is_retirement_owner(v_second)
  ) THEN
    RAISE EXCEPTION 'Owner permission required on both retirements to establish connection';
  END IF;

  INSERT INTO public.connected_retirements (retirement_id, connected_id)
  VALUES (v_first, v_second)
  ON CONFLICT (retirement_id, connected_id) DO NOTHING
  RETURNING id INTO v_connection_id;

  IF v_connection_id IS NULL THEN
    SELECT id INTO v_connection_id
    FROM public.connected_retirements
    WHERE retirement_id = v_first AND connected_id = v_second;
  END IF;

  RETURN v_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.connect_retirements(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_retirements(UUID, UUID) TO authenticated;

-- ============================================================================
-- 8. ATOMIC DAILY RECORD UPSERT (TRANSACTION ADVISORY LOCKING & CONCURRENCY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_daily_record_hierarchy(
  p_record_id UUID,
  p_retirement_id UUID,
  p_record_date DATE,
  p_categories JSONB,
  p_expected_version BIGINT DEFAULT NULL,
  p_client_updated_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_daily_record_id UUID;
  v_existing_id UUID;
  v_current_version BIGINT := 1;
  v_calculated_daily_total NUMERIC(15, 2) := 0.00;
  v_cat JSONB;
  v_item JSONB;
  v_cat_id UUID;
  v_cat_name TEXT;
  v_cat_subtotal NUMERIC(15, 2);
  v_item_qty NUMERIC(12, 2);
  v_item_rate NUMERIC(15, 2);
  v_item_amount NUMERIC(15, 2);
  v_item_desc TEXT;
  v_sort_idx INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_retirement_id IS NULL OR p_record_date IS NULL THEN
    RAISE EXCEPTION 'Retirement ID and record date are required';
  END IF;

  -- Advisory lock scoped to retirement to prevent concurrent modification races
  PERFORM pg_advisory_xact_lock(hashtext(p_retirement_id::TEXT));

  IF NOT public.current_user_is_retirement_owner(p_retirement_id) THEN
    RAISE EXCEPTION 'Only the retirement owner can modify daily records';
  END IF;

  -- Locate existing record by unique calendar date
  SELECT id, version INTO v_existing_id, v_current_version
  FROM public.daily_records
  WHERE retirement_id = p_retirement_id AND record_date = p_record_date;

  IF v_existing_id IS NOT NULL THEN
    v_daily_record_id := v_existing_id;
    v_current_version := v_current_version + 1;

    -- Concurrency version validation if caller provides expected version
    IF p_expected_version IS NOT NULL AND p_expected_version <> (v_current_version - 1) THEN
      RAISE EXCEPTION 'Concurrency conflict: record modified by another session (expected %, current %)',
        p_expected_version, (v_current_version - 1);
    END IF;

    UPDATE public.daily_records
    SET version = v_current_version,
        updated_at = NOW()
    WHERE id = v_daily_record_id;
  ELSE
    v_daily_record_id := COALESCE(p_record_id, gen_random_uuid());
    INSERT INTO public.daily_records (id, retirement_id, record_date, daily_total, version, created_at, updated_at)
    VALUES (v_daily_record_id, p_retirement_id, p_record_date, 0.00, 1, NOW(), NOW());
  END IF;

  -- Clean replacement of child categories & items inside this atomic transaction
  DELETE FROM public.categories WHERE daily_record_id = v_daily_record_id;

  IF p_categories IS NOT NULL AND jsonb_typeof(p_categories) = 'array' THEN
    FOR v_cat IN SELECT * FROM jsonb_array_elements(p_categories)
    LOOP
      v_sort_idx := v_sort_idx + 1;
      v_cat_id := COALESCE((v_cat->>'id')::UUID, gen_random_uuid());
      v_cat_name := TRIM(COALESCE(v_cat->>'name', 'General'));
      IF v_cat_name = '' THEN v_cat_name := 'General'; END IF;
      v_cat_subtotal := 0.00;

      INSERT INTO public.categories (id, daily_record_id, name, subtotal, sort_order)
      VALUES (v_cat_id, v_daily_record_id, v_cat_name, 0.00, v_sort_idx);

      IF (v_cat->'items') IS NOT NULL AND jsonb_typeof(v_cat->'items') = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_cat->'items')
        LOOP
          v_item_desc := TRIM(COALESCE(v_item->>'description', ''));
          IF v_item_desc <> '' THEN
            v_item_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
            v_item_rate := COALESCE((v_item->>'rate')::NUMERIC, 0.00);

            IF v_item_qty < 0 OR v_item_rate < 0 THEN
              RAISE EXCEPTION 'Quantity and rate must be non-negative';
            END IF;

            v_item_amount := ROUND(v_item_qty * v_item_rate, 2);
            v_cat_subtotal := v_cat_subtotal + v_item_amount;

            -- Omit generated column 'amount'
            INSERT INTO public.expense_items (id, category_id, description, quantity, rate, created_at)
            VALUES (
              COALESCE((v_item->>'id')::UUID, gen_random_uuid()),
              v_cat_id,
              v_item_desc,
              v_item_qty,
              v_item_rate,
              NOW()
            );
          END IF;
        END LOOP;
      END IF;

      UPDATE public.categories SET subtotal = v_cat_subtotal WHERE id = v_cat_id;
      v_calculated_daily_total := v_calculated_daily_total + v_cat_subtotal;
    END LOOP;
  END IF;

  UPDATE public.daily_records
  SET daily_total = v_calculated_daily_total,
      updated_at = NOW()
  WHERE id = v_daily_record_id;

  UPDATE public.retirements
  SET updated_at = NOW(),
      version = version + 1
  WHERE id = p_retirement_id;

  RETURN jsonb_build_object(
    'success', true,
    'daily_record_id', v_daily_record_id,
    'record_date', p_record_date,
    'daily_total', v_calculated_daily_total,
    'version', v_current_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_daily_record_hierarchy(UUID, UUID, DATE, JSONB, BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_daily_record_hierarchy(UUID, UUID, DATE, JSONB, BIGINT, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 9. LEAST-PRIVILEGE TABLE & ROUTINE GRANTS
-- ============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirement_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplementary_entries TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.connected_retirements TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
