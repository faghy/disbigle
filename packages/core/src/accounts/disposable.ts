import { DISPOSABLE_DOMAINS_TEXT } from './disposable-domains.ts';

let domains: Set<string> | null = null;

/** Whether an address is at a throwaway mail service (or a subdomain of one). */
export function isDisposableEmail(email: string): boolean {
  domains ??= new Set(DISPOSABLE_DOMAINS_TEXT.split('\n'));
  const host = email
    .slice(email.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase();
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (domains.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
