import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, LoginRequest } from '../types';
import { fetchProfile, invalidateApiCache, onSessionExpired } from '../api/client';
import { authClient } from '../lib/auth-client';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  permissions: string[];
  isAdmin: boolean;
  isBranchUser: boolean;
  branchId: string | null;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// The signed-in user is kept in memory only and always comes from the server
// (GET /api/v1/auth/me, after Better Auth signs in). It drives what the UI shows; the server never
// trusts it — every request is authorised from the database.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the session on load from the HttpOnly session cookie
  useEffect(() => {
    let cancelled = false;
    fetchProfile<AuthUser>()
      .then((profile) => { if (!cancelled) setUser(profile); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // A session that has ended (signed out elsewhere, password changed,
  // deactivated, disabled) returns the user to the sign-in page.
  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    });
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const { error } = await authClient.signIn.email(credentials);
    if (error) throw new Error(error.status === 429 || error.status === 403 ? (error.message || 'Sign-in refused') : 'Invalid email or password');
    const profile = await fetchProfile<AuthUser>();
    if (!profile) throw new Error('Signed in, but your account has no access. Contact your administrator.');
    setUser(profile);
  }, []);

  const logout = useCallback(() => {
    authClient.signOut().finally(() => {
      invalidateApiCache();
      setUser(null);
      window.location.href = '/login';
    });
  }, []);

  const hasPermission = useCallback(
    (code: string) => {
      if (!user) return false;
      return user.permissions.includes(code) || user.permissions.includes('*');
    },
    [user]
  );

  const isAdmin = user?.role === 'admin';
  const isBranchUser = user?.role === 'branch_user';
  const branchId = user?.branchId ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        permissions: user?.permissions ?? [],
        isAdmin,
        isBranchUser,
        branchId,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
