const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 minutes ago" for recent dates; a short date for anything older than a week. */
export function relativeTime(iso: string, language: string, now = Date.now()): string {
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 7 * 24 * 3600) {
    return new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
    }).format(date);
  }
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (abs < 45) return format.format(0, 'second');
  for (const [unit, size] of units) {
    if (abs >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds / 60), 'minute');
}

export function fullDateTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
