import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { type CoreContext, DomainError } from '@disbigle/core';
import { z } from 'zod';

/**
 * Keeps bots away from sign-up without third-party captchas. The browser gets a signed
 * challenge, solves a small proof of work while the person fills in the form, and sends it
 * back with the registration. A hidden "website" field catches form-filling robots, and a
 * challenge answered too fast (or twice, or too late) is refused.
 */
export const POW_BITS = 16;
const MIN_AGE_MS = 3_000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const registrationGuardSchema = z.object({
  challenge: z.string().max(512).optional(),
  nonce: z.string().max(32).optional(),
  /** Honeypot: invisible to people, filled in by bots. */
  website: z.string().max(500).optional(),
});
export type RegistrationGuardInput = z.infer<typeof registrationGuardSchema>;

interface ChallengePayload {
  s: string;
  d: number;
  t: number;
}

const sign = (secret: string, data: string) =>
  createHmac('sha256', secret).update(`registration:${data}`).digest('base64url');

export function issueChallenge(ctx: CoreContext, now = Date.now()) {
  const payload: ChallengePayload = {
    s: randomBytes(16).toString('base64url'),
    d: POW_BITS,
    t: now,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    challenge: `${data}.${sign(ctx.config.SESSION_SECRET, data)}`,
    salt: payload.s,
    difficulty: payload.d,
  };
}

/** Leading zero bits of a buffer. */
export function leadingZeroBits(hash: Buffer): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export const powHash = (salt: string, nonce: string) =>
  createHash('sha256').update(`${salt}:${nonce}`).digest();

/** Finds a nonce for a salt (tests and tools; the browser has its own solver). */
export function solveChallenge(salt: string, difficulty: number): string {
  for (let n = 0; ; n++) {
    if (leadingZeroBits(powHash(salt, String(n))) >= difficulty) return String(n);
  }
}

const refuse = () => {
  throw new DomainError(
    'bot_check_failed',
    'The anti-robot check failed. Reload the page and try again.',
  );
};

/**
 * Checks the anti-robot answer. Returns a function that marks the challenge as used: call it
 * once the account exists, so a sign-up refused for another reason (a taken username) can be
 * sent again with the same answer.
 */
export async function verifyRegistrationGuard(
  ctx: CoreContext,
  input: RegistrationGuardInput,
  now = Date.now(),
): Promise<() => Promise<void>> {
  if (input.website?.trim()) refuse();
  const [data, signature] = (input.challenge ?? '').split('.');
  if (!data || !signature || input.nonce === undefined) refuse();
  const expected = Buffer.from(sign(ctx.config.SESSION_SECRET, data as string));
  const given = Buffer.from(signature as string);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) refuse();
  let payload: ChallengePayload;
  try {
    payload = JSON.parse(Buffer.from(data as string, 'base64url').toString('utf8'));
  } catch {
    return refuse();
  }
  const age = now - payload.t;
  if (!(age >= MIN_AGE_MS && age <= MAX_AGE_MS)) refuse();
  if (
    payload.d < POW_BITS ||
    leadingZeroBits(powHash(payload.s, input.nonce as string)) < payload.d
  )
    refuse();
  const usedKey = `registration-challenge:${payload.s}`;
  if (await ctx.kv.get(usedKey)) refuse();
  return () => ctx.kv.set(usedKey, '1', Math.ceil(MAX_AGE_MS / 1000));
}
