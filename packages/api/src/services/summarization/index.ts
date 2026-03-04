import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { SummarizationAdapter } from "./types.js";
import { createConsoleSummarizationAdapter } from "./console.js";
import { createAnthropicSummarizationAdapter } from "./anthropic.js";

export type {
  SummarizationAdapter,
  SummarizeParams,
  SummarizeResult,
} from "./types.js";

let instance: SummarizationAdapter | null = null;

export function getSummarizationAdapter(): SummarizationAdapter {
  if (instance) return instance;

  const env = getEnv();
  const provider = env.SUMMARIZATION_PROVIDER;

  switch (provider) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error(
          "SUMMARIZATION_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set",
        );
      }
      getLogger().info("Summarization adapter: Anthropic");
      instance = createAnthropicSummarizationAdapter({
        apiKey: env.ANTHROPIC_API_KEY,
      });
      break;
    }

    default:
      getLogger().info(
        "Summarization adapter: console (no SUMMARIZATION_PROVIDER set)",
      );
      instance = createConsoleSummarizationAdapter();
      break;
  }

  return instance;
}

export function setSummarizationAdapter(adapter: SummarizationAdapter): void {
  instance = adapter;
}

export function resetSummarizationAdapter(): void {
  instance = null;
}
