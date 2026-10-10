import { InvalidDiasporaIdError } from './errors.ts';

const USERNAME = '[\\p{Ll}\\d\\-._]+';
const HOSTNAME_PART = '[\\p{Ll}\\d\\-]';
const HOSTNAME = `${HOSTNAME_PART}+(?:[.]${HOSTNAME_PART}*)*`;
const IPV4 = '(?:\\d{1,3}\\.){3}\\d{1,3}';
const IPV6 = '\\[(?:[0-9a-fA-F]{0,4}:){0,7}[0-9a-fA-F]{1,4}\\]';
const DOMAIN = `(?:${HOSTNAME}|${IPV4}|${IPV6})`;
const PORT = '(?::\\d+)?';

/** Pattern of a valid diaspora* ID, identical to the reference implementation. */
export const DIASPORA_ID_REGEX: RegExp = new RegExp(`^${USERNAME}@${DOMAIN}${PORT}$`, 'u');
/** Maximum length of a diaspora* ID. */
export const DIASPORA_ID_MAX_LENGTH = 255;

/** A parsed diaspora* ID (`username@host[:port]`). */
export interface DiasporaId {
  /** The local part before `@`. */
  readonly username: string;
  /** Host name including the port, if any (e.g. `example.org:3000`). */
  readonly host: string;
  /** Host name without port. */
  readonly hostname: string;
  /** Port, when the ID carries one. */
  readonly port: number | undefined;
  /** The full normalised ID. */
  readonly id: string;
}

/** Trims, strips a leading `acct:` and lowercases, like the reference discovery code. */
export function normalizeDiasporaId(input: string): string {
  return input.trim().replace(/^acct:/i, '').toLowerCase();
}

/** True if `value` is a valid (already normalised) diaspora* ID. */
export function isValidDiasporaId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= DIASPORA_ID_MAX_LENGTH &&
    DIASPORA_ID_REGEX.test(value)
  );
}

/** Normalises and parses a diaspora* ID, throwing `InvalidDiasporaIdError` if it is malformed. */
export function parseDiasporaId(input: string): DiasporaId {
  const id = normalizeDiasporaId(input);
  if (!isValidDiasporaId(id)) throw new InvalidDiasporaIdError(`invalid diaspora* ID: ${input}`);
  const at = id.lastIndexOf('@');
  const username = id.slice(0, at);
  const host = id.slice(at + 1);
  const portMatch = /:(\d+)$/.exec(host);
  const port = portMatch?.[1] ? Number(portMatch[1]) : undefined;
  const hostname = portMatch ? host.slice(0, portMatch.index) : host;
  return { username, host, hostname, port, id };
}

/** Builds a diaspora* ID from a username and a host (which may include a port). */
export function formatDiasporaId(username: string, host: string): string {
  return parseDiasporaId(`${username}@${host}`).id;
}
