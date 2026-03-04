#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { arcCommand } from "./commands/arc.js";

const program = new Command();
program
  .name("wst")
  .description("Wan Shi Tong CLI - Architecture knowledge search")
  .version("0.0.0");

program.addCommand(initCommand);
program.addCommand(arcCommand);

program.parse();
