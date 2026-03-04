import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { PushAdapter } from "./types.js";
import { createConsolePushAdapter } from "./console.js";
import { createExpoPushAdapter } from "./expo.js";

export type { PushAdapter, SendPushParams, SendPushResult } from "./types.js";

let instance: PushAdapter | null = null;

export function getPushAdapter(): PushAdapter {
  if (instance) return instance;

  const env = getEnv();
  const provider = env.PUSH_PROVIDER;

  switch (provider) {
    case "expo": {
      if (!env.EXPO_ACCESS_TOKEN) {
        throw new Error(
          "PUSH_PROVIDER=expo requires EXPO_ACCESS_TOKEN to be set",
        );
      }
      getLogger().info("Push adapter: Expo");
      instance = createExpoPushAdapter({
        accessToken: env.EXPO_ACCESS_TOKEN,
      });
      break;
    }

    default:
      getLogger().info("Push adapter: console (no PUSH_PROVIDER set)");
      instance = createConsolePushAdapter();
      break;
  }

  return instance;
}

export function setPushAdapter(adapter: PushAdapter): void {
  instance = adapter;
}

export function resetPushAdapter(): void {
  instance = null;
}
