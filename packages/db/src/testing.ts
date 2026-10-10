import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase, type Database } from './index.ts';
import { runMigrations } from './migrate.ts';

const baseUrl = () =>
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';

/**
 * Creates an isolated, fully migrated database for a test file and returns a handle to drop it.
 * Each call gets a fresh database, so test files can run in parallel.
 */
export async function createTestDatabase(): Promise<{
  db: Database;
  url: string;
  drop: () => Promise<void>;
}> {
  const name = `disbigle_test_${randomBytes(6).toString('hex')}`;
  const admin = new URL(baseUrl());
  admin.pathname = '/postgres';
  const adminClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await adminClient.unsafe(`create database "${name}"`);

  const url = new URL(baseUrl());
  url.pathname = `/${name}`;
  const { db, close } = createDatabase(url.toString(), { max: 5 });
  await runMigrations(db);

  return {
    db,
    url: url.toString(),
    drop: async () => {
      await close();
      await adminClient.unsafe(`drop database if exists "${name}" with (force)`);
      await adminClient.end();
    },
  };
}
