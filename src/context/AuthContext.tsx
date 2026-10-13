import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole = 'admin' | 'supervisor' | 'personnel' | 'viewer';

export interface UserSession {
  username: string;
  role: UserRole;
  displayName: string;
  supervisorId?: string;
  personnelId?: string;
  defaultJobsiteId?: string;
  jobsiteIds?: string[];
  loginTime: string;
  token?: string;
}

interface AuthContextType {
  user: UserSession | null;
  isAuthenticated: boolean;
  login: (pin: string, preferredRole?: UserRole, supervisorId?: string, username?: string, personnelId?: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  hasPermission: (requiredRole: 'admin' | 'supervisor' | 'personnel' | 'viewer') => boolean;
  changePassword: (oldPin: string, newPin: string) => Promise<{ success: boolean; message?: string }>;
  adminChangePassword: (targetSupervisorId: string, newPin: string) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('ges_auth_session');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Session parse error:', e);
    }
    return null;
  });

  const isAuthenticated = !!user;

  useEffect(() => {
    if (user) {
      localStorage.setItem('ges_auth_session', JSON.stringify(user));
    } else {
      localStorage.removeItem('ges_auth_session');
    }
  }, [user]);

  const login = async (
    pin: string,
    preferredRole?: UserRole,
    supervisorId?: string,
    username?: string,
    personnelId?: string
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, preferredRole, supervisorId, username, personnelId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const session: UserSession = {
          username: data.user.username,
          role: data.user.role,
          displayName: data.user.displayName,
          supervisorId: data.user.supervisorId,
          personnelId: data.user.personnelId,
          defaultJobsiteId: data.user.defaultJobsiteId,
          jobsiteIds: data.user.jobsiteIds,
          loginTime: new Date().toISOString(),
          token: data.token
        };
        setUser(session);
        return { success: true };
      } else {
        return { success: false, message: data.error || 'Geçersiz Giriş Kodu veya Şifre!' };
      }
    } catch (err) {
      return { success: false, message: 'Sunucu bağlantı hatası oluştu.' };
    }
  };

  const changePassword = async (oldPin: string, newPin: string): Promise<{ success: boolean; message?: string }> => {
    if (!user) return { success: false, message: 'Oturum açık değil.' };
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          supervisorId: user.supervisorId || user.personnelId,
          oldPin,
          newPin
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      } else {
        return { success: false, message: data.error || 'Şifre değiştirilemedi!' };
      }
    } catch (err) {
      return { success: false, message: 'Sunucu bağlantı hatası.' };
    }
  };

  const adminChangePassword = async (targetSupervisorId: string, newPin: string): Promise<{ success: boolean; message?: string }> => {
    if (!user || user.role !== 'admin') {
      return { success: false, message: 'Bu işlem için Yönetici yetkisi gereklidir!' };
    }
    try {
      const res = await fetch('/api/auth/admin-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSupervisorId,
          newPin
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      } else {
        return { success: false, message: data.error || 'Şef şifresi güncellenemedi!' };
      }
    } catch (err) {
      return { success: false, message: 'Sunucu bağlantı hatası.' };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('ges_auth_session');
    try {
      sessionStorage.removeItem('report_pin_unlocked_3255');
    } catch (_) {}
  };

  const hasPermission = (requiredRole: 'admin' | 'supervisor' | 'personnel' | 'viewer'): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (requiredRole === 'supervisor' && user.role === 'supervisor') return true;
    if (requiredRole === 'personnel' && (user.role === 'personnel' || user.role === 'supervisor')) return true;
    if (requiredRole === 'viewer') return true;
    return false;
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout, hasPermission, changePassword, adminChangePassword }}>
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

