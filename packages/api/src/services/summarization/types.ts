export type SummarizeParams = {
  content: string;
  maxLength?: number;
};

export type SummarizeResult = {
  success: boolean;
  summary?: string;
  error?: string;
};

export type SummarizationAdapter = {
  summarize(params: SummarizeParams): Promise<SummarizeResult>;
};
