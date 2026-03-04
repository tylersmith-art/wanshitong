import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import type { JWTPayload } from "jose";
import { verifyToken } from "./middleware/auth.js";
import { getDb } from "./db/index.js";
import type { PgPubSub } from "./pubsub.js";

export type Context = {
  user: JWTPayload | null;
  db: ReturnType<typeof getDb>;
  pubsub: PgPubSub;
  rawToken: string | null;
};

export function createContextFactory(pubsub: PgPubSub) {
  return async function createContext({
    req,
  }: CreateExpressContextOptions): Promise<Context> {
    let user: JWTPayload | null = null;
    let rawToken: string | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      rawToken = authHeader.slice(7);
      // Only verify as JWT if it doesn't look like an API key
      if (!rawToken.startsWith("wst_")) {
        user = await verifyToken(rawToken);
      }
    }

    return { user, db: getDb(), pubsub, rawToken };
  };
}

export function createWSContextFactory(pubsub: PgPubSub) {
  return async function createWSContext(
    opts: CreateWSSContextFnOptions,
  ): Promise<Context> {
    let user: JWTPayload | null = null;
    let rawToken: string | null = null;

    const token = opts.info.connectionParams?.token as string | undefined;
    if (token) {
      rawToken = token;
      if (!token.startsWith("wst_")) {
        user = await verifyToken(token);
      }
    }

    return { user, db: getDb(), pubsub, rawToken };
  };
}
