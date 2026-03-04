import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHelpCommand, getHelpText } from "./help.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("helpCommand", () => {
  async function runHelp(): Promise<string> {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...msgArgs: unknown[]) => logs.push(msgArgs.join(" "));

    try {
      const cmd = createHelpCommand();
      await cmd.parseAsync(["node", "help"]);
    } finally {
      console.log = originalLog;
    }

    return logs.join("\n");
  }

  it("contains all command descriptions (init, arc, help)", async () => {
    const output = await runHelp();

    expect(output).toContain("wst init <projectName>");
    expect(output).toContain("Configure API key and connect a project");
    expect(output).toContain("wst arc '<query>'");
    expect(output).toContain("Search architecture specs");
    expect(output).toContain("wst help");
    expect(output).toContain("Show this help message");
  });

  it("contains example usage", async () => {
    const output = await runHelp();

    expect(output).toContain("Examples:");
    expect(output).toContain("wst init my-app --key wst_abc123");
    expect(output).toContain("wst arc 'authentication patterns'");
    expect(output).toContain("wst arc 'database schema design' --limit 10");
  });

  it("contains configuration info", async () => {
    const output = await runHelp();

    expect(output).toContain("Configuration:");
    expect(output).toContain("Config is stored at ~/.wst/config.json");
    expect(output).toContain("Run 'wst init' to set up your project.");
  });
});

describe("getHelpText", () => {
  it("returns the same text that the command prints", () => {
    const text = getHelpText();

    expect(text).toContain("wst - Wan Shi Tong CLI");
    expect(text).toContain("wst init <projectName>");
    expect(text).toContain("wst arc '<query>'");
    expect(text).toContain("wst help");
  });
});
