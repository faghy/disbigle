import { randomBytes } from 'node:crypto';

/**
 * Generates a UUIDv7 (RFC 9562): 48-bit Unix timestamp in milliseconds followed by random bits.
 * IDs sort by creation time, which keeps indexes compact and makes cursor pagination trivial.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
