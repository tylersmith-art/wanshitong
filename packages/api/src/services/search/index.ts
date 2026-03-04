import { getDb } from "../../db/index.js";
import type { SearchAdapter } from "./types.js";
import { createPgVectorSearchAdapter } from "./pgvector.js";

export type {
  SearchAdapter,
  SearchParams,
  SearchResultItem,
  SearchResult,
} from "./types.js";

let instance: SearchAdapter | null = null;

export function getSearchAdapter(): SearchAdapter {
  if (instance) return instance;
  instance = createPgVectorSearchAdapter({ db: getDb() });
  return instance;
}

export function setSearchAdapter(adapter: SearchAdapter): void {
  instance = adapter;
}

export function resetSearchAdapter(): void {
  instance = null;
}
