import type { FetchLike } from './strava';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MistralClientOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

/**
 * Minimal Mistral API chat client (https://api.mistral.ai/v1/chat/completions).
 */
export class MistralClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  readonly model: string;

  constructor(private readonly opts: MistralClientOptions) {
    if (!opts.apiKey) throw new Error('MistralClient requires an API key');
    this.model = opts.model ?? 'mistral-small-latest';
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.baseUrl = (opts.baseUrl ?? 'https://api.mistral.ai/v1').replace(/\/$/, '');
  }

  async chat(messages: ChatMessage[], overrides: { temperature?: number } = {}): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: overrides.temperature ?? 0.4,
      }),
    });
    if (!res.ok) throw new Error(`Mistral API error (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Mistral API returned no message content');
    return content;
  }
}

function defaultFetch(): ReturnType<FetchLike> {
  throw new Error(
    'No fetch implementation provided. Pass fetchImpl (e.g. globalThis.fetch in Node 18+) in MistralClientOptions.',
  );
}
