import "dotenv/config";
import { validateEnv } from "./lib/env.js";
const env = validateEnv();

import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "./routers/index.js";
import { createContextFactory, createWSContextFactory } from "./context.js";
import { PgPubSub } from "./pubsub.js";
import { getConnectionString } from "./db/index.js";
import { getLogger } from "./lib/logger.js";
import { getRequestLogger } from "./middleware/requestLogger.js";
import { getGlobalLimiter } from "./middleware/rateLimit.js";
import { initJobs, closeJobs } from "./jobs/index.js";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(getGlobalLimiter());
app.use(getRequestLogger());

const pubsub = new PgPubSub(getConnectionString());
const createContext = createContextFactory(pubsub);
const createWSContext = createWSContextFactory(pubsub);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/api/trpc" });
const wssHandler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: createWSContext,
});

async function start() {
  await initJobs(getConnectionString());

  server.listen(env.PORT, () => {
    getLogger().info(`API server listening on http://localhost:${env.PORT}`);
    getLogger().info(`WebSocket server listening on ws://localhost:${env.PORT}/api/trpc`);
  });
}

async function shutdown() {
  getLogger().info("Shutting down...");
  wssHandler.broadcastReconnectNotification();
  wss.close();
  server.close();
  pubsub.close();
  await closeJobs();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((err) => {
  getLogger().error({ err }, "Failed to start server");
  process.exit(1);
});
