-- ============================================================================
-- myRet: Cloud Database Foundation Migration (REVISED REVIEW CANDIDATE - UNAPPLIED)
-- Version: 20261014000100
-- Description: Targeted security, privacy, and correctness revision for myRet.
-- Safety: Unapplied candidate migration. Do not execute without explicit approval.
-- ============================================================================

-- ============================================================================
-- 1. BASE TABLES DEFINITION (ADDITIVE & IDEMPOTENT)
-- ============================================================================

-- 1.1 Profiles Table
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

-- 1.2 User Roles Table (Dedicated server-controlled RBAC)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'tech-admin', 'auditor')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, role)
);

-- 1.3 Retirements Table
CREATE TABLE IF NOT EXISTS public.retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(12) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'in_trash')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.4 Retirement Access (Sharing & Delegated Roles)
CREATE TABLE IF NOT EXISTS public.retirement_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'REVIEWER' CHECK (role IN ('OWNER', 'REVIEWER')),
  granted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, user_id)
);

-- 1.5 Daily Records Table (Consolidated 1 record per retirement/date)
CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  record_date DATE NOT NULL,
  daily_total NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, record_date)
);

-- 1.6 Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_record_id UUID REFERENCES public.daily_records(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subtotal NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  sort_order INT DEFAULT 0
);

-- 1.7 Expense Items Table
-- Note: 'amount' is GENERATED ALWAYS AS (quantity * rate) STORED.
-- Insert and update queries MUST NEVER pass or assign 'amount'.
CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0),
  rate NUMERIC(15, 2) NOT NULL CHECK (rate >= 0),
  amount NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.8 Supplementary Entries Table
CREATE TABLE IF NOT EXISTS public.supplementary_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 1.9 Connected Retirements Relationship
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id),
  CHECK (retirement_id <> connected_id)
);

-- 1.10 Activity History / Audit Logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================================
-- 2. PERFORMANCE INDEXES
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
CREATE INDEX IF NOT EXISTS idx_activity_logs_ret ON public.activity_logs(retirement_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);

-- ============================================================================
-- 3. SECURITY DEFINER HELPER FUNCTIONS (STRICT BOUNDARIES & ZERO ARBITRARY USER IDS)
-- ============================================================================

-- Binds strictly to auth.uid() - no caller-supplied user parameter
CREATE OR REPLACE FUNCTION public.current_user_has_retirement_access(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements WHERE id = p_ret_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.retirement_access WHERE retirement_id = p_ret_id AND user_id = auth.uid()
  );
$$;

-- Binds strictly to auth.uid() - evaluates if user is Primary Owner OR Participant OWNER
CREATE OR REPLACE FUNCTION public.current_user_is_retirement_editor(p_ret_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements WHERE id = p_ret_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.retirement_access WHERE retirement_id = p_ret_id AND user_id = auth.uid() AND role = 'OWNER'
  );
$$;

-- Binds strictly to auth.uid() - checks system administrator status
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'tech-admin')
  );
$$;

-- Revoke default public execution privileges on security definers
REVOKE ALL ON FUNCTION public.current_user_has_retirement_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_retirement_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_retirement_editor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_retirement_editor(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirement_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplementary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4.1 Profiles Policies (Least-Privilege: Self + Collaborators + Admins ONLY)
-- ----------------------------------------------------------------------------
-- Eliminate broad USING (true) policy.
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by self collaborators or admins" ON public.profiles;
CREATE POLICY "Profiles viewable by self collaborators or admins"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    -- 1. Self profile
    id = auth.uid()
    -- 2. System administrators
    OR public.current_user_is_admin()
    -- 3. Shared collaborators (users sharing at least one active retirement)
    OR EXISTS (
      SELECT 1 FROM public.retirement_access ra_self
      JOIN public.retirement_access ra_other ON ra_self.retirement_id = ra_other.retirement_id
      WHERE ra_self.user_id = auth.uid() AND ra_other.user_id = profiles.id
    )
    -- 4. Retirement owner looking at participant or participant looking at primary owner
    OR EXISTS (
      SELECT 1 FROM public.retirements r
      WHERE (r.owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.retirement_access WHERE retirement_id = r.id AND user_id = profiles.id))
         OR (r.owner_id = profiles.id AND public.current_user_has_retirement_access(r.id))
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
-- 4.2 User Roles Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_is_admin());

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

-- ----------------------------------------------------------------------------
-- 4.3 Retirements Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view retirements they own or have access to" ON public.retirements;
CREATE POLICY "Users can view retirements they own or have access to"
  ON public.retirements FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(id) OR public.current_user_is_admin());

DROP POLICY IF EXISTS "Owners can insert and update their retirements" ON public.retirements;
DROP POLICY IF EXISTS "Owners can insert their retirements" ON public.retirements;
CREATE POLICY "Owners can insert their retirements"
  ON public.retirements FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can update their retirements" ON public.retirements;
CREATE POLICY "Owners can update their retirements"
  ON public.retirements FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.current_user_is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.current_user_is_admin());

DROP POLICY IF EXISTS "Owners can delete their retirements" ON public.retirements;
CREATE POLICY "Owners can delete their retirements"
  ON public.retirements FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.current_user_is_admin());

-- ----------------------------------------------------------------------------
-- 4.4 Retirement Access Policies (Primary Owner Restricted)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view access list" ON public.retirement_access;
CREATE POLICY "Participants can view access list"
  ON public.retirement_access FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id) OR public.current_user_is_admin());

-- Only the PRIMARY retirement owner can grant, modify, or revoke collaborator roles
DROP POLICY IF EXISTS "Primary owners can manage access" ON public.retirement_access;
CREATE POLICY "Primary owners can manage access"
  ON public.retirement_access FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.retirements WHERE id = retirement_access.retirement_id AND owner_id = auth.uid())
    OR public.current_user_is_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.retirements WHERE id = retirement_access.retirement_id AND owner_id = auth.uid())
    OR public.current_user_is_admin()
  );

-- ----------------------------------------------------------------------------
-- 4.5 Daily Records Policies (Primary Owner + Participant OWNER)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Daily records viewable by retirement participants" ON public.daily_records;
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id) OR public.current_user_is_admin());

DROP POLICY IF EXISTS "Daily records modifiable by owners" ON public.daily_records;
DROP POLICY IF EXISTS "Daily records modifiable by editors" ON public.daily_records;
CREATE POLICY "Daily records modifiable by editors"
  ON public.daily_records FOR ALL TO authenticated
  USING (public.current_user_is_retirement_editor(retirement_id) OR public.current_user_is_admin())
  WITH CHECK (public.current_user_is_retirement_editor(retirement_id) OR public.current_user_is_admin());

-- ----------------------------------------------------------------------------
-- 4.6 Categories Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Categories viewable by participants" ON public.categories;
CREATE POLICY "Categories viewable by participants"
  ON public.categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND (public.current_user_has_retirement_access(dr.retirement_id) OR public.current_user_is_admin())
    )
  );

DROP POLICY IF EXISTS "Categories modifiable by editors" ON public.categories;
CREATE POLICY "Categories modifiable by editors"
  ON public.categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND (public.current_user_is_retirement_editor(dr.retirement_id) OR public.current_user_is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND (public.current_user_is_retirement_editor(dr.retirement_id) OR public.current_user_is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 4.7 Expense Items Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Expense items viewable by participants" ON public.expense_items;
CREATE POLICY "Expense items viewable by participants"
  ON public.expense_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND (public.current_user_has_retirement_access(dr.retirement_id) OR public.current_user_is_admin())
    )
  );

DROP POLICY IF EXISTS "Expense items modifiable by editors" ON public.expense_items;
CREATE POLICY "Expense items modifiable by editors"
  ON public.expense_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND (public.current_user_is_retirement_editor(dr.retirement_id) OR public.current_user_is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND (public.current_user_is_retirement_editor(dr.retirement_id) OR public.current_user_is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 4.8 Supplementary Entries Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Supplementary viewable by participants" ON public.supplementary_entries;
CREATE POLICY "Supplementary viewable by participants"
  ON public.supplementary_entries FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id) OR public.current_user_is_admin());

DROP POLICY IF EXISTS "Supplementary modifiable by editors" ON public.supplementary_entries;
CREATE POLICY "Supplementary modifiable by editors"
  ON public.supplementary_entries FOR ALL TO authenticated
  USING (public.current_user_is_retirement_editor(retirement_id) OR public.current_user_is_admin())
  WITH CHECK (public.current_user_is_retirement_editor(retirement_id) OR public.current_user_is_admin());

-- ----------------------------------------------------------------------------
-- 4.9 Connected Retirements Policies (Bidirectional Verification on Insert)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Connected retirements viewable by participants" ON public.connected_retirements;
CREATE POLICY "Connected retirements viewable by participants"
  ON public.connected_retirements FOR SELECT TO authenticated
  USING (
    public.current_user_has_retirement_access(retirement_id)
    OR public.current_user_has_retirement_access(connected_id)
    OR public.current_user_is_admin()
  );

DROP POLICY IF EXISTS "Connected retirements insertable by dual-authorized editors" ON public.connected_retirements;
CREATE POLICY "Connected retirements insertable by dual-authorized editors"
  ON public.connected_retirements FOR INSERT TO authenticated
  WITH CHECK (
    (public.current_user_is_retirement_editor(retirement_id) AND public.current_user_has_retirement_access(connected_id))
    OR public.current_user_is_admin()
  );

DROP POLICY IF EXISTS "Connected retirements deletable by either editor" ON public.connected_retirements;
CREATE POLICY "Connected retirements deletable by either editor"
  ON public.connected_retirements FOR DELETE TO authenticated
  USING (
    public.current_user_is_retirement_editor(retirement_id)
    OR public.current_user_is_retirement_editor(connected_id)
    OR public.current_user_is_admin()
  );

-- ----------------------------------------------------------------------------
-- 4.10 Activity Logs Policies (Append-Only Audit Trail)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Activity logs viewable by participants" ON public.activity_logs;
CREATE POLICY "Activity logs viewable by participants"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (public.current_user_has_retirement_access(retirement_id) OR public.current_user_is_admin());

-- Audit logs are strictly append-only; user_id must match authenticated caller
DROP POLICY IF EXISTS "Activity logs appendable by participants" ON public.activity_logs;
CREATE POLICY "Activity logs appendable by participants"
  ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_retirement_access(retirement_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- No client UPDATE or DELETE permitted on activity logs
-- (Guarantees audit trail immutability for clients)

-- ============================================================================
-- 5. AUTOMATED PROFILE TRIGGER
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
-- 6. PROTECTED RETIREMENT-CODE CLAIMING RPC (WITH AUDIT & VALIDATION)
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
  v_user_name TEXT;
  v_already_access BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 1. Locate retirement
  SELECT id, owner_id, status INTO v_retirement_id, v_owner_id, v_status
  FROM public.retirements
  WHERE UPPER(code) = UPPER(TRIM(p_code));

  IF v_retirement_id IS NULL OR v_status = 'in_trash' THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  -- 2. Owner cannot claim their own retirement as a participant
  IF v_owner_id = v_user_id THEN
    RETURN v_retirement_id;
  END IF;

  -- 3. Check if access already exists (Idempotency check)
  SELECT EXISTS (
    SELECT 1 FROM public.retirement_access WHERE retirement_id = v_retirement_id AND user_id = v_user_id
  ) INTO v_already_access;

  IF NOT v_already_access THEN
    -- Grant REVIEWER access
    INSERT INTO public.retirement_access (retirement_id, user_id, role, granted_at)
    VALUES (v_retirement_id, v_user_id, 'REVIEWER', NOW());

    SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user_id;

    -- Append audit trail
    INSERT INTO public.activity_logs (retirement_id, user_id, action, details, created_at)
    VALUES (
      v_retirement_id,
      v_user_id,
      'Access Granted via Code',
      COALESCE(v_user_name, 'User') || ' linked retirement as Reviewer',
      NOW()
    );
  END IF;

  RETURN v_retirement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_retirement_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_retirement_by_code(TEXT) TO authenticated;

-- ============================================================================
-- 7. ATOMIC DAILY RECORD HIERARCHY UPSERT (TRANSACTIONAL & COMPLIANT)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_daily_record_hierarchy(
  p_record_id UUID,
  p_retirement_id UUID,
  p_record_date DATE,
  p_categories JSONB,
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
  v_calculated_daily_total NUMERIC(15, 2) := 0.00;
  v_cat JSONB;
  v_item JSONB;
  v_cat_id UUID;
  v_item_id UUID;
  v_cat_name TEXT;
  v_cat_subtotal NUMERIC(15, 2);
  v_item_qty NUMERIC(12, 2);
  v_item_rate NUMERIC(15, 2);
  v_item_desc TEXT;
  v_user_name TEXT;
  v_sort_order INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 1. Authorization Check: primary owner OR participant OWNER
  IF NOT (public.current_user_is_retirement_editor(p_retirement_id) OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: User is not permitted to edit this retirement';
  END IF;

  -- 2. Upsert parent daily_record enforcing 1 record per retirement/date
  INSERT INTO public.daily_records (id, retirement_id, record_date, daily_total, updated_at)
  VALUES (
    COALESCE(p_record_id, gen_random_uuid()),
    p_retirement_id,
    p_record_date,
    0.00,
    NOW()
  )
  ON CONFLICT (retirement_id, record_date) DO UPDATE SET
    updated_at = NOW()
  RETURNING id INTO v_daily_record_id;

  -- 3. Delete existing categories and items under this daily record
  -- (Atomic replacement of category/item state for this consolidated calendar date)
  DELETE FROM public.categories WHERE daily_record_id = v_daily_record_id;

  -- 4. Process and insert categories and expense items
  FOR v_cat IN SELECT * FROM jsonb_array_elements(p_categories)
  LOOP
    v_cat_name := TRIM(COALESCE(v_cat->>'name', 'General'));
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
          v_item_qty := GREATEST(0, COALESCE((v_item->>'quantity')::NUMERIC, 1.00));
          v_item_rate := GREATEST(0, COALESCE((v_item->>'rate')::NUMERIC, 0.00));
          v_cat_subtotal := v_cat_subtotal + ROUND(v_item_qty * v_item_rate, 2);

          -- NOTE: Do NOT assign 'amount' because it is a GENERATED ALWAYS STORED column!
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

  -- 5. Update daily_records total
  UPDATE public.daily_records
  SET daily_total = v_calculated_daily_total,
      updated_at = NOW()
  WHERE id = v_daily_record_id;

  -- 6. Touch parent retirement updated_at
  UPDATE public.retirements
  SET updated_at = NOW()
  WHERE id = p_retirement_id;

  -- 7. Audit log append
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user_id;
  INSERT INTO public.activity_logs (retirement_id, user_id, action, details, created_at)
  VALUES (
    p_retirement_id,
    v_user_id,
    'Daily Record Saved',
    COALESCE(v_user_name, 'User') || ' saved daily record for ' || p_record_date::TEXT || ' (Total: ₦' || v_calculated_daily_total::TEXT || ')',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'daily_record_id', v_daily_record_id,
    'record_date', p_record_date,
    'daily_total', v_calculated_daily_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_daily_record_hierarchy(UUID, UUID, DATE, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_daily_record_hierarchy(UUID, UUID, DATE, JSONB, TIMESTAMPTZ) TO authenticated;
