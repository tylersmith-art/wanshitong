import { getLogger } from "../../lib/logger.js";
import type { PushAdapter } from "./types.js";

export function createConsolePushAdapter(): PushAdapter {
  return {
    async send(params) {
      getLogger().info(
        { token: params.token, title: params.title },
        "Push notification sent (console adapter — not actually delivered)",
      );
      return { success: true };
    },

    async sendBatch(params) {
      return Promise.all(params.map((p) => this.send(p)));
    },
  };
}
