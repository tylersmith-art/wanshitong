import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { getEnv } from "../lib/env.js";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getConnectionString(): string {
  return getEnv().DATABASE_URL;
}

export function getDb() {
  if (!cachedDb) {
    const client = postgres(getConnectionString());
    cachedDb = drizzle(client, { schema });
  }
  return cachedDb;
}
