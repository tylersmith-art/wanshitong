export type SearchParams = {
  embedding: number[];
  projectId?: string;
  limit?: number;
  threshold?: number;
};

export type SearchResultItem = {
  specId: string;
  name: string;
  description: string;
  content: string;
  similarity: number;
};

export type SearchResult = {
  success: boolean;
  results?: SearchResultItem[];
  error?: string;
};

export type SearchAdapter = {
  search(params: SearchParams): Promise<SearchResult>;
};
