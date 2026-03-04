import { Command } from "commander";

export const arcCommand = new Command("arc")
  .description("Search architecture specs")
  .action(async () => {
    console.log("wst arc - TODO: implement search");
  });
