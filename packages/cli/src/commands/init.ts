import { Command } from "commander";

export const initCommand = new Command("init")
  .description("Configure the WST CLI with your API key and server URL")
  .action(async () => {
    console.log("wst init - TODO: implement interactive setup");
  });
