import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getEnv } from "../lib/env.js";

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!JWKS) {
    const { AUTH0_ISSUER_BASE_URL } = getEnv();
    JWKS = createRemoteJWKSet(
      new URL(`${AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json`)
    );
  }
  return JWKS;
}

export async function verifyToken(
  token: string
): Promise<JWTPayload | null> {
  try {
    const { AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE } = getEnv();
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: `${AUTH0_ISSUER_BASE_URL}/`,
      audience: AUTH0_AUDIENCE,
    });
    return payload;
  } catch {
    return null;
  }
}
