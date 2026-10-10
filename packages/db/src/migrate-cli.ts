import postgres from 'postgres';
import { createDatabase } from './index.ts';
import { runMigrations } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Create the database if it does not exist yet (development convenience).
const target = new URL(url);
const name = decodeURIComponent(target.pathname.slice(1));
const admin = new URL(url);
admin.pathname = '/postgres';
const adminClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
const [exists] = await adminClient`select 1 from pg_database where datname = ${name}`;
if (!exists) {
  await adminClient.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  console.log(`Created database ${name}`);
}
await adminClient.end();

const { db, close } = createDatabase(url, { max: 1 });
await runMigrations(db);
await close();
console.log('Migrations applied');
