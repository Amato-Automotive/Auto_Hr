import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, AUTH_EXPIRED_EVENT, type AuthUser } from '../services/api';

interface AuthContextType {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, check if we have a stored token and validate it
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authApi.me();
        if (response.data?.user) {
          setUser(response.data.user);
          setIsLoggedIn(true);
        }
      } catch {
        // Token invalid/expired — clear it
        localStorage.removeItem('token');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Any API call answered 401 (token expired, account deactivated) ends the session.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setIsLoggedIn(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await authApi.login(username, password);
      if (response.data) {
        localStorage.setItem('token', response.data.token);
        try {
          const meResponse = await authApi.me();
          if (meResponse.data?.user) {
            setUser(meResponse.data.user);
          } else {
            setUser(response.data.user);
          }
        } catch {
          setUser(response.data.user);
        }
        setIsLoggedIn(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    authApi.logout().catch(() => { }); // Best effort server logout
    setUser(null);
    setIsLoggedIn(false);
  };

  const refreshUser = async () => {
    try {
      const response = await authApi.me();
      if (response.data?.user) {
        setUser(response.data.user);
      }
    } catch (err) {
      console.error('Failed to refresh user auth state:', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
