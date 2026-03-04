import type { IncomingMessage, ServerResponse } from "node:http";
import pinoHttp from "pino-http";
import type { HttpLogger } from "pino-http";
import { getLogger } from "../lib/logger.js";

let cachedRequestLogger: HttpLogger | null = null;

export function getRequestLogger(): HttpLogger {
  if (!cachedRequestLogger) {
    cachedRequestLogger = pinoHttp({
      logger: getLogger(),
      customLogLevel(_req: IncomingMessage, res: ServerResponse, err: Error | undefined) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      autoLogging: {
        ignore(req: IncomingMessage) {
          return req.url === "/api/health";
        },
      },
    });
  }
  return cachedRequestLogger;
}
