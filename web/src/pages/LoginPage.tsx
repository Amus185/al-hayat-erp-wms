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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Simple client-side validation
    if (!email) {
      setError('Email is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      await login({ email, password });
      addToast('success', 'Logged in successfully');
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'Invalid email or password');
      addToast('error', err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f7f9f7',
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(6, 96, 6, 0.08)',
        border: '1px solid #e1e8e1',
        padding: '36px'
      }}>
        {/* Brand Header */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '32px'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '12px',
            background: '#0b8f08', // Primary
            color: '#f3d400', // Accent
            fontWeight: '900',
            fontSize: '24px',
            marginBottom: '12px'
          }}>
            AH
          </div>
          <h1 style={{
            margin: '0',
            fontSize: '22px',
            color: '#066006', // Dark Green
            fontWeight: '800'
          }}>
            Al Hayat ERP + WMS
          </h1>
          <p style={{
            margin: '4px 0 0',
            color: '#667066',
            fontSize: '14px'
          }}>
            Sign in to your staff dashboard
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '14px',
            marginBottom: '20px',
            textAlign: 'center',
            fontWeight: '600'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '18px' }}>
          <div>
            <label htmlFor="email" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '700',
              color: '#394339',
              marginBottom: '6px'
            }}>
              Email Address <span style={{ color: '#991b1b' }}>*</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@alhayat.com"
              style={{
                width: '100%',
                minHeight: '40px',
                borderRadius: '8px',
                border: '1px solid #d9e2d9',
                padding: '0 12px',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              required
            />
          </div>

          <div>
            <label htmlFor="password" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '700',
              color: '#394339',
              marginBottom: '6px'
            }}>
              Password <span style={{ color: '#991b1b' }}>*</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                minHeight: '40px',
                borderRadius: '8px',
                border: '1px solid #d9e2d9',
                padding: '0 12px',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              minHeight: '42px',
              background: '#0b8f08', // Primary
              color: '#ffffff',
              border: '0',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
