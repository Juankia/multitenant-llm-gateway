import { createHash } from 'node:crypto';
import { type EmbeddingProvider } from './semantic-cache';

/**
 * Dependency-free embedder (feature hashing of word unigrams + character trigrams, L2-normalized).
 * It captures lexical similarity ("opening hours?" ~ "what are your opening hours"), which is
 * enough for FAQ-style chatbot traffic and keeps tests offline. It does NOT understand negation
 * or paraphrase - plug a real embedding model through EmbeddingProvider for production.
 */
export class LocalHashingEmbedder implements EmbeddingProvider {
  constructor(private readonly dimensions = 512) {}

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    for (const word of words) this.add(vector, `w:${word}`, 1);
    for (const word of words) {
      const padded = `#${word}#`;
      for (let i = 0; i + 3 <= padded.length; i++) this.add(vector, `t:${padded.slice(i, i + 3)}`, 0.5);
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }

  private add(vector: number[], feature: string, weight: number): void {
    const digest = createHash('md5').update(feature).digest();
    const index = digest.readUInt32BE(0) % this.dimensions;
    const sign = (digest[4]! & 1) === 0 ? 1 : -1;
    vector[index]! += sign * weight;
  }
}
