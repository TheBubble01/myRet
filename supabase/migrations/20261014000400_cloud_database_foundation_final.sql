-- ============================================================================
-- myRet: Cloud Database Foundation Migration (FINAL REVIEW CANDIDATE - UNAPPLIED)
-- Version: 20261014000400
-- Description: Rigorous, single-editor, read-only reviewer cloud database foundation
--              tailored specifically for the myRet PWA (~20 concurrent site team members).
--              Enforces confirmed domain invariants:
--              1. Single-Editor: Only the retirement primary owner can edit retirement data.
--              2. Read-Only Reviewers: Shared collaborators are strictly read-only.
--              3. Atomic Advisory-Locked UPSERT: Eliminates first-save race conditions.
--              4. Explicit Currency Rounding: Standard half-up 2-decimal precision.
--              5. Data Preservation: Safe migration without destructive drops of business data.
-- Safety: UNAPPLIED proposal artifact. Do NOT execute without human authorization.
-- ============================================================================

-- ============================================================================
-- 1. BASE TABLES DEFINITION & CONSTRAINTS (8 CORE DOMAIN TABLES)
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

-- Safe additive columns if retirements table pre-exists from baseline schema
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.retirements ADD COLUMN IF NOT EXISTS version BIGINT DEFAULT 1 NOT NULL;

-- 1.3 Retirement Access (Collaborator permissions: STRICTLY REVIEWER ONLY)
-- Enforces Confirmed Rule D: Collaborators can NEVER be granted editor/owner status.
CREATE TABLE IF NOT EXISTS public.retirement_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'REVIEWER' NOT NULL CHECK (role = 'REVIEWER'),
  granted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, user_id)
);

-- Safe constraint alignment if retirement_access pre-exists with old check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retirement_access_role_check'
  ) THEN
    -- Update any legacy rows if necessary before tightening constraint
    UPDATE public.retirement_access SET role = 'REVIEWER' WHERE role <> 'REVIEWER';
    ALTER TABLE public.retirement_access DROP CONSTRAINT retirement_access_role_check;
    ALTER TABLE public.retirement_access ADD CONSTRAINT retirement_access_role_check CHECK (role = 'REVIEWER');
  END IF;
END $$;

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

-- Safe additive column if daily_records pre-exists from baseline schema
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

-- 1.8 Connected Retirements (Undirected, canonical ordering: retirement_id < connected_id)
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id),
  CHECK (retirement_id < connected_id)
);

-- Safe normalization sequence for pre-existing connected_retirements data:
-- Prevents silently skipping the canonical constraint if inverted rows exist.
DO $$
BEGIN
  -- Step 1: Normalize any existing non-canonical pairs (A, B) where A > B
  UPDATE public.connected_retirements cr1
  SET retirement_id = cr1.connected_id, connected_id = cr1.retirement_id
  WHERE cr1.retirement_id > cr1.connected_id
    AND NOT EXISTS (
      SELECT 1 FROM public.connected_retirements cr2
      WHERE cr2.retirement_id = cr1.connected_id
        AND cr2.connected_id = cr1.retirement_id
    );

  -- Step 2: Remove exact reciprocal duplicates if both (A, B) and (B, A) were inserted
  DELETE FROM public.connected_retirements
  WHERE retirement_id > connected_id;

  -- Step 3: Remove invalid self-connections (A = A)
  DELETE FROM public.connected_retirements
  WHERE retirement_id = connected_id;

  -- Step 4: Enforce canonical constraint safely
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connected_retirements_canonical_check'
  ) THEN
    ALTER TABLE public.connected_retirements
      ADD CONSTRAINT connected_retirements_canonical_check CHECK (retirement_id < connected_id);
  END IF;
END $$;

-- Deprecated subsystem cleanup: remove obsolete structures without impacting business data
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
-- 3. SECURITY DEFINER HELPER FUNCTIONS (STRICT SINGLE-EDITOR & REVIEWER RULES)
-- ============================================================================

-- Helper 1: Checks if caller has active access (Primary Owner OR Granted Reviewer)
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

-- Helper 2: Confirmed Single-Editor Check (ONLY the actual retirement primary owner)
-- Enforces Rule D: Collaborators can NEVER edit someone else's retirement.
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

-- Backward compatibility alias: matches current_user_is_retirement_owner strictly
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_editor(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_is_retirement_owner(p_ret_id);
$$;

-- Revoke default PUBLIC execution privileges and grant strictly to authenticated
REVOKE ALL ON FUNCTION public.current_user_has_retirement_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_retirement_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_retirement_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_retirement_owner(UUID) TO authenticated;

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
-- 4.2 Retirements Policies (Single-Editor: Owner only for all mutations)
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
-- 4.3 Retirement Access Policies (Owner manages sharing; Reviewers only view)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view access list" ON public.retirement_access;
CREATE POLICY "Participants can view access list"
  ON public.retirement_access FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Primary owners can manage access" ON public.retirement_access;
CREATE POLICY "Primary owners can manage access"
  ON public.retirement_access FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- ----------------------------------------------------------------------------
-- 4.4 Daily Records Policies (Single-Editor: Owner only modifies)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Daily records viewable by retirement participants" ON public.daily_records;
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Daily records modifiable by owners" ON public.daily_records;
DROP POLICY IF EXISTS "Daily records modifiable by editors" ON public.daily_records;
CREATE POLICY "Daily records modifiable by owners"
  ON public.daily_records FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- ----------------------------------------------------------------------------
-- 4.5 Categories Policies (Single-Editor: Owner only modifies)
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
DROP POLICY IF EXISTS "Categories modifiable by owners" ON public.categories;
CREATE POLICY "Categories modifiable by owners"
  ON public.categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4.6 Expense Items Policies (Single-Editor: Owner only modifies)
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
DROP POLICY IF EXISTS "Expense items modifiable by owners" ON public.expense_items;
CREATE POLICY "Expense items modifiable by owners"
  ON public.expense_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.current_user_is_retirement_owner(dr.retirement_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4.7 Supplementary Entries Policies (Single-Editor: Owner only modifies)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Supplementary viewable by participants" ON public.supplementary_entries;
CREATE POLICY "Supplementary viewable by participants"
  ON public.supplementary_entries FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id));

DROP POLICY IF EXISTS "Supplementary modifiable by editors" ON public.supplementary_entries;
DROP POLICY IF EXISTS "Supplementary modifiable by owners" ON public.supplementary_entries;
CREATE POLICY "Supplementary modifiable by owners"
  ON public.supplementary_entries FOR ALL TO authenticated
  USING (public.current_user_is_retirement_owner(retirement_id))
  WITH CHECK (public.current_user_is_retirement_owner(retirement_id));

-- ----------------------------------------------------------------------------
-- 4.8 Connected Retirements Policies (Single-Editor: Both owners insert; either deletes)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Connected retirements viewable by participants" ON public.connected_retirements;
CREATE POLICY "Connected retirements viewable by participants"
  ON public.connected_retirements FOR SELECT TO authenticated
  USING (
    public.current_user_has_retirement_access(retirement_id)
    OR public.current_user_has_retirement_access(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements insertable by dual-authorized editors" ON public.connected_retirements;
DROP POLICY IF EXISTS "Connected retirements insertable by owners" ON public.connected_retirements;
CREATE POLICY "Connected retirements insertable by owners"
  ON public.connected_retirements FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_retirement_owner(retirement_id) 
    AND public.current_user_is_retirement_owner(connected_id)
  );

DROP POLICY IF EXISTS "Connected retirements deletable by either editor" ON public.connected_retirements;
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
-- 6. RETIREMENT-CODE CLAIMING RPC (STRICTLY GRANTS REVIEWER ACCESS ONLY)
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

  -- 2. Owner claiming own code: return ID immediately (already primary owner)
  IF v_owner_id = v_user_id THEN
    RETURN v_retirement_id;
  END IF;

  -- 3. Idempotency check: if user already has access, return ID
  SELECT EXISTS (
    SELECT 1 FROM public.retirement_access WHERE retirement_id = v_retirement_id AND user_id = v_user_id
  ) INTO v_already_access;

  IF NOT v_already_access THEN
    -- Confirmed Rule C: Importing user is strictly granted REVIEWER access only
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
-- 7. CONNECTED RETIREMENTS RPC (SAFE ID RETRIEVAL & CANONICAL ORDERING)
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

  -- Confirmed Single-Editor Rule: Caller must be the primary OWNER of BOTH projects
  IF NOT (
    public.current_user_is_retirement_owner(v_first) 
    AND public.current_user_is_retirement_owner(v_second)
  ) THEN
    RAISE EXCEPTION 'Owner permission required on both retirements to establish connection';
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
-- 8. ROBUST ATOMIC DAILY RECORD UPSERT (TRANSACTION ADVISORY LOCKING & CONCURRENCY)
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

  -- 2. Transaction-level advisory lock serializes simultaneous first-saves and concurrent updates
  -- Prevents competing simultaneous requests from racing before a parent record exists.
  PERFORM pg_advisory_xact_lock(hashtext(p_retirement_id::text || ':' || p_record_date::text));

  -- 3. Verify retirement status and single-editor authorization (owner only)
  SELECT status INTO v_retirement_status 
  FROM public.retirements 
  WHERE id = p_retirement_id;

  IF v_retirement_status IS NULL THEN
    RAISE EXCEPTION 'Retirement not found';
  END IF;

  IF v_retirement_status = 'in_trash' THEN
    RAISE EXCEPTION 'Cannot modify records on a trashed retirement';
  END IF;

  -- Confirmed Rule D: Only the primary owner can save records
  IF NOT public.current_user_is_retirement_owner(p_retirement_id) THEN
    RAISE EXCEPTION 'Unauthorized: User is not the owner of this retirement';
  END IF;

  -- 4. Validate category payload structure
  IF p_categories IS NULL OR jsonb_typeof(p_categories) <> 'array' THEN
    RAISE EXCEPTION 'Invalid payload: categories must be a JSON array';
  END IF;

  -- 5. Concurrency & Identity Check: Lock existing record if present
  SELECT id, version INTO v_existing_id, v_current_version
  FROM public.daily_records
  WHERE retirement_id = p_retirement_id AND record_date = p_record_date
  FOR UPDATE;

  -- If record exists and client provided an expected version, enforce OCC
  IF v_existing_id IS NOT NULL AND p_expected_version IS NOT NULL THEN
    IF v_current_version <> p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Record has been modified by another session (expected version %, current version %)',
        p_expected_version, v_current_version;
    END IF;
  END IF;

  -- 6. Upsert parent daily_record (enforcing exactly 1 record per retirement/date)
  -- Preserves existing stable ID if present; uses p_record_id or gen_random_uuid() for new records
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

  -- 7. Atomically replace categories and expense items for this daily record
  -- Executed within caller transaction: any exception rolls back deletion and recreation completely!
  DELETE FROM public.categories WHERE daily_record_id = v_daily_record_id;

  -- 8. Process categories and line items with strict bounds and half-up rounding
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

          -- Standard half-up currency rounding to 2 decimal places matching expense_items.amount
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

  -- 9. Update daily_records calculated total
  UPDATE public.daily_records
  SET daily_total = v_calculated_daily_total,
      updated_at = NOW()
  WHERE id = v_daily_record_id;

  -- 10. Touch parent retirement updated_at and increment version
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
