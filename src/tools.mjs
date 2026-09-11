import { createHash } from 'node:crypto';

export const TOOLS = Object.freeze([
  { name: 'document.digest', label: 'Document fingerprint', cost: '20', description: 'SHA-256 fingerprint and document statistics.' },
  { name: 'text.redact', label: 'Redact contact details', cost: '30', description: 'Replace email addresses and common phone patterns.' },
  { name: 'text.summarize', label: 'Extract key sentences', cost: '40', description: 'Select up to three sentences; deterministic, no language model.' },
]);

/** Deliberately side-effect-free tools: recovery never repeats a payment or network call. */
export function runTool(name, input) {
  const text = input.text;
  if (name === 'document.digest') return {
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    characters: [...text].length,
    words: text.trim().split(/\s+/u).filter(Boolean).length,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
  if (name === 'text.redact') {
    let replacements = 0;
    const redact = () => { replacements++; return '[REDACTED]'; };
    const redacted = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, redact)
      .replace(/(?<!\w)(?:\+\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-])\d{3}[ .-]\d{4}(?!\w)/g, redact);
    return { text: redacted, replacements, method: 'Pattern matching; not a complete PII detector' };
  }
  if (name === 'text.summarize') {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/gu)?.map(s => s.trim()).filter(Boolean) ?? [];
    return { summary: sentences.slice(0, 3).join(' '), selected: Math.min(3, sentences.length), totalSentences: sentences.length, method: 'First-three-sentence extraction; no LLM' };
  }
  throw new Error('Unknown tool');
}
