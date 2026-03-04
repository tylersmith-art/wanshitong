import { getLogger } from "../../lib/logger.js";
import type { PushAdapter, SendPushParams, SendPushResult } from "./types.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_LIMIT = 100;

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

export function createExpoPushAdapter(config: {
  accessToken: string;
}): PushAdapter {
  async function sendChunk(
    params: SendPushParams[],
  ): Promise<SendPushResult[]> {
    const messages = params.map((p) => ({
      to: p.token,
      title: p.title,
      body: p.body,
      data: p.data,
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        const body = await response.text();
        getLogger().error(
          { status: response.status, body },
          "Expo Push API error",
        );
        return params.map(() => ({
          success: false,
          error: `Expo Push error: ${response.status}`,
        }));
      }

      const json = (await response.json()) as { data: ExpoTicket[] };
      return json.data.map((ticket) => {
        if (ticket.status === "ok") {
          return { success: true };
        }
        const deviceNotRegistered =
          ticket.details?.error === "DeviceNotRegistered";
        getLogger().error(
          { error: ticket.message, deviceNotRegistered },
          "Expo push ticket error",
        );
        return {
          success: false,
          error: ticket.message,
          deviceNotRegistered,
        };
      });
    } catch (err) {
      getLogger().error({ err }, "Expo Push request failed");
      return params.map(() => ({
        success: false,
        error: (err as Error).message,
      }));
    }
  }

  return {
    async send(params) {
      const [result] = await this.sendBatch([params]);
      return result;
    },

    async sendBatch(params) {
      const results: SendPushResult[] = [];
      for (let i = 0; i < params.length; i += EXPO_BATCH_LIMIT) {
        const chunk = params.slice(i, i + EXPO_BATCH_LIMIT);
        const chunkResults = await sendChunk(chunk);
        results.push(...chunkResults);
      }
      return results;
    },
  };
}
