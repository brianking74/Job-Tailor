
import React, { useEffect, useState } from 'react';
import type { AuthUser } from '../types.ts';
import { signUp, signIn, AuthError } from '../services/authService.ts';

export type AuthModalMode = 'signup' | 'login';

interface AuthModalProps {
  open: boolean;
  initialMode?: AuthModalMode;
  onClose: () => void;
  onAuthSuccess: (user: AuthUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  initialMode = 'signup',
  onClose,
  onAuthSuccess,
}) => {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-initialize the form each time the modal opens.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setName('');
      setEmail('');
      setPassword('');
      setShowPassword(false);
      setError(null);
      setLoading(false);
    }
  }, [open, initialMode]);

  // Escape closes the modal; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const isSignup = mode === 'signup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const user = isSignup ? await signUp(name, email, password) : await signIn(email, password);
      onAuthSuccess(user);
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        console.error('Unexpected auth failure', err);
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: AuthModalMode) => {
    setMode(next);
    setError(null);
  };

  const inputClass =
    'w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={isSignup ? 'Sign up' : 'Log in'}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}></div>
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-fadeInUp">
        <div className="bg-blue-600 p-8 text-white">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-2 rounded-lg">
                <i className="fas fa-bolt"></i>
              </div>
              <span className="font-bold tracking-tight">JobTailor</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-white/60 hover:text-white transition-colors">
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          <h3 className="text-2xl font-black mt-4">{isSignup ? 'Create your account' : 'Welcome back'}</h3>
          <p className="text-blue-100 text-sm mt-1">
            {isSignup ? 'Join thousands of job seekers using AI to land more interviews.' : 'Log in to continue tailoring your applications.'}
          </p>
        </div>

        <div className="p-8">
          {/* Mode switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-full mb-8">
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2.5 rounded-full text-sm font-bold transition-all ${isSignup ? 'bg-white text-blue-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`py-2.5 rounded-full text-sm font-bold transition-all ${!isSignup ? 'bg-white text-blue-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Log In
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            {isSignup && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Full Name</label>
                <div className="relative">
                  <input
                    id="auth-name"
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    autoComplete="name"
                    className={inputClass + ' pl-12'}
                  />
                  <i className="fas fa-user absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Email</label>
              <div className="relative">
                <input
                  id="auth-email"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputClass + ' pl-12'}
                />
                <i className="fas fa-envelope absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
              </div>
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Password</label>
              <div className="relative">
                <input
                  id="auth-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  className={inputClass + ' pl-12 pr-12'}
                />
                <i className="fas fa-lock absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2 text-sm animate-fadeIn">
                <i className="fas fa-circle-exclamation mt-0.5"></i>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <i className="fas fa-circle-notch fa-spin"></i>
                  {isSignup ? 'Creating account...' : 'Logging in...'}
                </>
              ) : (
                <>
                  {isSignup ? 'Create Account' : 'Log In'}
                  <i className="fas fa-arrow-right"></i>
                </>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500">
            {isSignup ? (
              <>Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="font-bold text-blue-600 hover:text-blue-700">Log in</button>
              </>
            ) : (
              <>New to JobTailor?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="font-bold text-blue-600 hover:text-blue-700">Create an account</button>
              </>
            )}
          </p>
          <p className="text-center text-xs text-slate-400 mt-4">
            <i className="fas fa-shield-halved mr-1"></i>
            Free account — your details stay on this device.
          </p>
        </div>
      </div>
    </div>
  );
};
