import { getLogger } from "../../lib/logger.js";
import type { EmbeddingAdapter } from "./types.js";

const DIMENSIONS = 1024;

export function createConsoleEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embed(params) {
      getLogger().info(
        { textLength: params.text.length },
        "Embedding generated (console adapter — zero vector)",
      );
      return {
        success: true,
        embedding: new Array(DIMENSIONS).fill(0),
        dimensions: DIMENSIONS,
      };
    },
  };
}
