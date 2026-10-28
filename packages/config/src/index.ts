import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  LOCAL_DOMAIN: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  REGISTRATION_MODE: z.enum(['open', 'approval', 'invite', 'closed']).default('open'),
  MEDIA_DIR: z.string().default('./storage/media'),
  INSTANCE_TITLE: z.string().default('Disbigle'),
  INSTANCE_DESCRIPTION: z.string().default(''),
  /** Optional Matomo for the web client (cookieless page views, no personal data). */
  MATOMO_URL: z.url().optional(),
  MATOMO_SITE_ID: z.coerce.number().int().positive().optional(),
  /** SMTP connection URL, e.g. smtps://user:pass@mail.example.org:465. Without it, emails are logged. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Disbigle <noreply@localhost>'),
});

export type Config = z.infer<typeof configSchema>;

/** Parses and validates configuration from environment variables. Throws on invalid input. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * The host of the web address. It differs from LOCAL_DOMAIN on a split-domain setup, where
 * handles are `user@example.org` and the app is served at `https://social.example.org`.
 */
export function webHost(config: Pick<Config, 'PUBLIC_URL'>): string {
  return new URL(config.PUBLIC_URL).host.toLowerCase();
}

/** Whether a domain (from a handle or a URL) means this server. */
export function isLocalDomain(
  config: Pick<Config, 'PUBLIC_URL' | 'LOCAL_DOMAIN'>,
  domain: string | null | undefined,
): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return d === config.LOCAL_DOMAIN.toLowerCase() || d === webHost(config);
}
