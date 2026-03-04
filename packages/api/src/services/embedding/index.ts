import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { EmbeddingAdapter } from "./types.js";
import { createConsoleEmbeddingAdapter } from "./console.js";
import { createAnthropicEmbeddingAdapter } from "./anthropic.js";

export type { EmbeddingAdapter, EmbedParams, EmbedResult } from "./types.js";

let instance: EmbeddingAdapter | null = null;

export function getEmbeddingAdapter(): EmbeddingAdapter {
  if (instance) return instance;

  const env = getEnv();
  const provider = env.EMBEDDING_PROVIDER;

  switch (provider) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error(
          "EMBEDDING_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set",
        );
      }
      getLogger().info("Embedding adapter: Anthropic/Voyage");
      instance = createAnthropicEmbeddingAdapter({
        apiKey: env.ANTHROPIC_API_KEY,
      });
      break;
    }

    default:
      getLogger().info("Embedding adapter: console (no EMBEDDING_PROVIDER set)");
      instance = createConsoleEmbeddingAdapter();
      break;
  }

  return instance;
}

export function setEmbeddingAdapter(adapter: EmbeddingAdapter): void {
  instance = adapter;
}

export function resetEmbeddingAdapter(): void {
  instance = null;
}
