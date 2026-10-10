-- ============================================================================
-- myRet: Digital Construction-Site Expenditure and Retirement Management Schema
-- PostgreSQL + Supabase Row Level Security (RLS)
-- ============================================================================

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
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
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_retirements_owner ON public.retirements(owner_id);
CREATE INDEX IF NOT EXISTS idx_retirements_code ON public.retirements(code);
CREATE INDEX IF NOT EXISTS idx_retirements_status ON public.retirements(status);
CREATE INDEX IF NOT EXISTS idx_daily_records_ret ON public.daily_records(retirement_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON public.daily_records(record_date);
CREATE INDEX IF NOT EXISTS idx_categories_record ON public.categories(daily_record_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_cat ON public.expense_items(category_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_ret ON public.supplementary_entries(retirement_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_ret ON public.activity_logs(retirement_id);

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

-- Profiles: Users can view all profiles, but only update their own
CREATE POLICY "Public profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Retirements: Owner or granted access can view
CREATE POLICY "Users can view retirements they own or have access to"
  ON public.retirements FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.retirement_access
      WHERE retirement_access.retirement_id = retirements.id
      AND retirement_access.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert and update their retirements"
  ON public.retirements FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update their retirements"
  ON public.retirements FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete their retirements"
  ON public.retirements FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Child tables (daily_records, categories, items, supplementary) inherit via retirement ownership/access check
CREATE POLICY "Daily records viewable by retirement participants"
  ON public.daily_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.retirements r
      WHERE r.id = daily_records.retirement_id
      AND (r.owner_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.retirement_access ra
        WHERE ra.retirement_id = r.id AND ra.user_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Daily records modifiable by owners"
  ON public.daily_records FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.retirements r
      WHERE r.id = daily_records.retirement_id AND r.owner_id = auth.uid()
    )
  );
