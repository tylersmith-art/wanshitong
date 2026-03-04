import { getLogger } from "../../lib/logger.js";
import type { SummarizationAdapter, SummarizeParams, SummarizeResult } from "./types.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type AnthropicMessage = {
  content: Array<{ type: string; text: string }>;
};

export function createAnthropicSummarizationAdapter(config: {
  apiKey: string;
}): SummarizationAdapter {
  return {
    async summarize(params: SummarizeParams): Promise<SummarizeResult> {
      try {
        const response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: params.maxLength ?? 300,
            system:
              "You are a technical summarizer. Produce a concise summary of the following architecture specification. The summary should be suitable for vector embedding and semantic search. Focus on key technologies, patterns, constraints, and decisions.",
            messages: [{ role: "user", content: params.content }],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error(
            { status: response.status, body },
            "Anthropic Messages API error",
          );
          return {
            success: false,
            error: `Anthropic API error: ${response.status}`,
          };
        }

        const json = (await response.json()) as AnthropicMessage;
        const summary = json.content[0].text;

        getLogger().info(
          { contentLength: params.content.length, summaryLength: summary.length },
          "Content summarized via Anthropic",
        );

        return { success: true, summary };
      } catch (err) {
        getLogger().error({ err }, "Anthropic summarization request failed");
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  };
}
