import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { writeConfig } from "../lib/config.js";
import { searchSpecs } from "../lib/api.js";

const DEFAULT_API_URL = "https://wanshitong.tylermakes.art/api/trpc";

const WST_MARKER = "Wan Shi Tong - Architecture Knowledge";

function buildWstBlock(projectName: string): string {
  return `\n## ${WST_MARKER}

When you need architecture guidance, use the \`wst\` CLI:
- \`wst arc '<query>'\` — Search for relevant architecture specs
- Example: \`wst arc 'authentication patterns'\`

This project is connected to the Wan Shi Tong knowledge library.
Project: ${projectName}
`;
}

function promptForInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function validateApiKey(
  apiKey: string,
  apiUrl: string,
): Promise<boolean> {
  try {
    await searchSpecs({ query: "test", limit: 1 }, { apiKey, apiUrl });
    return true;
  } catch {
    return false;
  }
}

function updateClaudeMd(projectName: string, cwd: string): boolean {
  const claudeMdPath = join(cwd, "CLAUDE.md");
  let content = "";

  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, "utf-8");
  }

  if (content.includes(WST_MARKER)) {
    console.log("CLAUDE.md already contains WST configuration. Skipping.");
    return false;
  }

  const block = buildWstBlock(projectName);
  writeFileSync(claudeMdPath, content + block, "utf-8");
  return true;
}

export const initCommand = new Command("init")
  .description("Configure the WST CLI with your API key and server URL")
  .argument("<projectName>", "Name of the project to connect")
  .option("--key <apiKey>", "API key for authentication")
  .option("--url <apiUrl>", "API server URL", DEFAULT_API_URL)
  .action(
    async (
      projectName: string,
      options: { key?: string; url: string },
    ) => {
      const apiUrl = options.url;

      let apiKey = options.key;
      if (!apiKey) {
        apiKey = await promptForInput("Enter your API key: ");
      }

      if (!apiKey) {
        console.error("Error: API key is required.");
        process.exitCode = 1;
        return;
      }

      console.log("Validating API key...");
      const isValid = await validateApiKey(apiKey, apiUrl);
      if (!isValid) {
        console.error(
          "Error: API key validation failed. Please check your key and server URL.",
        );
        process.exitCode = 1;
        return;
      }

      writeConfig({ apiKey, apiUrl, projectId: projectName });
      console.log("Configuration saved to ~/.wst/config.json");

      const updated = updateClaudeMd(projectName, process.cwd());
      if (updated) {
        console.log("CLAUDE.md updated with WST configuration.");
      }

      console.log(`WST initialized for project: ${projectName}`);
    },
  );

export { buildWstBlock, validateApiKey, updateClaudeMd, WST_MARKER };
