import { create } from 'zustand';
import { ApiClient } from '../api/client.js';

interface AuthState {
  isAuthenticated: boolean;
  isDaemonOnline: boolean;
  isChecking: boolean;
  checkHealth: () => Promise<boolean>;
  pairWithCode: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isDaemonOnline: true,
  isChecking: true,

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
      await ApiClient.pair(code);
      set({ isAuthenticated: true });
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
    set({ isAuthenticated: false });
  },
}));
