import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  useAuth0Config,
  exchangeCodeForTokens,
  getStoredAccessToken,
  getStoredUserInfo,
  storeUserInfo,
  getValidAccessToken,
  clearTokens,
} from "../lib/auth";

type AuthContextType = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { name?: string; email?: string; picture?: string } | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthContextType["user"]>(null);
  const { request, result, promptAsync } = useAuth0Config();

  // Check for existing session on mount
  useEffect(() => {
    (async () => {
      const token = await getStoredAccessToken();
      if (token) {
        setIsAuthenticated(true);
        const storedUser = await getStoredUserInfo();
        if (storedUser) {
          setUser(storedUser);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  // Handle auth redirect result
  useEffect(() => {
    if (
      result?.type === "success" &&
      result.params.code &&
      request?.codeVerifier
    ) {
      (async () => {
        const tokens = await exchangeCodeForTokens(
          result.params.code,
          request.codeVerifier!
        );
        setIsAuthenticated(true);
        if (tokens.idToken) {
          try {
            const payload = JSON.parse(atob(tokens.idToken.split(".")[1]));
            const userInfo = {
              name: payload.name,
              email: payload.email,
              picture: payload.picture,
            };
            setUser(userInfo);
            await storeUserInfo(userInfo);
          } catch {
            /* ignore decode errors */
          }
        }
      })();
    }
  }, [result, request]);

  const login = useCallback(async () => {
    await promptAsync();
  }, [promptAsync]);

  const logout = useCallback(async () => {
    await clearTokens();
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    return getValidAccessToken();
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, user, login, logout, getAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
