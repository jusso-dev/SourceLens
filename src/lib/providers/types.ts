export interface EmbeddingProvider {
  name: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface RerankCandidate {
  chunkId: string;
  text: string;
  score?: number;
}

export interface RerankScore {
  chunkId: string;
  score: number;
}

export interface Reranker {
  name: string;
  model: string;
  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankScore[]>;
}

export interface ChatProvider {
  name: string;
  model: string;
  answer(input: ChatInput): Promise<ChatResult>;
  stream?(input: ChatInput): AsyncIterable<StreamEvent>;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: ChatResult };

export interface ChatInput {
  question: string;
  contexts: Array<{
    id: string;
    documentId: string;
    filename: string;
    chunkIndex: number;
    text: string;
    score: number;
    /** Prompt-injection / sanitisation findings on this chunk. Populated by
     *  the Ask route; surfaced to the model as a `warnings="..."` attribute
     *  on the wrapping <source> block. */
    flags?: string[];
  }>;
  systemPrompt?: string;
}

export interface ChatResult {
  answer: string;
  provider: string;
  model: string;
}
