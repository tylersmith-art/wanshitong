import { getLogger } from "../../lib/logger.js";
import type { SummarizationAdapter } from "./types.js";

export function createConsoleSummarizationAdapter(): SummarizationAdapter {
  return {
    async summarize(params) {
      const limit = params.maxLength ?? 200;
      const summary = params.content.slice(0, limit);

      getLogger().info(
        { contentLength: params.content.length, summaryLength: summary.length },
        "Content summarized (console adapter — no AI summarization)",
      );

      return { success: true, summary };
    },
  };
}
