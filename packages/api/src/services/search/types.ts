export type SearchParams = {
  embedding: number[];
  projectId?: string;
  limit?: number;
  threshold?: number;
};

export type ConfidenceTier = "high" | "moderate" | "low";

export type SearchResultItem = {
  specId: string;
  name: string;
  description: string;
  content: string;
  similarity: number;
  confidence: ConfidenceTier;
};

export type SearchResult = {
  success: boolean;
  results?: SearchResultItem[];
  error?: string;
};

export type SearchAdapter = {
  search(params: SearchParams): Promise<SearchResult>;
};
