export interface SearchParams {
  query: string;
  projectId?: string;
  limit?: number;
}

export interface SearchResult {
  specId: string;
  name: string;
  description: string | null;
  content: string;
  similarity: number;
}

export interface SearchResponse {
  results: SearchResult[];
  durationMs: number;
}

export async function searchSpecs(
  params: SearchParams,
  config: { apiKey: string; apiUrl: string },
): Promise<SearchResponse> {
  const input = JSON.stringify(params);
  const encodedInput = encodeURIComponent(input);
  const url = `${config.apiUrl}/search.search?input=${encodedInput}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Search request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { result: { data: SearchResponse } };
  return data.result.data;
}
