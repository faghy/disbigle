// PostgreSQL connection to a diaspora* database.
import postgres from 'postgres';
import { type SqlClient, SqlDiasporaReader } from './sql-reader.ts';

/** diaspora* stores UTC in `timestamp without time zone`: parse it as UTC, not local time. */
const parseUtcTimestamp = (value: string) => new Date(`${value.replace(' ', 'T')}Z`);

/** Turns `?` placeholders into PostgreSQL's `$1, $2, …`. */
export function toPostgresPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function createPostgresClient(url: string): SqlClient {
  const client = postgres(url, {
    max: 2,
    onnotice: () => {},
    // The importer never writes to the diaspora* database.
    connection: { default_transaction_read_only: true },
    types: {
      timestampUtc: {
        to: 1114,
        from: [1114],
        serialize: (value: Date) => value.toISOString(),
        parse: parseUtcTimestamp,
      },
    },
  });
  return {
    query: async (sql, params = []) =>
      (await client.unsafe(
        toPostgresPlaceholders(sql),
        params as postgres.ParameterOrJSON<never>[],
      )) as unknown as Record<string, unknown>[],
    close: () => client.end({ timeout: 5 }),
  };
}

/** Opens a read-only reader on a diaspora* PostgreSQL database. */
export function createPostgresReader(url: string): SqlDiasporaReader {
  return new SqlDiasporaReader(createPostgresClient(url));
}
