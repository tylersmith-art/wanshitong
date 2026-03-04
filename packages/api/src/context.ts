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
};

export function createContextFactory(pubsub: PgPubSub) {
  return async function createContext({
    req,
  }: CreateExpressContextOptions): Promise<Context> {
    let user: JWTPayload | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      user = await verifyToken(token);
    }

    return { user, db: getDb(), pubsub };
  };
}

export function createWSContextFactory(pubsub: PgPubSub) {
  return async function createWSContext(
    opts: CreateWSSContextFnOptions,
  ): Promise<Context> {
    let user: JWTPayload | null = null;

    const token = opts.info.connectionParams?.token as string | undefined;
    if (token) {
      user = await verifyToken(token);
    }

    return { user, db: getDb(), pubsub };
  };
}
