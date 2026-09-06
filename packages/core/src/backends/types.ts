export interface CompleteInput {
  systemPrompt: string
  userPrompt: string
  model?: string
  timeoutMs?: number
}

export interface CompleteResult {
  text: string
  tokensUsed: number
  model: string
}

export interface ModelBackend {
  complete(input: CompleteInput): Promise<CompleteResult>
}
