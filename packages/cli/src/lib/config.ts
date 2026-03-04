import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface WstConfig {
  apiKey?: string;
  apiUrl?: string;
  projectId?: string;
}

const CONFIG_DIR = join(homedir(), ".wst");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFile(): string {
  return CONFIG_FILE;
}

export function readConfig(): WstConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  const raw = readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as WstConfig;
}

export function writeConfig(config: WstConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}
