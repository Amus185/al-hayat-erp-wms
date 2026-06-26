import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser, Warehouse } from '../types';
import * as client from '../api/client';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  activeWarehouse: Warehouse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setActiveWarehouse: (warehouse: Warehouse | null) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACTIVE_WAREHOUSE_KEY = 'al_hayat_wms_active_warehouse';
const USER_DATA_KEY = 'al_hayat_wms_user_data';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeWarehouse, setActiveWarehouseState] = useState<Warehouse | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const token = await client.initializeClient();
        if (token) {
          // Recover user profile
          const userDataStr = await AsyncStorage.getItem(USER_DATA_KEY);
          if (userDataStr) {
            setUser(JSON.parse(userDataStr));
          } else {
            // If token exists but no user info, we might want to logout
            await client.logout();
          }

          // Recover active warehouse
          const warehouseStr = await AsyncStorage.getItem(ACTIVE_WAREHOUSE_KEY);
          if (warehouseStr) {
            setActiveWarehouseState(JSON.parse(warehouseStr));
          }
        }
      } catch (error) {
        console.error('Error recovering session:', error);
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const response = await client.login({ email, password });
      setUser(response.user);
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(response.user));
    } catch (error) {
      await client.logout();
      setUser(null);
      await AsyncStorage.removeItem(USER_DATA_KEY);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await client.logout();
      setUser(null);
      setActiveWarehouseState(null);
      await AsyncStorage.removeItem(USER_DATA_KEY);
      await AsyncStorage.removeItem(ACTIVE_WAREHOUSE_KEY);
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      setLoading(false);
    }
  };

  const setActiveWarehouse = async (warehouse: Warehouse | null) => {
    try {
      setActiveWarehouseState(warehouse);
      if (warehouse) {
        await AsyncStorage.setItem(ACTIVE_WAREHOUSE_KEY, JSON.stringify(warehouse));
      } else {
        await AsyncStorage.removeItem(ACTIVE_WAREHOUSE_KEY);
      }
    } catch (error) {
      console.error('Error saving active warehouse:', error);
    }
  };

  const refreshUser = async () => {
    try {
      // In a real app we might call GET /auth/me
      const me = await client.api.get<AuthUser>('/auth/me');
      if (me) {
        setUser(me);
        await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(me));
      }
    } catch (error) {
      console.error('Error refreshing user session:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeWarehouse,
        login,
        logout,
        setActiveWarehouse,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
