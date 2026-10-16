import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Loader2, ArrowRight, User, Lock, Eye, EyeOff, ShieldCheck, Clock, CalendarCheck, Wallet, GraduationCap } from 'lucide-react';
import logoImg from '../images/autoform-logo.png';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { DeskIllustration } from './DeskIllustration';
import { LEAVES_ENABLED } from '../utils/features';

interface LoginFormProps {
  onLoginSuccess?: () => void;
}

const HIGHLIGHTS = [
  { icon: Clock, label: 'Attendance' },
  { icon: CalendarCheck, label: LEAVES_ENABLED ? 'Leaves' : 'Holidays' },
  { icon: Wallet, label: 'Payslips' },
  { icon: GraduationCap, label: 'Learning' },
];

const inputClass =
  'w-full pl-11 pr-4 py-3.5 bg-slate-50/70 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 ' +
  'focus:outline-none focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange focus:bg-white ' +
  'disabled:opacity-60 transition-all duration-200';

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const success = await login(username, password);
      if (success) {
        onLoginSuccess?.();
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-white font-sans">
      {/* ── Left: brand + animated illustration (large screens) ── */}
      <aside className="hidden lg:flex lg:w-[54%] xl:w-[58%] relative overflow-hidden bg-gradient-to-br from-orange-50 via-[#fff2e6] to-amber-50 flex-col">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand-orange/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full bg-amber-300/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full min-h-screen px-12 xl:px-16 py-8 [@media(min-height:860px)]:py-12">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Autoform India" className="h-11 w-auto select-none" draggable={false} />
          </div>

          {/* Illustration scales with the window height so the copy below never gets cut off. */}
          <div className="flex-1 min-h-0 flex items-center justify-center py-6">
            <div className="w-full" style={{ maxWidth: 'min(600px, 58vh)' }}>
              <DeskIllustration />
            </div>
          </div>

          <div className="max-w-xl">
            <h2 className="text-3xl xl:text-4xl font-black text-slate-800 tracking-tight leading-tight">
              Your whole workday,
              <br />
              <span className="text-[#f46617]">in one place.</span>
            </h2>
            <p className="text-slate-500 font-medium mt-3 leading-relaxed max-w-md">
              Check attendance, {LEAVES_ENABLED ? 'apply for leave' : 'see holidays'}, download payslips and keep learning — all from Autoform Connect.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 bg-white/80 backdrop-blur px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 shadow-sm ring-1 ring-orange-100">
                  <Icon className="w-3.5 h-3.5 text-[#f46617]" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right: sign-in ── */}
      <main className="flex-1 relative flex items-center justify-center px-5 sm:px-10 py-10 bg-white overflow-hidden">
        {/* Soft brand glow on small screens where the illustration is hidden */}
        <div className="lg:hidden absolute -top-32 -right-32 w-80 h-80 rounded-full bg-brand-orange/15 blur-3xl pointer-events-none" />

        <div className="w-full max-w-[400px] relative z-10 animate-fade-in-up">
          <div className="mb-8">
            <img src={logoImg} alt="Autoform India" className="lg:hidden h-12 w-auto mb-8 select-none" draggable={false} />
            <h1 className="text-4xl font-script text-[#f46617] leading-none">Autoform Connect</h1>
            <p className="text-2xl font-black text-slate-800 tracking-tight mt-4">Welcome back 👋</p>
            <p className="text-sm text-slate-500 font-medium mt-1">Sign in with your work account to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate={false}>
            <div>
              <label htmlFor="login-username" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your username"
                  autoComplete="username"
                  required
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="login-password" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs font-bold text-[#f46617] hover:text-[#d85512] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-12`}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-red-600 text-xs font-semibold animate-shake">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="group w-full py-3.5 px-4 bg-[#f46617] hover:bg-[#d85512] text-white font-bold text-sm tracking-wide rounded-2xl shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-6 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] font-semibold text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Secure, encrypted sign-in
            </span>
            <span>© {new Date().getFullYear()} Autoform India</span>
          </div>
        </div>
      </main>

      {showForgotPassword && (
        <ForgotPasswordModal onClose={() => setShowForgotPassword(false)} />
      )}
    </div>
  );
};

export default LoginForm;
