import pino from "pino";
import { getEnv } from "./env.js";

let cachedLogger: pino.Logger | null = null;

export function getLogger() {
  if (!cachedLogger) {
    const env = getEnv();
    cachedLogger = pino({
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV !== "production" && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    });
  }
  return cachedLogger;
}
