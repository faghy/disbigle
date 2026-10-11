import { endpoints } from '../api/endpoints.ts';

/** A solved sign-up challenge, sent along with the registration. */
export interface BotCheckAnswer {
  challenge: string;
  nonce: string;
}

const encoder = new TextEncoder();

function leadingZeroBits(hash: Uint8Array): number {
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

/** Finds a nonce whose SHA-256 of `salt:nonce` starts with `difficulty` zero bits. */
export async function solveProofOfWork(salt: string, difficulty: number): Promise<string> {
  const batch = 256;
  for (let start = 0; ; start += batch) {
    const hashes = await Promise.all(
      Array.from({ length: batch }, (_, i) =>
        crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${start + i}`)),
      ),
    );
    const found = hashes.findIndex((h) => leadingZeroBits(new Uint8Array(h)) >= difficulty);
    if (found >= 0) return String(start + found);
  }
}

/**
 * Fetches and solves the anti-robot challenge in the background while the person fills in the
 * form. Resolves to null when the server does not ask for one (or cannot be reached: the server
 * then decides).
 */
export async function prepareBotCheck(): Promise<BotCheckAnswer | null> {
  try {
    const { challenge, salt, difficulty } = await endpoints.registerChallenge();
    if (!challenge || !salt || !difficulty) return null;
    return { challenge, nonce: await solveProofOfWork(salt, difficulty) };
  } catch {
    return null;
  }
}
