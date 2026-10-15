-- ============================================================================
-- myRet: Cloud Database Foundation Migration (CANDIDATE / UNAPPLIED)
-- Version: 20261014000000
-- Description: Establishes complete RLS, automated user profile trigger,
--              secure helper functions, and atomic RPCs for offline sync.
-- Safety: Unapplied candidate migration. Do not execute without explicit approval.
-- ============================================================================

-- 1. Profiles Table
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

-- 2. Retirements Table
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

-- 3. Retirement Access (Sharing & Permissions)
CREATE TABLE IF NOT EXISTS public.retirement_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'REVIEWER' CHECK (role IN ('OWNER', 'REVIEWER')),
  granted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, user_id)
);

-- 4. Daily Records Table
CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  record_date DATE NOT NULL,
  daily_total NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, record_date)
);

-- 5. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_record_id UUID REFERENCES public.daily_records(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subtotal NUMERIC(15, 2) DEFAULT 0.00 NOT NULL,
  sort_order INT DEFAULT 0
);

-- 6. Expense Items Table
CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity >= 0),
  rate NUMERIC(15, 2) NOT NULL CHECK (rate >= 0),
  amount NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * rate) STORED,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 7. Supplementary Entries Table
CREATE TABLE IF NOT EXISTS public.supplementary_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 8. Connected Retirements Relationship
CREATE TABLE IF NOT EXISTS public.connected_retirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  connected_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(retirement_id, connected_id)
);

-- 9. Activity History / Audit Logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retirement_id UUID REFERENCES public.retirements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================================
-- INDEXES
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

-- ============================================================================
-- NON-RECURSIVE SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_retirement_access(p_ret_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements WHERE id = p_ret_id AND owner_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.retirement_access WHERE retirement_id = p_ret_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_retirement_editor(p_ret_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retirements WHERE id = p_ret_id AND owner_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.retirement_access WHERE retirement_id = p_ret_id AND user_id = p_user_id AND role = 'OWNER'
  );
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirement_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplementary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- 2. Retirements Policies
DROP POLICY IF EXISTS "Users can view retirements they own or have access to" ON public.retirements;
CREATE POLICY "Users can view retirements they own or have access to"
  ON public.retirements FOR SELECT TO authenticated
  USING (public.has_retirement_access(id, auth.uid()));

DROP POLICY IF EXISTS "Owners can insert and update their retirements" ON public.retirements;
CREATE POLICY "Owners can insert their retirements"
  ON public.retirements FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can update their retirements" ON public.retirements;
CREATE POLICY "Owners can update their retirements"
  ON public.retirements FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can delete their retirements" ON public.retirements;
CREATE POLICY "Owners can delete their retirements"
  ON public.retirements FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 3. Retirement Access Policies
DROP POLICY IF EXISTS "Participants can view access list" ON public.retirement_access;
CREATE POLICY "Participants can view access list"
  ON public.retirement_access FOR SELECT TO authenticated
  USING (public.has_retirement_access(retirement_id, auth.uid()));

DROP POLICY IF EXISTS "Primary owners can manage access" ON public.retirement_access;
CREATE POLICY "Primary owners can manage access"
  ON public.retirement_access FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.retirements WHERE id = retirement_access.retirement_id AND owner_id = auth.uid())
  );

-- 4. Daily Records Policies
DROP POLICY IF EXISTS "Daily records viewable by retirement participants" ON public.daily_records;
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (public.has_retirement_access(retirement_id, auth.uid()));

DROP POLICY IF EXISTS "Daily records modifiable by editors" ON public.daily_records;
CREATE POLICY "Daily records modifiable by editors"
  ON public.daily_records FOR ALL TO authenticated
  USING (public.is_retirement_editor(retirement_id, auth.uid()))
  WITH CHECK (public.is_retirement_editor(retirement_id, auth.uid()));

-- 5. Categories Policies
DROP POLICY IF EXISTS "Categories viewable by participants" ON public.categories;
CREATE POLICY "Categories viewable by participants"
  ON public.categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.has_retirement_access(dr.retirement_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Categories modifiable by editors" ON public.categories;
CREATE POLICY "Categories modifiable by editors"
  ON public.categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.is_retirement_editor(dr.retirement_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_records dr
      WHERE dr.id = categories.daily_record_id AND public.is_retirement_editor(dr.retirement_id, auth.uid())
    )
  );

-- 6. Expense Items Policies
DROP POLICY IF EXISTS "Expense items viewable by participants" ON public.expense_items;
CREATE POLICY "Expense items viewable by participants"
  ON public.expense_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.has_retirement_access(dr.retirement_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Expense items modifiable by editors" ON public.expense_items;
CREATE POLICY "Expense items modifiable by editors"
  ON public.expense_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.is_retirement_editor(dr.retirement_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.categories c
      JOIN public.daily_records dr ON dr.id = c.daily_record_id
      WHERE c.id = expense_items.category_id AND public.is_retirement_editor(dr.retirement_id, auth.uid())
    )
  );

-- 7. Supplementary Entries Policies
DROP POLICY IF EXISTS "Supplementary viewable by participants" ON public.supplementary_entries;
CREATE POLICY "Supplementary viewable by participants"
  ON public.supplementary_entries FOR SELECT TO authenticated
  USING (public.has_retirement_access(retirement_id, auth.uid()));

DROP POLICY IF EXISTS "Supplementary modifiable by editors" ON public.supplementary_entries;
CREATE POLICY "Supplementary modifiable by editors"
  ON public.supplementary_entries FOR ALL TO authenticated
  USING (public.is_retirement_editor(retirement_id, auth.uid()))
  WITH CHECK (public.is_retirement_editor(retirement_id, auth.uid()));

-- 8. Connected Retirements Policies
DROP POLICY IF EXISTS "Connected retirements viewable by participants" ON public.connected_retirements;
CREATE POLICY "Connected retirements viewable by participants"
  ON public.connected_retirements FOR SELECT TO authenticated
  USING (public.has_retirement_access(retirement_id, auth.uid()));

DROP POLICY IF EXISTS "Connected retirements modifiable by editors" ON public.connected_retirements;
CREATE POLICY "Connected retirements modifiable by editors"
  ON public.connected_retirements FOR ALL TO authenticated
  USING (public.is_retirement_editor(retirement_id, auth.uid()))
  WITH CHECK (public.is_retirement_editor(retirement_id, auth.uid()));

-- 9. Activity Logs Policies
DROP POLICY IF EXISTS "Activity logs viewable by participants" ON public.activity_logs;
CREATE POLICY "Activity logs viewable by participants"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_retirement_access(retirement_id, auth.uid()));

DROP POLICY IF EXISTS "Activity logs appendable by participants" ON public.activity_logs;
CREATE POLICY "Activity logs appendable by participants"
  ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_retirement_access(retirement_id, auth.uid()));

-- ============================================================================
-- AUTOMATED USER PROFILE CREATION TRIGGER
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
-- PROTECTED CODE-CLAIMING RPC
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
  v_status TEXT;
  v_user_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id, status INTO v_retirement_id, v_status
  FROM public.retirements
  WHERE UPPER(code) = UPPER(TRIM(p_code));

  IF v_retirement_id IS NULL OR v_status = 'in_trash' THEN
    RAISE EXCEPTION 'Invalid retirement code';
  END IF;

  INSERT INTO public.retirement_access (retirement_id, user_id, role, granted_at)
  VALUES (v_retirement_id, v_user_id, 'REVIEWER', NOW())
  ON CONFLICT (retirement_id, user_id) DO NOTHING;

  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.activity_logs (retirement_id, user_id, action, details, created_at)
  VALUES (
    v_retirement_id,
    v_user_id,
    'Access Granted via Code',
    COALESCE(v_user_name, 'User') || ' linked retirement as Reviewer',
    NOW()
  );

  RETURN v_retirement_id;
END;
$$;
