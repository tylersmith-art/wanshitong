import { Command } from "commander";
import { readConfig } from "../lib/config.js";
import { searchSpecs } from "../lib/api.js";

export function createArcCommand(): Command {
  return new Command("arc")
    .description("Search architecture specs")
    .argument("<query>", "Search query for architecture specs")
    .option("--limit <n>", "Maximum number of results", "5")
    .action(async (query: string, options: { limit: string }) => {
      const config = readConfig();

      if (!config.apiKey) {
        console.error("No configuration found. Run `wst init` first.");
        process.exitCode = 1;
        return;
      }

      const limit = parseInt(options.limit, 10);

      let response;
      try {
        response = await searchSpecs(
          { query, projectId: config.projectId, limit },
          { apiKey: config.apiKey, apiUrl: config.apiUrl ?? "" },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.includes("401") || message.includes("403")) {
          console.error(
            "Authentication failed. Check your API key or run `wst init` again.",
          );
        } else {
          console.error(`Search failed: ${message}`);
        }
        process.exitCode = 1;
        return;
      }

      if (response.results.length === 0) {
        console.log(`No matching architecture specs found for: '${query}'`);
        return;
      }

      console.log(
        `Found ${response.results.length} result(s) for: '${query}' (took ${response.durationMs}ms)`,
      );

      for (const result of response.results) {
        console.log("---");
        const conf = (result as { confidence?: string }).confidence;
        const badge = conf ? ` [${conf}]` : "";
        console.log(
          `## ${result.name} (score: ${result.similarity.toFixed(2)})${badge}`,
        );
        if (result.description) {
          console.log(result.description);
        }
        console.log("");
        console.log(result.content);
      }
    });
}

export const arcCommand = createArcCommand();
