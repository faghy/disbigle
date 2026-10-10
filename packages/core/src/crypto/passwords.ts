import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// Argon2id (the library default) with OWASP-recommended parameters: 19 MiB, 2 iterations.
const options = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

/** Prefix of password hashes imported from a diaspora* pod (Devise bcrypt with a pepper). */
export const DIASPORA_BCRYPT_PREFIX = '$diaspora-bcrypt$';
/** `config.pepper` of diaspora's config/initializers/devise.rb, the same on every pod unless changed. */
const DIASPORA_PEPPER =
  process.env.DIASPORA_PASSWORD_PEPPER ??
  '065eb8798b181ff0ea2c5c16aee0ff8b70e04e2ee6bd6e08b49da46924223e39127d5335e466207d42bf2a045c12be5f90e92012a4f05f7fc6d9f3c875f4c95b';

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (passwordHash.startsWith(DIASPORA_BCRYPT_PREFIX)) {
    try {
      return await bcrypt.compare(
        `${password}${DIASPORA_PEPPER}`,
        passwordHash.slice(DIASPORA_BCRYPT_PREFIX.length),
      );
    } catch {
      return false;
    }
  }
  if (!passwordHash.startsWith('$argon2')) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A valid hash of a random password, used to keep timing constant when the user does not exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  return dummyHash;
}

/** True for hashes that should be replaced with Argon2id after a successful sign-in. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  return !passwordHash.startsWith('$argon2');
}
