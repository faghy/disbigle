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
