// diaspora* hashes passwords with Devise: bcrypt over `password + pepper`, where the pepper is
// `config.pepper` in diaspora's config/initializers/devise.rb (a constant shipped with diaspora*;
// pods normally never change it). bcrypt only reads the first 72 bytes of its input.
import bcrypt from 'bcryptjs';

/** Prefix that marks a password hash imported from diaspora*. */
export const DIASPORA_BCRYPT_PREFIX = '$diaspora-bcrypt$';

/** `config.pepper` of diaspora's config/initializers/devise.rb. */
export const DEFAULT_DIASPORA_PEPPER =
  '065eb8798b181ff0ea2c5c16aee0ff8b70e04e2ee6bd6e08b49da46924223e39127d5335e466207d42bf2a045c12be5f90e92012a4f05f7fc6d9f3c875f4c95b';

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** Wraps a Devise bcrypt hash for storage in `users.password_hash`, or null if it is not one. */
export function wrapDiasporaPasswordHash(encryptedPassword: string): string | null {
  return BCRYPT_RE.test(encryptedPassword) ? `${DIASPORA_BCRYPT_PREFIX}${encryptedPassword}` : null;
}

export const isDiasporaPasswordHash = (hash: string) => hash.startsWith(DIASPORA_BCRYPT_PREFIX);

/**
 * Checks a password against an imported diaspora* hash. Reference implementation of the branch
 * to add to the core's `verifyPassword`.
 */
export async function verifyDiasporaPassword(
  storedHash: string,
  password: string,
  pepper: string = DEFAULT_DIASPORA_PEPPER,
): Promise<boolean> {
  if (!isDiasporaPasswordHash(storedHash)) return false;
  try {
    return await bcrypt.compare(
      `${password}${pepper}`,
      storedHash.slice(DIASPORA_BCRYPT_PREFIX.length),
    );
  } catch {
    return false;
  }
}
