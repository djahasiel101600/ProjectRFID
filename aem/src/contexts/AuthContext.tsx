import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { User } from "../types";
import apiService from "../services/api";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean | null;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; first_name?: string; last_name?: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    const init = async () => {
      const storedUser = apiService.getUser();
      if (storedUser && apiService.isAuthenticated()) {
        setUser(storedUser);
        setNeedsSetup(false);
      } else {
        const status = await apiService.getSetupStatus();
        setNeedsSetup(status.needs_setup);
      }
      setIsLoading(false);
    };
    init();
  }, []);

  const login = async (username: string, password: string) => {
    const response = await apiService.login(username, password);
    setUser(response.user);
    setNeedsSetup(false);
  };

  const register = async (data: { username: string; email: string; password: string; first_name?: string; last_name?: string }) => {
    const response = await apiService.register(data);
    setUser(response.user);
    setNeedsSetup(false);
  };

  const logout = () => {
    apiService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        needsSetup,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
