import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';

export function LoginPage() {
  const { login } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) { setError('Email is required'); return; }
    if (!password) { setError('Password is required'); return; }

    setLoading(true);
    try {
      await login({ email, password });
      addToast('success', 'Welcome back!');
      navigate('/');
    } catch (err: any) {
      const msg = err?.message || 'Invalid email or password';
      setError(msg);
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .login-root {
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          display: flex;
          background: #09120a;
          position: relative;
          overflow: hidden;
        }

        /* Sophisticated subtle background */
        .login-bg-pattern {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(26, 140, 22, 0.08), transparent 25%),
            radial-gradient(circle at 85% 30%, rgba(26, 140, 22, 0.06), transparent 25%);
          z-index: 1;
        }

        /* Card */
        .login-card {
          position: relative;
          z-index: 10;
          margin: auto;
          width: 100%;
          max-width: 420px;
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 24px 48px -12px rgba(0,0,0,0.4);
          padding: 48px 40px;
          animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Logo area */
        .login-logo-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 32px;
        }

        .login-logo-ring {
          width: 72px;
          height: 72px;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          overflow: hidden;
          margin-bottom: 20px;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .login-logo-ring img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          padding: 8px;
        }

        .login-logo-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0d5c0a;
          color: #ffffff;
          font-size: 24px;
          font-weight: 800;
        }

        .login-title {
          margin: 0 0 6px;
          font-size: 24px;
          font-weight: 700;
          color: #0f172a;
          text-align: center;
          letter-spacing: -0.02em;
        }

        .login-subtitle {
          margin: 0;
          font-size: 14px;
          color: #64748b;
          text-align: center;
          font-weight: 400;
        }

        /* Error */
        .login-error {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 24px;
        }

        /* Form */
        .login-form { display: grid; gap: 20px; }

        .login-field-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #334155;
          margin-bottom: 8px;
        }

        .login-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .login-input-icon {
          position: absolute;
          left: 14px;
          color: #94a3b8;
          display: flex;
          pointer-events: none;
        }

        .login-input {
          width: 100%;
          height: 44px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 40px;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          color: #0f172a;
          background: #ffffff;
          transition: all 0.2s;
          outline: none;
        }

        .login-input:focus {
          border-color: #0d5c0a;
          box-shadow: 0 0 0 3px rgba(13, 92, 10, 0.1);
        }

        .login-input::placeholder { color: #94a3b8; }

        .login-eye-btn {
          position: absolute;
          right: 14px;
          background: none;
          border: none;
          cursor: pointer;
          color: #94a3b8;
          display: flex;
          align-items: center;
          padding: 4px;
          transition: color 0.2s;
        }
        .login-eye-btn:hover { color: #0d5c0a; }

        /* Submit button */
        .login-btn {
          width: 100%;
          height: 44px;
          background: #0d5c0a;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
          margin-top: 8px;
        }

        .login-btn:hover:not(:disabled) {
          background: #0a4608;
        }

        .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        /* Spinner */
        .login-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Footer */
        .login-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 32px;
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }

        @media (max-width: 480px) {
          .login-card { margin: 16px; padding: 32px 24px; border-radius: 12px; }
          .login-title { font-size: 20px; }
        }
      `}</style>

      <div className="login-root">
        <div className="login-bg-pattern" />

        <div className="login-card">
          {/* Logo & Title */}
          <div className="login-logo-wrap">
            <div className="login-logo-ring">
              <img
                src="/logo.png"
                alt="Al Hayat"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <div className="login-logo-fallback" style={{ display: 'none' }}>AH</div>
            </div>
            <h1 className="login-title">Sign in to Al Hayat</h1>
            <p className="login-subtitle">Enterprise Resource Planning System</p>
          </div>

          {/* Error alert */}
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="login-field-label">Email Address</label>
              <div className="login-input-wrap">
                <span className="login-input-icon"><Mail size={16} /></span>
                <input
                  id="login-email"
                  type="email"
                  className="login-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@alhayat.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" className="login-field-label">Password</label>
              <div className="login-input-wrap">
                <span className="login-input-icon"><Lock size={16} /></span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="login-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="login-eye-btn"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <div className="login-spinner" />
                  Authenticating...
                </>
              ) : (
                <>
                  Sign In <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="login-footer">
            <ShieldCheck size={14} />
            Secure Enterprise Connection
          </div>
        </div>
      </div>
    </>
  );
}
