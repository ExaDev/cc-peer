/**
 * Protocol limits, each named after the rule it encodes. Values derive from the receiver's own grammar (verified against Claude Code 2.1.269): peer tokens are 16-byte hex, hop ids are 12-byte hex, the hop chain holds at most 32 ids at the grammar level with the runaway guard at 28, and the envelope attribute caps mirror the receiver's parser regexes.
 */
export const PEER_TOKEN_BYTES = 16;
export const HOP_ID_BYTES = 12;
export const SHA256_HEX_LENGTH = 64;
export const MAX_HOP_CHAIN_ENTRIES = 32;
export const MAX_ADDRESS_CHARS = 300;
export const MAX_SESSION_REF_CHARS = 80;
export const MAX_FROM_NAME_CHARS = 80;
export const MAX_ATTACHMENTS_PER_MESSAGE = 16;
export const MAX_YIELD_SLUGS = 16;
export const MAX_SLUG_CHARS = 128;
export const MAX_MSG_ID_CHARS = 128;
export const MAX_SESSION_ID_CHARS = 512;
export const MAX_ADDRESS_FIELD_CHARS = 512;

const hex = (bytes: number) => bytes * 2;

export const PEER_TOKEN_HEX_LENGTH = hex(PEER_TOKEN_BYTES);
export const HOP_ID_HEX_LENGTH = hex(HOP_ID_BYTES);

/**
 * Lint-clean string form of a numeric limit for regex interpolation;
 * `restrict-template-expressions` rejects numbers inside template literals.
 */
export const count = (n: number): string => String(n);
