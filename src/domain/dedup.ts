/**
 * The receiver deduplicates on same sender + same body hash within a 30s window (NOT msg_id). Two frames with identical msg_id but different bodies both deliver; two with the same body within the window drop as "duplicate". Senders resending identical text must vary it or wait out the window.
 */
export const DEDUP_WINDOW_MS = 30_000;

/**
 * Append an invisible variation token that changes the body hash without changing what a human or model reads: a zero-width joiner after the final character, count-tracking so repeats keep differing. A zero-width space could alter rendering in some tooling; ZWJ after terminal punctuation is inert in practice, and if the receiver ever surfaces it verbatim the body still reads identically.
 */
export function varyBody(body: string, nth: number): string {
  const zwj = "‍";
  return body + zwj.repeat(nth + 1);
}
