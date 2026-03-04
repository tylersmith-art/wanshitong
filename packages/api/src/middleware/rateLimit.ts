import rateLimit from "express-rate-limit";
import { getEnv } from "../lib/env.js";

let cachedGlobalLimiter: ReturnType<typeof rateLimit> | null = null;

export function getGlobalLimiter() {
  if (!cachedGlobalLimiter) {
    cachedGlobalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: parseInt(getEnv().RATE_LIMIT_MAX, 10),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    });
  }
  return cachedGlobalLimiter;
}

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
