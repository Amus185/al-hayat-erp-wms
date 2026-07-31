import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, LoginRequest, LoginResponse } from '../types';
import { apiPublicPost } from '../api/client';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('auth_user');
      const accessToken = localStorage.getItem('access_token');
      if (storedUser && accessToken) {
        setUser(JSON.parse(storedUser));
      }
    } catch {
      localStorage.removeItem('auth_user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await apiPublicPost<LoginResponse>('/auth/login', credentials);
    localStorage.setItem('access_token', response.accessToken);
    localStorage.setItem('refresh_token', response.refreshToken);
    localStorage.setItem('auth_user', JSON.stringify(response.user));
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    window.location.href = '/login';
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
