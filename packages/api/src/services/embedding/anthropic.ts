import { getLogger } from "../../lib/logger.js";
import type { EmbeddingAdapter, EmbedParams, EmbedResult } from "./types.js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";

type VoyageResponse = {
  data: [{ embedding: number[] }];
  usage: { total_tokens: number };
};

export function createAnthropicEmbeddingAdapter(config: {
  apiKey: string;
}): EmbeddingAdapter {
  return {
    async embed(params: EmbedParams): Promise<EmbedResult> {
      try {
        const response = await fetch(VOYAGE_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: VOYAGE_MODEL,
            input: [params.text],
            input_type: "document",
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error(
            { status: response.status, body },
            "Voyage API error",
          );
          return {
            success: false,
            error: `Voyage API error: ${response.status}`,
          };
        }

        const json = (await response.json()) as VoyageResponse;
        const embedding = json.data[0].embedding;

        getLogger().info(
          { dimensions: embedding.length, tokens: json.usage.total_tokens },
          "Embedding generated (Anthropic/Voyage adapter)",
        );

        return {
          success: true,
          embedding,
          dimensions: embedding.length,
        };
      } catch (err) {
        getLogger().error({ err }, "Voyage embedding request failed");
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  };
}
