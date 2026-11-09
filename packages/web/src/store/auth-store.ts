import { create } from 'zustand';
import { ApiClient } from '../api/client.js';

interface AuthState {
  isAuthenticated: boolean;
  isDaemonOnline: boolean;
  isChecking: boolean;
  currentClientId: string | null;
  checkHealth: () => Promise<boolean>;
  pairWithCode: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isDaemonOnline: true,
  isChecking: true,
  currentClientId: typeof window !== 'undefined' ? localStorage.getItem('tdl_client_id') : null,

  checkHealth: async () => {
    try {
      await ApiClient.getHealth();
      set({ isDaemonOnline: true, isChecking: false });
      return true;
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        set({ isDaemonOnline: true, isAuthenticated: false, isChecking: false });
        return true;
      }
      set({ isDaemonOnline: false, isChecking: false });
      return false;
    }
  },

  pairWithCode: async (code: string) => {
    try {
      const res = await ApiClient.pair(code);
      const clientId = res.client?.id || null;
      if (clientId && typeof window !== 'undefined') {
        localStorage.setItem('tdl_client_id', clientId);
      }
      set({ isAuthenticated: true, currentClientId: clientId });
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    try {
      await ApiClient.logout();
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tdl_client_id');
    }
    set({ isAuthenticated: false, currentClientId: null });
  },
}));
