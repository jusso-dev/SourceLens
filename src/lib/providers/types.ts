export interface EmbeddingProvider {
  name: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChatProvider {
  name: string;
  model: string;
  answer(input: ChatInput): Promise<ChatResult>;
}

export interface ChatInput {
  question: string;
  contexts: Array<{
    id: string;
    documentId: string;
    filename: string;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
  systemPrompt?: string;
}

export interface ChatResult {
  answer: string;
  provider: string;
  model: string;
}
