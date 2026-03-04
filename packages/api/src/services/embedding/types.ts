export type EmbedParams = {
  text: string;
  inputType?: "query" | "document";
};

export type EmbedResult = {
  success: boolean;
  embedding?: number[];
  dimensions?: number;
  error?: string;
};

export type EmbeddingAdapter = {
  embed(params: EmbedParams): Promise<EmbedResult>;
};
