-- ============================================================================
-- myRet: Cloud Database Foundation Migration (SIMPLIFIED REVISION - UNAPPLIED)
-- Version: 20261014000300
-- Description: Practical, simplified database foundation for myRet site team (~20 concurrent users).
--              Removes unnecessary admin/tech-admin hierarchy and activity logging subsystem.
--              Focuses strictly on core domain: Profiles, Retirements, Access, Daily Records,
--              Categories, Expense Items, Supplementary Entries, and Connected Retirements.
--              Includes corrected connect_retirements RPC, robust atomic daily-record saving,
--              consistent currency calculations, and safe additive schema updates.
-- Safety: UNAPPLIED proposal artifact. Do NOT execute without human authorization.
-- ============================================================================

-- ============================================================================
-- 1. BASE TABLES DEFINITION & CONSTRAINTS (8 CORE TABLES)
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

-- Safe additive columns if retirements table was previously created from baseline schema
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS version BIGINT DEFAULT 1 NOT NULL;

-- 1.3 Retirement Access (Collaborator permissions: OWNER vs REVIEWER)
CREATE TABLE IF NOT EXISTS public.retirement_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'REVIEWER' CHECK (role IN ('OWNER', 'REVIEWER')),
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

-- Safe additive column if daily_records was previously created from baseline schema
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
-- Note: 'amount' is GENERATED ALWAYS AS (quantity * rate) STORED.
-- Insert and update operations MUST NOT explicitly assign or write to 'amount'.
CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0),
  rate NUMERIC(15, 2) NOT NULL CHECK (rate >= 0),
  amount NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED,
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

-- 1.8 Connected Retirements (Undirected, canonical ordering: retirement_id < connected_id)
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id),
  CHECK (retirement_id < connected_id)
);

-- Safe check constraint addition if connected_retirements was created without CHECK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connected_retirements_canonical_check'
  ) THEN
    -- Only add constraint if all existing rows conform (or table is empty)
    IF NOT EXISTS (SELECT 1 FROM public.connected_retirements WHERE retirement_id >= connected_id) THEN
      ALTER TABLE public.connected_retirements
        ADD CONSTRAINT connected_retirements_canonical_check CHECK (retirement_id < connected_id);
    END IF;
  END IF;
END $$;

-- Clean up any unneeded tables if they were previously created during earlier experimental runs
DROP TABLE IF EXISTS public.activity_logs CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;

-- ============================================================================
-- 2. INDEXES
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
-- 3. SECURITY DEFINER HELPER FUNCTIONS (FOCUSED & BOUND STRICTLY TO auth.uid())
-- ============================================================================

-- Helper 1: Checks if caller has active access (Primary Owner OR Granted Collaborator)
-- Explicitly excludes trashed retirements from general participant access
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

-- Helper 2: Checks if caller is Primary Owner OR Participant granted 'OWNER' role
-- Disallows edits on trashed retirements
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_editor(p_ret_id UUID)
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
          WHERE retirement_id = p_ret_id AND user_id = auth.uid() AND role = 'OWNER'
        )
      )
  );
$$;

-- Revoke default PUBLIC execution privileges and grant to authenticated
REVOKE ALL ON FUNCTION public.current_user_has_retirement_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_retirement_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_retirement_editor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_retirement_editor(UUID) TO authenticated;

-- Clean up any removed admin helper functions if previously defined
DROP FUNCTION IF EXISTS public.current_user_is_admin();
DROP FUNCTION IF EXISTS public.current_user_is_tech_admin();

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

-- ----------------------------------------------------------------------------
-- 4.1 Profiles Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by self collaborators or admins" ON public.profiles;
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

-- ----------------------------------------------------------------------------
-- 4.2 Retirements Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view retirements they own or have access to" ON public.retirements;
CREATE POLICY "Users can view retirements they own or have access to"
  ON public.retirements FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (status = 'active' AND public.current_user_has_retirement_access(id))
  );

DROP POLICY IF EXISTS "Owners can insert their retirements" ON public.retirements;
DROP POLICY IF EXISTS "Owners can insert and update their retirements" ON public.retirements;
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

-- ----------------------------------------------------------------------------
-- 4.3 Retirement Access Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view access list" ON public.retirement_access;
CREATE POLICY "Participants can view access list"
  ON public.retirement_access FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Primary owners can manage access" ON public.retirement_access;
CREATE POLICY "Primary owners can manage access"
  ON public.retirement_access FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.retirements WHERE id = retirement_access.retirement_id AND owner_id = auth.uid() AND status = 'active')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.retirements WHERE id = retirement_access.retirement_id AND owner_id = auth.uid() AND status = 'active')
  );

-- ----------------------------------------------------------------------------
-- 4.4 Daily Records Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Daily records viewable by retirement participants" ON public.daily_records;
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Daily records modifiable by owners" ON public.daily_records;
DROP POLICY IF EXISTS "Daily records modifiable by editors" ON public.daily_records;
CREATE POLICY "Daily records modifiable by editors"
  ON public.daily_records FOR ALL TO authenticated
  USING (public.current_user_is_retirement_editor(retirement_id))
  WITH CHECK (public.current_user_is_retirement_editor(retirement_id));

-- ----------------------------------------------------------------------------
-- 4.5 Categories Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Categories viewable by participants" ON public.categories;
CREATE POLICY "Categories viewable by participants"
  ON public.categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.current_user_has_retirement_access(dr.retirement_id)
    )
  );

DROP POLICY IF EXISTS "Categories modifiable by editors" ON public.categories;
CREATE POLICY "Categories modifiable by editors"
  ON public.categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.current_user_is_retirement_editor(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.current_user_is_retirement_editor(dr.retirement_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4.6 Expense Items Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Expense items viewable by participants" ON public.expense_items;
CREATE POLICY "Expense items viewable by participants"
  ON public.expense_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.current_user_has_retirement_access(dr.retirement_id)
    )
  );

DROP POLICY IF EXISTS "Expense items modifiable by editors" ON public.expense_items;
CREATE POLICY "Expense items modifiable by editors"
  ON public.expense_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.current_user_is_retirement_editor(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.current_user_is_retirement_editor(dr.retirement_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4.7 Supplementary Entries Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Supplementary viewable by participants" ON public.supplementary_entries;
CREATE POLICY "Supplementary viewable by participants"
  ON public.supplementary_entries FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Supplementary modifiable by editors" ON public.supplementary_entries;
CREATE POLICY "Supplementary modifiable by editors"
  ON public.supplementary_entries FOR ALL TO authenticated
  USING (public.current_user_is_retirement_editor(retirement_id))
  WITH CHECK (public.current_user_is_retirement_editor(retirement_id));

-- ----------------------------------------------------------------------------
-- 4.8 Connected Retirements Policies (Dual Editor Requirement)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Connected retirements viewable by participants" ON public.connected_retirements;
CREATE POLICY "Connected retirements viewable by participants"
  ON public.connected_retirements FOR SELECT TO authenticated
  USING (
    public.current_user_has_retirement_access(retirement_id)
    OR public.current_user_has_retirement_access(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements insertable by dual-authorized editors" ON public.connected_retirements;
CREATE POLICY "Connected retirements insertable by dual-authorized editors"
  ON public.connected_retirements FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_retirement_editor(retirement_id) 
    AND public.current_user_is_retirement_editor(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements deletable by either editor" ON public.connected_retirements;
CREATE POLICY "Connected retirements deletable by either editor"
  ON public.connected_retirements FOR DELETE TO authenticated
  USING (
    public.current_user_is_retirement_editor(retirement_id)
    OR public.current_user_is_retirement_editor(connected_id)
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
-- 6. RETIREMENT-CODE CLAIMING RPC (IDEMPOTENT & FOCUSED)
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
  -- Validate code format: standard retirement code (6-12 chars, alphanumeric and hyphen)
  IF length(v_clean_code) < 6 OR length(v_clean_code) > 12 OR v_clean_code ~ '[^A-Z0-9-]' THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  -- 1. Locate retirement
  SELECT id, owner_id, status INTO v_retirement_id, v_owner_id, v_status
  FROM public.retirements
  WHERE UPPER(code) = v_clean_code;

  IF v_retirement_id IS NULL OR v_status = 'in_trash' THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  -- 2. Owner claiming own code: return ID immediately
  IF v_owner_id = v_user_id THEN
    RETURN v_retirement_id;
  END IF;

  -- 3. Idempotency check: if user already has access, return ID
  SELECT EXISTS (
    SELECT 1 FROM public.retirement_access WHERE retirement_id = v_retirement_id AND user_id = v_user_id
  ) INTO v_already_access;

  IF NOT v_already_access THEN
    -- Grant REVIEWER access
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
-- 7. CORRECTED CONNECTED RETIREMENTS RPC
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

  -- Reject self-connections
  IF p_retirement_a = p_retirement_b THEN
    RAISE EXCEPTION 'Cannot connect a retirement to itself';
  END IF;

  -- Enforce canonical ordering: retirement_id < connected_id
  v_first := LEAST(p_retirement_a, p_retirement_b);
  v_second := GREATEST(p_retirement_a, p_retirement_b);

  -- Enforce dual-editor authority
  IF NOT (
    public.current_user_is_retirement_editor(v_first) 
    AND public.current_user_is_retirement_editor(v_second)
  ) THEN
    RAISE EXCEPTION 'Dual editor permission required on both retirements to establish connection';
  END IF;

  -- Insert connection record if not exists
  INSERT INTO public.connected_retirements (retirement_id, connected_id)
  VALUES (v_first, v_second)
  ON CONFLICT (retirement_id, connected_id) DO NOTHING
  RETURNING id INTO v_connection_id;

  -- If connection already existed, ON CONFLICT DO NOTHING returned NULL.
  -- Retrieve and return existing connection ID so caller always receives valid UUID.
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
-- 8. ROBUST ATOMIC DAILY RECORD UPSERT (CONCURRENCY CONTROL & FINANCIAL PRECISION)
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
  v_sort_order INT := 0;
  v_retirement_status TEXT;
BEGIN
  -- 1. Require authentication
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Verify retirement status and editor authorization
  SELECT status INTO v_retirement_status 
  FROM public.retirements 
  WHERE id = p_retirement_id;

  IF v_retirement_status IS NULL THEN
    RAISE EXCEPTION 'Retirement not found';
  END IF;

  IF v_retirement_status = 'in_trash' THEN
    RAISE EXCEPTION 'Cannot modify records on a trashed retirement';
  END IF;

  IF NOT public.current_user_is_retirement_editor(p_retirement_id) THEN
    RAISE EXCEPTION 'Unauthorized: User is not an editor of this retirement';
  END IF;

  -- 3. Validate category payload structure
  IF p_categories IS NULL OR jsonb_typeof(p_categories) <> 'array' THEN
    RAISE EXCEPTION 'Invalid payload: categories must be a JSON array';
  END IF;

  -- 4. Concurrency & Identity Check: Lock existing record if present to serialize concurrent edits
  SELECT id, version INTO v_existing_id, v_current_version
  FROM public.daily_records
  WHERE retirement_id = p_retirement_id AND record_date = p_record_date
  FOR UPDATE;

  -- If record exists and client provided an expected version, check for conflict
  IF v_existing_id IS NOT NULL AND p_expected_version IS NOT NULL THEN
    IF v_current_version <> p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Record has been modified by another session (expected version %, current version %)',
        p_expected_version, v_current_version;
    END IF;
  END IF;

  -- 5. Upsert parent daily_record (enforcing exactly 1 record per retirement/date)
  -- Preserve existing ID if present; use p_record_id or gen_random_uuid() for new records
  INSERT INTO public.daily_records (id, retirement_id, record_date, daily_total, version, updated_at)
  VALUES (
    COALESCE(v_existing_id, p_record_id, gen_random_uuid()),
    p_retirement_id,
    p_record_date,
    0.00,
    1,
    NOW()
  )
  ON CONFLICT (retirement_id, record_date) DO UPDATE SET
    version = daily_records.version + 1,
    updated_at = NOW()
  RETURNING id, version INTO v_daily_record_id, v_current_version;

  -- 6. Atomically replace categories and expense items for this daily record
  DELETE FROM public.categories WHERE daily_record_id = v_daily_record_id;

  -- 7. Process categories and line items
  FOR v_cat IN SELECT * FROM jsonb_array_elements(p_categories)
  LOOP
    v_cat_name := TRIM(COALESCE(v_cat->>'name', 'General'));
    IF length(v_cat_name) = 0 THEN
      v_cat_name := 'General';
    ELSIF length(v_cat_name) > 150 THEN
      RAISE EXCEPTION 'Category name exceeds maximum allowed length of 150 characters';
    END IF;

    v_cat_subtotal := 0.00;
    v_sort_order := v_sort_order + 1;

    INSERT INTO public.categories (id, daily_record_id, name, subtotal, sort_order)
    VALUES (
      COALESCE((v_cat->>'id')::UUID, gen_random_uuid()),
      v_daily_record_id,
      v_cat_name,
      0.00,
      v_sort_order
    )
    RETURNING id INTO v_cat_id;

    -- Process items within category
    IF jsonb_typeof(v_cat->'items') = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_cat->'items')
      LOOP
        v_item_desc := TRIM(COALESCE(v_item->>'description', ''));
        IF v_item_desc <> '' THEN
          IF length(v_item_desc) > 300 THEN
            RAISE EXCEPTION 'Item description exceeds maximum allowed length of 300 characters';
          END IF;

          v_item_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
          v_item_rate := COALESCE((v_item->>'rate')::NUMERIC, 0.00);

          IF v_item_qty < 0 OR v_item_rate < 0 THEN
            RAISE EXCEPTION 'Quantity and rate must be non-negative numbers';
          END IF;

          -- Bank-grade rounding to 2 decimal places matching expense_items.amount
          v_item_amount := ROUND(v_item_qty * v_item_rate, 2);
          v_cat_subtotal := v_cat_subtotal + v_item_amount;

          -- CRITICAL: Do NOT explicitly assign generated column 'amount'!
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

    -- Update category subtotal
    UPDATE public.categories
    SET subtotal = v_cat_subtotal
    WHERE id = v_cat_id;

    v_calculated_daily_total := v_calculated_daily_total + v_cat_subtotal;
  END LOOP;

  -- 8. Update daily_records calculated total
  UPDATE public.daily_records
  SET daily_total = v_calculated_daily_total,
      updated_at = NOW()
  WHERE id = v_daily_record_id;

  -- 9. Touch parent retirement updated_at and increment version
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

-- Step 1: Revoke all privileges from PUBLIC and anon on public schema tables
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Step 2: Grant specific least-privilege permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retirement_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplementary_entries TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.connected_retirements TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
