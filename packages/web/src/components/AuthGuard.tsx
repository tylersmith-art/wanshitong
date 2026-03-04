import { useAuth0 } from "@auth0/auth0-react";
import { useEffect } from "react";

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      loginWithRedirect();
    }
  }, [isLoading, isAuthenticated, loginWithRedirect]);

  if (isLoading)
    return <div className="text-center p-8 text-gray-500">Loading...</div>;
  if (!isAuthenticated) return null;

  return <>{children}</>;
}
