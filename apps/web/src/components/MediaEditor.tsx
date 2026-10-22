import type { MediaAttachment } from '@disbigle/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { useLimits } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { CloseIcon, ImageIcon } from './icons.tsx';
import { Alert, Button, cx, Spinner } from './ui.tsx';

const MAX_DESCRIPTION = 1500;

export interface MediaItem {
  key: string;
  name: string;
  kind: MediaAttachment['type'];
  previewUrl: string | null;
  /** The preview is a local object URL, to be freed with the item. */
  localPreview: boolean;
  state: 'uploading' | 'ready' | 'error';
  attachment: MediaAttachment | null;
  description: string;
  error: unknown;
}

export type ReadyMediaItem = MediaItem & { attachment: MediaAttachment };

let mediaKey = 0;
const nextKey = () => {
  mediaKey += 1;
  return `m${mediaKey}`;
};

/** An attachment already on a post, as an item of the editor. */
function itemOf(attachment: MediaAttachment): MediaItem {
  return {
    key: nextKey(),
    name: decodeURIComponent(attachment.url.split('/').pop() ?? attachment.id),
    kind: attachment.type,
    previewUrl: attachment.type === 'image' ? (attachment.previewUrl ?? attachment.url) : null,
    localPreview: false,
    state: 'ready',
    attachment,
    description: attachment.description,
    error: null,
  };
}

/**
 * Attachments being composed: uploads start as soon as files are picked, alt text is edited
 * locally and saved with `saveDescriptions` before the post refers to the media.
 */
export function useMediaItems(initial: MediaAttachment[] = []) {
  const { t } = useTranslation();
  const limits = useLimits();
  const [media, setMedia] = useState<MediaItem[]>(() => initial.map(itemOf));
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Free object URLs of local previews when the editor goes away.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  useEffect(
    () => () => {
      for (const item of mediaRef.current)
        if (item.localPreview && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const updateItem = (key: string, patch: Partial<MediaItem>) =>
    setMedia((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setMediaError(null);
    const room = limits.maxMediaAttachments - media.length;
    const list = [...files];
    if (list.length > room)
      setMediaError(t('composer.media.tooMany', { max: limits.maxMediaAttachments }));
    for (const file of list.slice(0, Math.max(0, room))) {
      const kind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : null;
      if (!kind || !limits.acceptedMediaTypes.includes(file.type)) {
        setMediaError(t('composer.media.unsupported', { name: file.name }));
        continue;
      }
      const limit = kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes;
      if (file.size > limit) {
        setMediaError(
          t('composer.media.tooLarge', { name: file.name, size: Math.round(limit / 1024 / 1024) }),
        );
        continue;
      }
      const key = nextKey();
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : null;
      setMedia((items) => [
        ...items,
        {
          key,
          name: file.name,
          kind,
          previewUrl,
          localPreview: previewUrl !== null,
          state: 'uploading',
          attachment: null,
          description: '',
          error: null,
        },
      ]);
      social.uploadMedia(file).then(
        (attachment) => updateItem(key, { state: 'ready', attachment }),
        (error: unknown) => updateItem(key, { state: 'error', error }),
      );
    }
  };

  const removeItem = (key: string) => {
    setMedia((items) => {
      const item = items.find((i) => i.key === key);
      if (item?.localPreview && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return items.filter((i) => i.key !== key);
    });
    if (editingAlt === key) setEditingAlt(null);
  };

  const reset = () => {
    for (const item of media)
      if (item.localPreview && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setMedia([]);
    setEditingAlt(null);
    setMediaError(null);
  };

  const ready = media.filter((item): item is ReadyMediaItem => item.attachment !== null);

  /** Saves alt text changed since the upload; false (with the error shown) if that failed. */
  const saveDescriptions = async (): Promise<boolean> => {
    try {
      await Promise.all(
        ready
          .filter((item) => item.description.trim() !== item.attachment.description)
          .map((item) => social.updateMedia(item.attachment.id, item.description.trim())),
      );
      return true;
    } catch (error) {
      setMediaError(errorMessage(error));
      return false;
    }
  };

  return {
    media,
    ready,
    uploading: media.some((item) => item.state === 'uploading'),
    failed: media.some((item) => item.state === 'error'),
    full: media.length >= limits.maxMediaAttachments,
    acceptedTypes: limits.acceptedMediaTypes,
    addFiles,
    removeItem,
    updateItem,
    editingAlt,
    setEditingAlt,
    mediaError,
    reset,
    saveDescriptions,
  };
}

export type MediaItems = ReturnType<typeof useMediaItems>;

/** Thumbnails of the attachments with their remove and alt-text buttons, and the alt editor. */
export function MediaList({ items, error }: { items: MediaItems; error?: string | undefined }) {
  const { t } = useTranslation();
  const { media, editingAlt, setEditingAlt, removeItem, updateItem } = items;
  const shownError = items.mediaError ?? error;
  return (
    <>
      {media.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('composer.media.list')}>
          {media.map((item, index) => (
            <li key={item.key} className="space-y-1">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-muted">
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.description || t('composer.media.preview', { number: index + 1 })}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center p-2 text-center text-xs break-all text-fg-muted">
                    {item.name}
                  </span>
                )}
                {item.state === 'uploading' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
                    <Spinner />
                    <span className="sr-only">{t('composer.media.uploading')}</span>
                  </span>
                )}
                {item.state === 'error' && (
                  <span className="absolute inset-x-0 bottom-0 bg-danger px-1 py-0.5 text-center text-xs text-white">
                    {errorMessage(item.error)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  aria-label={t('composer.media.remove', { name: item.name })}
                  className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black focus-ring"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
              <button
                type="button"
                disabled={item.state !== 'ready'}
                aria-expanded={editingAlt === item.key}
                onClick={() => setEditingAlt(editingAlt === item.key ? null : item.key)}
                className={cx(
                  'w-full rounded-md px-2 py-1 text-xs font-medium focus-ring disabled:opacity-50',
                  item.description.trim()
                    ? 'bg-success-soft text-success'
                    : 'bg-surface-muted text-fg-muted hover:text-fg',
                )}
              >
                {item.description.trim()
                  ? t('composer.media.altSet')
                  : t('composer.media.addAlt', { number: index + 1 })}
              </button>
            </li>
          ))}
        </ul>
      )}

      {media.map((item, index) =>
        editingAlt === item.key ? (
          <AltEditor
            key={item.key}
            number={index + 1}
            value={item.description}
            onChange={(description) => updateItem(item.key, { description })}
            onDone={() => setEditingAlt(null)}
          />
        ) : null,
      )}

      {shownError && <Alert>{shownError}</Alert>}
    </>
  );
}

/** The "add media" button, with its hidden file input. */
export function AddMediaButton({
  items,
  disabled = false,
  title,
  testId,
}: {
  items: MediaItems;
  disabled?: boolean;
  title?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={items.acceptedTypes.join(',')}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          items.addFiles(event.target.files);
          event.target.value = '';
        }}
        data-testid={testId}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={items.full || disabled}
        aria-label={t('composer.media.add')}
        title={title ?? t('composer.media.add')}
        className="inline-flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring disabled:opacity-40"
      >
        <ImageIcon />
      </button>
    </>
  );
}

function AltEditor({
  number,
  value,
  onChange,
  onDone,
}: {
  number: number;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('composer.media.altLabel', { number })}
      </label>
      <textarea
        id={id}
        // biome-ignore lint/a11y/noAutofocus: opened on request to edit this description
        autoFocus
        rows={3}
        maxLength={MAX_DESCRIPTION}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('composer.media.altPlaceholder')}
        className="input-base"
      />
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{t('composer.media.altHint')}</span>
        <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  );
}
