import { useTranslation } from 'react-i18next';
import { cx } from './ui.tsx';

/** The instance rules as a numbered list. */
export function InstanceRules({
  rules,
  headingId,
  className,
}: {
  rules: string[];
  headingId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (rules.length === 0) return null;
  return (
    <ol
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : t('about.rules')}
      className={cx('space-y-2', className)}
    >
      {rules.map((rule, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: rules are shown in their saved order
          key={index}
          className="flex gap-3 text-sm"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {index + 1}
          </span>
          <span className="min-w-0 pt-0.5 whitespace-pre-wrap break-words">{rule}</span>
        </li>
      ))}
    </ol>
  );
}
