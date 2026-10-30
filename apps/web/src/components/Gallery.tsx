import type { Account, Album, AlbumRequest, ProfileMedia } from '@disbigle/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { PAGE_SIZE, social } from '../api/social.ts';
import { Modal } from './Dialog.tsx';
import { AlbumIcon, EyeOffIcon, PlayIcon, PlusIcon } from './icons.tsx';
import { Lightbox } from './Lightbox.tsx';
import { Alert, Button, cx, LoadingState, TextAreaField, TextField } from './ui.tsx';

/** Square thumbnails; a click opens the viewer on that picture. */
export function MediaGrid({
  items,
  onOpen,
}: {
  items: ProfileMedia[];
  onOpen: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-3 gap-1 sm:gap-1.5">
      {items.map((item, index) => {
        const { media } = item;
        const label = media.description
          ? t('status.media.openWithAlt', { alt: media.description })
          : t('status.media.open');
        return (
          <li key={media.id}>
            <button
              type="button"
              onClick={() => onOpen(index)}
              aria-label={item.sensitive ? `${t('status.media.sensitive')}. ${label}` : label}
              className="relative block aspect-square w-full overflow-hidden rounded-lg bg-surface-muted focus-ring"
            >
              {media.type === 'video' && !media.previewUrl ? (
                <video
                  src={media.url}
                  preload="metadata"
                  muted
                  className={cx('size-full object-cover', item.sensitive && 'blur-xl')}
                />
              ) : (
                <img
                  src={media.previewUrl ?? media.url}
                  alt=""
                  loading="lazy"
                  className={cx('size-full object-cover', item.sensitive && 'blur-xl')}
                />
              )}
              {item.sensitive && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                  <EyeOffIcon />
                </span>
              )}
              {media.type === 'video' && !item.sensitive && (
                <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 p-1 text-white">
                  <PlayIcon size={14} />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The full-screen viewer for a gallery: a link to the post of each picture and, on your own
 * pictures, the albums it is in.
 */
export function GalleryViewer({
  items,
  account,
  startIndex,
  onClose,
}: {
  items: ProfileMedia[];
  account: Account;
  startIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useCurrentUser();
  const own = me?.account.id === account.id;
  return (
    <Lightbox
      media={items.map((item) => item.media)}
      startIndex={startIndex}
      onClose={onClose}
      footer={(_, index) => {
        const item = items[index];
        if (!item) return null;
        return (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
            <Link
              to="/@{$username}/$statusId"
              params={{ username: account.acct, statusId: item.statusId }}
              className="rounded text-sm font-medium text-white underline-offset-4 hover:underline focus-ring"
            >
              {t('albums.openPost')}
            </Link>
            {own && <AlbumChooser key={item.media.id} account={account} mediaId={item.media.id} />}
          </div>
        );
      }}
    />
  );
}

/** Checkboxes for the owner's albums: ticking one puts the picture in it. */
function AlbumChooser({ account, mediaId }: { account: Account; mediaId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const albums = useQuery({
    queryKey: socialKeys.accountAlbums(account.id, mediaId),
    queryFn: () => social.accountAlbums(account.id, mediaId),
    enabled: open,
  });
  const toggle = useMutation({
    mutationFn: ({ albumId, included }: { albumId: string; included: boolean }) =>
      social.setInAlbum(albumId, mediaId, included),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: socialKeys.albums }),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25 focus-ring"
      >
        <AlbumIcon size={18} />
        {t('albums.addTo')}
      </button>
    );
  }
  return (
    <div className="w-full max-w-sm rounded-2xl bg-surface p-4 text-fg">
      <p className="mb-2 text-sm font-semibold">{t('albums.inAlbums')}</p>
      {albums.isPending && <LoadingState label={t('common.loading')} />}
      {albums.isError && <Alert>{errorMessage(albums.error)}</Alert>}
      {albums.data && albums.data.length === 0 && (
        <p className="text-sm text-fg-muted">{t('albums.noneYet')}</p>
      )}
      {albums.data && albums.data.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {albums.data.map((album) => (
            <li key={album.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-accent focus-ring"
                  checked={album.includes ?? false}
                  disabled={toggle.isPending}
                  onChange={(event) =>
                    toggle.mutate({ albumId: album.id, included: event.target.checked })
                  }
                />
                <span className="min-w-0 flex-1 truncate">{album.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {toggle.error && <Alert className="mt-2">{errorMessage(toggle.error)}</Alert>}
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setCreating(true)}>
        <PlusIcon size={18} />
        {t('albums.new')}
      </Button>
      {creating && (
        <AlbumFormDialog
          onClose={() => setCreating(false)}
          onSaved={(album) => {
            setCreating(false);
            toggle.mutate({ albumId: album.id, included: true });
          }}
        />
      )}
    </div>
  );
}

/** Creates an album, or edits `album` when given. */
export function AlbumFormDialog({
  album,
  onClose,
  onSaved,
}: {
  album?: Album;
  onClose: () => void;
  onSaved?: (album: Album) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(album?.name ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const save = useMutation({
    mutationFn: (body: AlbumRequest) =>
      album ? social.updateAlbum(album.id, body) : social.createAlbum(body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.albums });
      onSaved?.(saved);
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) save.mutate({ name, description });
  };
  return (
    <Modal
      title={album ? t('albums.edit') : t('albums.new')}
      onClose={onClose}
      initialFocus="input"
    >
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label={t('albums.name')}
          value={name}
          maxLength={100}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <TextAreaField
          label={t('albums.description')}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
            {album ? t('albums.save') : t('albums.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The "Media" tab of a profile: every photo and video, newest first. */
export function ProfileMediaTab({ account }: { account: Account }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<number | null>(null);
  const query = useInfiniteQuery({
    queryKey: socialKeys.media(account.id),
    queryFn: ({ pageParam }) =>
      social.accountMedia(account.id, { maxId: pageParam, limit: PAGE_SIZE * 2 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE * 2 ? undefined : lastPage.at(-1)?.media.id,
  });
  const items = query.data?.pages.flat() ?? [];

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  if (items.length === 0)
    return <p className="px-2 py-6 text-center text-sm text-fg-muted">{t('albums.noMedia')}</p>;
  return (
    <div className="p-2">
      <MediaGrid items={items} onOpen={setViewing} />
      {query.hasNextPage && (
        <div className="flex justify-center p-3">
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('timeline.loadMore')}
          </Button>
        </div>
      )}
      {viewing !== null && (
        <GalleryViewer
          items={items}
          account={account}
          startIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/** The "Albums" tab of a profile. */
export function ProfileAlbumsTab({ account }: { account: Account }) {
  const { t } = useTranslation();
  const me = useCurrentUser();
  const own = me?.account.id === account.id;
  const [creating, setCreating] = useState(false);
  const albums = useQuery({
    queryKey: socialKeys.accountAlbums(account.id),
    queryFn: () => social.accountAlbums(account.id),
  });

  if (albums.isPending) return <LoadingState label={t('common.loading')} />;
  if (albums.isError) return <Alert>{errorMessage(albums.error)}</Alert>;
  return (
    <div className="space-y-3 p-3">
      {own && (
        <div className="space-y-1">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <PlusIcon size={18} />
            {t('albums.new')}
          </Button>
          <p className="text-sm text-fg-muted">{t('albums.hint')}</p>
        </div>
      )}
      {albums.data.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-fg-muted">
          {own ? t('albums.noneYet') : t('albums.none')}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {albums.data.map((album) => (
            <li key={album.id}>
              <AlbumCard album={album} />
            </li>
          ))}
        </ul>
      )}
      {creating && <AlbumFormDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/albums/$albumId"
      params={{ albumId: album.id }}
      className="group block rounded-xl focus-ring"
    >
      <div className="aspect-square overflow-hidden rounded-xl bg-surface-muted">
        {album.cover ? (
          <img
            src={album.cover.previewUrl ?? album.cover.url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-fg-muted">
            <AlbumIcon size={36} />
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate font-medium">{album.name}</p>
      <p className="text-sm text-fg-muted">{t('albums.count', { count: album.mediaCount })}</p>
    </Link>
  );
}
