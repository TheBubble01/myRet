import { createClient, User } from '@supabase/supabase-js';
import { UserProfile } from '../types';

const env =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) ||
  (typeof process !== 'undefined' && process.env) ||
  {};

const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function formatSupabaseUser(user: User): UserProfile {
  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  const isAdminEmail =
    (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') ||
    (user.email && user.email.toLowerCase().startsWith('admin@'));
  const role =
    (appMeta.role as string) ||
    (meta.role as string) ||
    (isAdminEmail ? 'admin' : 'user');

  return {
    id: user.id,
    name: meta.name || user.email?.split('@')[0].replace(/[._]/g, ' ') || 'Site Engineer',
    designation: meta.designation || 'Site Construction Engineer',
    phone: meta.phone || '',
    email: user.email || '',
    placement: meta.placement || 'Site Project Placement',
    avatarUrl: meta.avatarUrl,
    role,
  };
}

export function isUserAdmin(user: UserProfile | null): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'tech-admin') return true;
  if (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') return true;
  if (user.email && user.email.toLowerCase().startsWith('admin@')) return true;
  return false;
}
