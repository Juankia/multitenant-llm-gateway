import { getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken';
import { type ChatMessage } from '../llm/llm.types';

/** Per-message framing overhead used by OpenAI's chat format (role + separators). */
const TOKENS_PER_MESSAGE = 4;
const TOKENS_PER_REPLY_PRIMER = 3;

/**
 * Fallback token counter for providers/streams that don't report usage.
 * Uses OpenAI's BPE encodings (o200k for the GPT-4o/4.1 family, cl100k otherwise). For
 * non-OpenAI models this is an approximation (typically within ~10-20%), which is
 * acceptable for budget enforcement; the usage record is flagged `estimated: true`.
 */
export class TokenEstimator {
  private readonly encoders = new Map<TiktokenEncoding, Tiktoken>();

  countText(text: string, model = ''): number {
    if (!text) return 0;
    return this.encoder(model).encode(text).length;
  }

  countMessages(messages: ChatMessage[], model = ''): number {
    return (
      messages.reduce((sum, m) => sum + TOKENS_PER_MESSAGE + this.countText(m.content, model), 0) +
      TOKENS_PER_REPLY_PRIMER
    );
  }

  private encoder(model: string): Tiktoken {
    const encoding: TiktokenEncoding = /^(gpt-4o|gpt-4\.1|gpt-5|o\d)/.test(model) ? 'o200k_base' : 'cl100k_base';
    let encoder = this.encoders.get(encoding);
    if (!encoder) {
      encoder = getEncoding(encoding);
      this.encoders.set(encoding, encoder);
    }
    return encoder;
  }
}
