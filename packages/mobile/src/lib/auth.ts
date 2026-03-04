import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

const AUTH0_DOMAIN =
  Constants.expoConfig?.extra?.auth0Domain ?? "YOUR_AUTH0_DOMAIN";
const AUTH0_CLIENT_ID =
  Constants.expoConfig?.extra?.auth0ClientId ?? "YOUR_CLIENT_ID";
const AUTH0_AUDIENCE =
  Constants.expoConfig?.extra?.auth0Audience ?? "YOUR_AUDIENCE";

const redirectUri = AuthSession.makeRedirectUri({ scheme: "TEMPLATE_SCHEME", path: "auth" });

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `https://${AUTH0_DOMAIN}/authorize`,
  tokenEndpoint: `https://${AUTH0_DOMAIN}/oauth/token`,
  revocationEndpoint: `https://${AUTH0_DOMAIN}/oauth/revoke`,
};

const TOKEN_KEY = "auth0_access_token";
const REFRESH_KEY = "auth0_refresh_token";
const USER_INFO_KEY = "auth0_user_info";

export function useAuth0Config() {
  const [request, result, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: AUTH0_CLIENT_ID,
      redirectUri,
      scopes: ["openid", "profile", "email", "offline_access"],
      extraParams: {
        audience: AUTH0_AUDIENCE,
      },
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery
  );

  return { request, result, promptAsync };
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
) {
  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      code,
      clientId: AUTH0_CLIENT_ID,
      redirectUri,
      extraParams: {
        code_verifier: codeVerifier,
      },
    },
    discovery
  );

  await SecureStore.setItemAsync(TOKEN_KEY, tokenResult.accessToken);
  if (tokenResult.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, tokenResult.refreshToken);
  }

  return {
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken ?? undefined,
    idToken: tokenResult.idToken ?? undefined,
  };
}

export async function getStoredAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return null;

  try {
    const tokenResult = await AuthSession.refreshAsync(
      {
        clientId: AUTH0_CLIENT_ID,
        refreshToken,
      },
      discovery
    );
    await SecureStore.setItemAsync(TOKEN_KEY, tokenResult.accessToken);
    if (tokenResult.refreshToken) {
      await SecureStore.setItemAsync(REFRESH_KEY, tokenResult.refreshToken);
    }
    return tokenResult.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

export async function storeUserInfo(info: { name?: string; email?: string; picture?: string }): Promise<void> {
  await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(info));
}

export async function getStoredUserInfo(): Promise<{ name?: string; email?: string; picture?: string } | null> {
  const stored = await SecureStore.getItemAsync(USER_INFO_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(USER_INFO_KEY);
}

export async function getValidAccessToken(): Promise<string> {
  const token = await getStoredAccessToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp * 1000 > Date.now() + 60_000) {
        return token;
      }
    } catch {
      // Fall through to refresh
    }
  }
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  throw new Error("No valid access token");
}
