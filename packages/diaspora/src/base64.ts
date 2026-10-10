// Base64 helpers mirroring Ruby's Base64 module, which the reference implementation uses.

/** Ruby `Base64.strict_encode64`: standard alphabet with padding. */
export function strictEncode64(data: Buffer | string): string {
  return Buffer.from(data).toString('base64');
}

/** Ruby `Base64.urlsafe_encode64`: URL-safe alphabet, padding kept. */
export function urlsafeEncode64(data: Buffer | string): string {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Lenient decoder accepting both alphabets, with or without padding, ignoring whitespace. */
export function decode64(text: string): Buffer {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(clean, 'base64');
}

/** True if `text` only contains characters of the (URL-safe or standard) base64 alphabets. */
export function isBase64(text: string): boolean {
  return /^[A-Za-z0-9+/_-]*={0,2}$/.test(text.replace(/\s+/g, ''));
}
