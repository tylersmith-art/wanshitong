import { Command } from "commander";

const HELP_TEXT = `wst - Wan Shi Tong CLI

Architecture knowledge search for your projects.

Commands:
  wst init <projectName>     Configure API key and connect a project
    --key <apiKey>           API key (skips interactive prompt)
    --url <apiUrl>           Server URL (default: http://localhost:3000/api/trpc)

  wst arc '<query>'          Search architecture specs
    --limit <n>              Max results (default: 5)

  wst help                   Show this help message

Examples:
  wst init my-app --key wst_abc123
  wst arc 'authentication patterns'
  wst arc 'database schema design' --limit 10

Configuration:
  Config is stored at ~/.wst/config.json
  Run 'wst init' to set up your project.`;

export function getHelpText(): string {
  return HELP_TEXT;
}

export function createHelpCommand(): Command {
  return new Command("help")
    .description("Show help message")
    .action(() => {
      console.log(HELP_TEXT);
    });
}

export const helpCommand = createHelpCommand();
