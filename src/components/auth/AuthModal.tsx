import React, { useState } from 'react';
import { X, Mail, Lock, User, Briefcase, Building, Phone, ArrowRight, ShieldCheck, AlertCircle, RefreshCw, CheckCircle2, KeyRound } from 'lucide-react';
import { UserProfile } from '../../types';
import { supabase, formatSupabaseUser, isSupabaseConfigured } from '../../utils/supabaseClient';
import { storage } from '../../utils/storage';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  onSuccess: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('Site Construction Engineer');
  const [phone, setPhone] = useState('');
  const [placement, setPlacement] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [registrationNotice, setRegistrationNotice] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRegistrationNotice(null);
    setResendSent(false);

    if (!isSupabaseConfigured) {
      setError('Unable to connect to authentication service. Please check your connection and try again.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password) {
          setError('Please enter both your email address and password.');
          setIsSubmitting(false);
          return;
        }

        // Authenticate with real Supabase Auth
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (authError) {
          console.error('Supabase signInWithPassword error:', authError);
          if (authError.message.toLowerCase().includes('invalid login credentials')) {
            setError('Invalid email or password. Access rejected.');
          } else if (authError.message.toLowerCase().includes('email not confirmed')) {
            setError('Your email has not been confirmed yet. Please check your inbox or confirm your email address.');
          } else {
            setError(authError.message || 'Authentication failed. Please verify your credentials.');
          }
          setIsSubmitting(false);
          return;
        }

        if (!data.user || !data.session) {
          setError('Unable to sign you in. Please check your details and try again.');
          setIsSubmitting(false);
          return;
        }

        // Success: format real Supabase user
        const profile = formatSupabaseUser(data.user);
        storage.setCurrentUser(profile);
        setIsSubmitting(false);
        onSuccess(profile);
        onClose();
      } else if (mode === 'register') {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password || !name.trim()) {
          setError('Please provide your full name, email, and a password.');
          setIsSubmitting(false);
          return;
        }

        if (password.length < 6) {
          setError('Password must be at least 6 characters long.');
          setIsSubmitting(false);
          return;
        }

        // Register user in Supabase Auth
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              name: name.trim(),
              designation: designation.trim() || 'Site Construction Engineer',
              phone: phone.trim() || '',
              placement: placement.trim() || 'Site Project Placement',
            },
          },
        });

        if (signUpError) {
          console.error('Supabase signUp error:', signUpError);
          setError(signUpError.message || 'Unable to create account. Please try again.');
          setIsSubmitting(false);
          return;
        }

        if (!data.user) {
          setError('Unable to complete account registration. Please try again.');
          setIsSubmitting(false);
          return;
        }

        // If email confirmation is disabled or session returned immediately
        if (data.session) {
          const profile = formatSupabaseUser(data.user);
          storage.setCurrentUser(profile);
          setIsSubmitting(false);
          onSuccess(profile);
          onClose();
        } else {
          // User created in Supabase Auth, but requires email confirmation
          setIsSubmitting(false);
          setRegistrationNotice(
            `Account successfully registered for ${data.user.email}! Please check your email inbox to confirm your address, or sign in.`
          );
        }
      } else if (mode === 'forgot') {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) {
          setError('Please enter your registered email address.');
          setIsSubmitting(false);
          return;
        }

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail);
        if (resetError) {
          setError(resetError.message || 'Failed to send password reset request.');
          setIsSubmitting(false);
          return;
        }

        setIsSubmitting(false);
        setResetSent(true);
      }
    } catch (err: unknown) {
      console.error('Unexpected auth exception:', err);
      const message = err instanceof Error ? err.message : 'An unexpected error occurred during authentication.';
      setError(message);
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email.trim()) return;
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });
      if (resendError) {
        setError(resendError.message);
      } else {
        setResendSent(true);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to resend confirmation email';
      setError(message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-amber-500 font-extrabold text-lg">myRet</span>
            </div>
            <h2 className="text-base font-bold text-white mt-1">
              {mode === 'login' && 'Sign In to Your Account'}
              {mode === 'register' && 'Create Your Account'}
              {mode === 'forgot' && 'Reset Your Password'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              {error.toLowerCase().includes('email not confirmed') && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  className="mt-2 text-xs font-semibold text-amber-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Resend Confirmation Email</span>
                </button>
              )}
            </div>
          </div>
        )}

        {resendSent && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-950/70 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>Confirmation email has been resent to {email}.</span>
          </div>
        )}

        {registrationNotice ? (
          <div className="py-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">Account Created</h3>
            <p className="text-xs text-slate-300 leading-relaxed px-2">
              {registrationNotice}
            </p>
            <button
              onClick={() => {
                setRegistrationNotice(null);
                setMode('login');
              }}
              className="mt-3 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
            >
              Proceed to Sign In
            </button>
          </div>
        ) : mode === 'forgot' ? (
          <div className="py-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Manual Admin Password Reset</h3>
              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto mt-2 p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-left">
                Email-based password reset is disabled for this deployment. An authorized site administrator can manually reset your password in the <strong>Admin User Management Portal</strong> and provide you with a temporary password.
              </p>
            </div>
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-left text-xs text-amber-200">
              <p className="font-semibold text-amber-400">Next Steps:</p>
              <p className="text-[11px] text-slate-300 mt-1">
                Please provide your registered email address {email ? `(${email})` : ''} to your system administrator to generate a secure temporary password.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('login');
              }}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3 overflow-y-auto pr-1">
            {mode === 'register' && (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                    <User className="w-3.5 h-3.5 text-amber-400" /> Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Mubarak Jibril Dederi"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                    <Briefcase className="w-3.5 h-3.5 text-amber-400" /> Designation *
                  </label>
                  <input
                    type="text"
                    required
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="Site Construction Engineer"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                    <Building className="w-3.5 h-3.5 text-amber-400" /> Project / Site *
                  </label>
                  <input
                    type="text"
                    required
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value)}
                    placeholder="Borno State Hospital Project"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                    <Phone className="w-3.5 h-3.5 text-amber-400" /> Phone Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 803 123 4567"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email Address *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="engineer@company.com"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" /> Password *
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode('forgot');
                    }}
                    className="text-[11px] text-amber-400 hover:underline"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Signing you in…</span>
                </>
              ) : (
                <>
                  <span>
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-2 text-center text-xs text-slate-400">
              {mode === 'login' ? (
                <p>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode('register');
                    }}
                    className="text-amber-400 font-bold hover:underline"
                  >
                    Create Account
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode('login');
                    }}
                    className="text-amber-400 font-bold hover:underline"
                  >
                    Sign In
                  </button>
                </p>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
