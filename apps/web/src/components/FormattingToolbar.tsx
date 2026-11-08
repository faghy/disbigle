import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { social } from '../api/social.ts';
import type { Format } from '../lib/markdownFormat.ts';
import { StatusContent } from './StatusCard.tsx';
import { cx, LoadingState } from './ui.tsx';

const BUTTONS: { format: Format; label: string; className?: string }[] = [
  { format: 'bold', label: 'B', className: 'font-bold' },
  { format: 'italic', label: 'I', className: 'italic font-serif' },
  { format: 'strike', label: 'S', className: 'line-through' },
  { format: 'heading', label: 'H', className: 'font-semibold' },
  { format: 'quote', label: '❝' },
  { format: 'list', label: '•≡' },
  { format: 'numbered', label: '1.' },
  { format: 'code', label: '</>', className: 'font-mono text-xs' },
  { format: 'link', label: '🔗' },
];

/**
 * Buttons that write Markdown for you (as diaspora* reads it), and the switch between writing
 * and a preview of the published post.
 */
export function FormattingToolbar({
  onFormat,
  previewing,
  onPreviewChange,
}: {
  onFormat: (format: Format) => void;
  previewing: boolean;
  onPreviewChange: (previewing: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-border pb-2">
      <div
        role="toolbar"
        aria-label={t('composer.format.label')}
        className="flex flex-wrap gap-0.5"
      >
        {BUTTONS.map(({ format, label, className }) => (
          <button
            key={format}
            type="button"
            disabled={previewing}
            onClick={() => onFormat(format)}
            title={t(`composer.format.${format}`)}
            aria-label={t(`composer.format.${format}`)}
            className={cx(
              'min-w-8 rounded-md px-1.5 py-1 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring disabled:opacity-40',
              className,
            )}
          >
            <span aria-hidden="true">{label}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex rounded-lg bg-surface-muted p-0.5 text-sm">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={previewing === value}
            onClick={() => onPreviewChange(value)}
            className={cx(
              'rounded-md px-2.5 py-0.5 focus-ring',
              previewing === value ? 'bg-surface font-medium shadow-sm' : 'text-fg-muted',
            )}
          >
            {value ? t('composer.format.preview') : t('composer.format.write')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The text as it will look once published (rendered by the server, mentions included). */
export function PostPreview({ content }: { content: string }) {
  const { t } = useTranslation();
  const preview = useQuery({
    queryKey: ['post-preview', content],
    queryFn: () => social.previewPost(content),
    enabled: content.trim().length > 0,
    staleTime: 60_000,
  });
  if (!content.trim()) return <p className="py-2 text-fg-muted">{t('composer.format.empty')}</p>;
  if (preview.isPending) return <LoadingState label={t('common.loading')} />;
  if (!preview.data) return null;
  return <StatusContent html={preview.data.html} className="min-h-16 py-1 text-[0.95rem]" />;
}
