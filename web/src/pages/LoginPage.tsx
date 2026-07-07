import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';

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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        .login-root {
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          display: flex;
          background: #0d5c0a;
          position: relative;
          overflow: hidden;
        }

        /* Animated background blobs */
        .login-bg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.35;
          animation: blobFloat 8s ease-in-out infinite;
        }
        .login-bg-blob-1 {
          width: 500px; height: 500px;
          background: #1a9e16;
          top: -150px; left: -100px;
          animation-delay: 0s;
        }
        .login-bg-blob-2 {
          width: 400px; height: 400px;
          background: #FFD700;
          bottom: -100px; right: -80px;
          animation-delay: -3s;
        }
        .login-bg-blob-3 {
          width: 300px; height: 300px;
          background: #0a8c07;
          top: 40%; left: 60%;
          animation-delay: -6s;
        }

        @keyframes blobFloat {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-30px) scale(1.05); }
        }

        /* Grid overlay pattern */
        .login-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 50px 50px;
          pointer-events: none;
        }

        /* Card */
        .login-card {
          position: relative;
          z-index: 10;
          margin: auto;
          width: 100%;
          max-width: 440px;
          background: rgba(255, 255, 255, 0.97);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          box-shadow:
            0 32px 80px rgba(0,0,0,0.4),
            0 0 0 1px rgba(255,255,255,0.15),
            inset 0 1px 0 rgba(255,255,255,0.8);
          padding: 44px 40px 40px;
          animation: cardIn 0.5s ease-out;
        }

        @keyframes cardIn {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Logo area */
        .login-logo-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 32px;
        }

        .login-logo-ring {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          border: 4px solid #1a8c16;
          box-shadow: 0 8px 24px rgba(26,140,22,0.35), 0 0 0 8px rgba(26,140,22,0.08);
          overflow: hidden;
          margin-bottom: 16px;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .login-logo-ring img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
        }

        .login-logo-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1a8c16, #0d5c0a);
          color: #FFD700;
          font-size: 32px;
          font-weight: 900;
          letter-spacing: -1px;
        }

        .login-title {
          margin: 0 0 4px;
          font-size: 22px;
          font-weight: 800;
          color: #0d5c0a;
          text-align: center;
          letter-spacing: -0.5px;
        }

        .login-subtitle {
          margin: 0;
          font-size: 13px;
          color: #6b7c6b;
          text-align: center;
          font-weight: 500;
        }

        /* Divider */
        .login-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, #d4e8d0, transparent);
          margin: 24px 0;
        }

        /* Error */
        .login-error {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #fff1f1;
          border: 1px solid #fbc8c8;
          border-left: 4px solid #e53e3e;
          color: #c53030;
          padding: 12px 14px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 20px;
          animation: shake 0.4s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        /* Form */
        .login-form { display: grid; gap: 18px; }

        .login-field-label {
          display: block;
          font-size: 12px;
          font-weight: 700;
          color: #2d4a2d;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .login-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .login-input-icon {
          position: absolute;
          left: 14px;
          color: #7a9a7a;
          pointer-events: none;
          font-size: 16px;
        }

        .login-input {
          width: 100%;
          height: 48px;
          border: 1.5px solid #d0e4cc;
          border-radius: 12px;
          padding: 0 44px;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          color: #1a2e1a;
          background: #f8fdf8;
          transition: all 0.2s;
          outline: none;
          box-sizing: border-box;
        }

        .login-input:focus {
          border-color: #1a8c16;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,140,22,0.1);
        }

        .login-input::placeholder { color: #b0c4b0; }

        .login-eye-btn {
          position: absolute;
          right: 14px;
          background: none;
          border: none;
          cursor: pointer;
          color: #7a9a7a;
          font-size: 16px;
          padding: 4px;
          display: flex;
          align-items: center;
          transition: color 0.2s;
        }
        .login-eye-btn:hover { color: #1a8c16; }

        /* Submit button */
        .login-btn {
          width: 100%;
          height: 52px;
          background: linear-gradient(135deg, #1a8c16, #0d5c0a);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.25s;
          box-shadow: 0 4px 16px rgba(13,92,10,0.4);
          margin-top: 4px;
          letter-spacing: 0.2px;
        }

        .login-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #20a81b, #107a0e);
          box-shadow: 0 6px 24px rgba(13,92,10,0.5);
          transform: translateY(-1px);
        }

        .login-btn:active:not(:disabled) {
          transform: translateY(0px);
        }

        .login-btn:disabled {
          opacity: 0.75;
          cursor: not-allowed;
        }

        /* Spinner */
        .login-spinner {
          width: 18px;
          height: 18px;
          border: 2.5px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Footer badge */
        .login-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 24px;
          font-size: 11px;
          color: #8fa88f;
          font-weight: 500;
        }

        .login-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #f0f8f0;
          border: 1px solid #c8e0c4;
          color: #2d6e2a;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
        }

        @media (max-width: 480px) {
          .login-card { margin: 16px; padding: 32px 24px 28px; }
          .login-title { font-size: 19px; }
        }
      `}</style>

      <div className="login-root">
        {/* Animated background */}
        <div className="login-bg-blob login-bg-blob-1" />
        <div className="login-bg-blob login-bg-blob-2" />
        <div className="login-bg-blob login-bg-blob-3" />
        <div className="login-grid" />

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
            <h1 className="login-title">Al Hayat</h1>
            <p className="login-subtitle">Enterprise Resource Planning System</p>
          </div>

          <div className="login-divider" />

          {/* Error alert */}
          {error && (
            <div className="login-error">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="login-field-label">Email Address</label>
              <div className="login-input-wrap">
                <span className="login-input-icon">✉</span>
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
                <span className="login-input-icon">🔒</span>
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
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <div className="login-spinner" />
                  Signing in...
                </>
              ) : (
                <>
                  <span>🔐</span> Sign In to Dashboard
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="login-footer">
            <span className="login-badge">🔒 Secure Enterprise System</span>
          </div>
        </div>
      </div>
    </>
  );
}
