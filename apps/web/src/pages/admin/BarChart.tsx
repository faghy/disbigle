import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyCount } from '../../api/admin.ts';
import { cx } from '../../components/ui.tsx';

/** "12 Oct" in the reader's language, for a UTC `YYYY-MM-DD` day. */
export function shortDay(day: string, language: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * One count per day as thin bars on a shared baseline, with the value of the hovered (or
 * focused) day above the chart. A hidden table carries the same numbers for screen readers.
 */
export function BarChart({ title, data }: { title: string; data: DailyCount[] }) {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const number = new Intl.NumberFormat(i18n.language);
  const shown = active === null ? null : data[active];
  const first = data[0];
  const last = data.at(-1);

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm text-fg-muted tabular-nums" aria-live="polite">
          {shown
            ? t('admin.dashboard.onDay', {
                day: shortDay(shown.day, i18n.language),
                count: shown.count,
                value: number.format(shown.count),
              })
            : t('admin.dashboard.inDays', {
                days: data.length,
                value: number.format(total),
              })}
        </span>
      </figcaption>
      <div className="relative">
        <span className="absolute -top-0.5 left-0 text-[11px] text-fg-muted tabular-nums">
          {number.format(max)}
        </span>
        <div
          role="img"
          aria-label={t('admin.dashboard.chartLabel', {
            title,
            days: data.length,
            value: number.format(total),
          })}
          className="flex h-28 items-end gap-0.5 border-b border-border pt-4"
          onMouseLeave={() => setActive(null)}
        >
          {data.map((d, i) => (
            <div
              key={d.day}
              aria-hidden="true"
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
              onMouseEnter={() => setActive(i)}
            >
              <div
                className={cx(
                  'w-full rounded-t-[4px] transition-opacity',
                  active === null || active === i ? 'bg-accent' : 'bg-accent opacity-40',
                )}
                style={{ height: d.count ? `max(2px, ${(d.count / max) * 100}%)` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      {first && last && (
        <div className="flex justify-between text-[11px] text-fg-muted" aria-hidden="true">
          <span>{shortDay(first.day, i18n.language)}</span>
          <span>{shortDay(last.day, i18n.language)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{shortDay(d.day, i18n.language)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
