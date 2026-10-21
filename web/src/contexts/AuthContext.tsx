import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, LoginRequest } from '../types';
import { loginRequest, logoutRequest, refreshSession, onSessionExpired, setAccessToken } from '../api/client';

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
// (login or refresh response). It drives what the UI shows; the server never
// trusts it — every request is authorised from the database.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the session on load from the HttpOnly refresh cookie
  useEffect(() => {
    let cancelled = false;
    refreshSession<AuthUser>()
      .then((session) => { if (!cancelled) setUser(session?.user ?? null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // A session that can no longer be renewed (logged out elsewhere, password
  // changed, revoked) returns the user to the sign-in page.
  useEffect(() => {
    onSessionExpired(() => {
      setAccessToken(null);
      setUser(null);
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    });
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const session = await loginRequest<AuthUser>(credentials);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    logoutRequest().finally(() => {
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
