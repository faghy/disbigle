import type { CurrentUser } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints.ts';
import { errorMessage } from '../../api/errors.ts';
import { queryKeys, useLimits } from '../../api/queries.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { CameraIcon } from '../../components/icons.tsx';
import { Alert, Button, Card, Spinner } from '../../components/ui.tsx';

type Kind = 'avatar' | 'header';
export const PROFILE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

/** Upload, preview and removal of one profile image. */
function useProfileImage(kind: Kind) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const setLocalPreview = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  };
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const onSaved = (user: CurrentUser) => {
    queryClient.setQueryData(queryKeys.me, user);
    void queryClient.invalidateQueries({ queryKey: ['account'] });
    setLocalPreview(null);
  };
  const upload = useMutation({
    mutationFn: (file: File) => endpoints.uploadProfileImage(kind, file),
    onSuccess: onSaved,
    onError: () => setLocalPreview(null),
  });
  const remove = useMutation({
    mutationFn: () => endpoints.removeProfileImage(kind),
    onSuccess: onSaved,
  });
  return { preview, setLocalPreview, upload, remove };
}

export function ProfileImages({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const limits = useLimits();
  const avatar = useProfileImage('avatar');
  const header = useProfileImage('header');
  const [problem, setProblem] = useState<string | null>(null);
  const inputs = { avatar: useRef<HTMLInputElement>(null), header: useRef<HTMLInputElement>(null) };
  const ids = { avatar: useId(), header: useId() };
  const { account } = user;

  const choose = (kind: Kind, file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!PROFILE_IMAGE_TYPES.includes(file.type)) {
      setProblem(t('settings.images.unsupported', { name: file.name }));
      return;
    }
    if (file.size > limits.maxImageBytes) {
      setProblem(
        t('composer.media.tooLarge', {
          name: file.name,
          size: Math.round(limits.maxImageBytes / 1024 / 1024),
        }),
      );
      return;
    }
    const target = kind === 'avatar' ? avatar : header;
    target.setLocalPreview(URL.createObjectURL(file));
    target.upload.mutate(file);
  };

  const headerUrl = header.preview ?? account.headerUrl;
  const avatarUrl = avatar.preview ?? account.avatarUrl;
  const error =
    problem ??
    [avatar.upload.error, avatar.remove.error, header.upload.error, header.remove.error]
      .filter(Boolean)
      .map(errorMessage)[0] ??
    null;

  const fileInput = (kind: Kind) => (
    <input
      ref={inputs[kind]}
      id={ids[kind]}
      type="file"
      accept={PROFILE_IMAGE_TYPES.join(',')}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      data-testid={`${kind}-input`}
      onChange={(event) => {
        choose(kind, event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  return (
    <Card className="overflow-hidden" aria-labelledby="profile-images-title">
      <h2 id="profile-images-title" className="font-semibold">
        {t('settings.images.title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('settings.images.hint')}</p>

      <div className="relative mt-4">
        <div className="relative aspect-[3/1] overflow-hidden rounded-xl border border-border bg-surface-muted">
          {headerUrl ? (
            <img
              src={headerUrl}
              alt={t('settings.images.headerPreview')}
              className="size-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="size-full bg-gradient-to-r from-accent-soft via-surface-muted to-accent-soft"
            />
          )}
          {header.upload.isPending && (
            <span className="absolute inset-0 flex items-center justify-center bg-surface/60">
              <Spinner />
              <span className="sr-only">{t('composer.media.uploading')}</span>
            </span>
          )}
        </div>
        <div className="relative -mt-10 ml-4 inline-block">
          <Avatar account={{ ...account, avatarUrl }} size="lg" className="ring-4 ring-surface" />
          {avatar.upload.isPending && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-surface/60">
              <Spinner />
              <span className="sr-only">{t('composer.media.uploading')}</span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(['avatar', 'header'] as const).map((kind) => {
          const state = kind === 'avatar' ? avatar : header;
          const current = kind === 'avatar' ? account.avatarUrl : account.headerUrl;
          return (
            <div key={kind} className="space-y-2">
              <p className="text-sm font-medium">{t(`settings.images.${kind}`)}</p>
              <p className="text-xs text-fg-muted">{t(`settings.images.${kind}Size`)}</p>
              {fileInput(kind)}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={state.upload.isPending}
                  onClick={() => inputs[kind].current?.click()}
                >
                  <CameraIcon size={16} />
                  {current
                    ? t(`settings.images.change.${kind}`)
                    : t(`settings.images.upload.${kind}`)}
                </Button>
                {current && (
                  <Button
                    variant="ghost"
                    loading={state.remove.isPending}
                    onClick={() => state.remove.mutate()}
                  >
                    {t(`settings.images.remove.${kind}`)}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Alert>{error}</Alert>
      </div>
    </Card>
  );
}
