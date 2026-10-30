import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { ApiError } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { AlbumFormDialog, GalleryViewer, MediaGrid } from '../components/Gallery.tsx';
import { displayName } from '../components/StatusCard.tsx';
import { Alert, Button, Card, LoadingState } from '../components/ui.tsx';
import { NotFoundPage } from './ErrorPages.tsx';

export function AlbumPage() {
  const { t } = useTranslation();
  const { albumId } = useParams({ from: '/albums/$albumId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const album = useQuery({
    queryKey: socialKeys.album(albumId),
    queryFn: () => social.album(albumId),
  });
  const remove = useMutation({
    mutationFn: () => social.deleteAlbum(albumId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.albums });
      if (album.data)
        void navigate({ to: '/@{$username}', params: { username: album.data.account.acct } });
    },
  });

  if (album.isPending) return <LoadingState label={t('common.loading')} />;
  if (album.isError) {
    if (album.error instanceof ApiError && album.error.status === 404) return <NotFoundPage />;
    return <Alert>{errorMessage(album.error)}</Alert>;
  }
  const { account, items } = album.data;
  const own = me?.account.id === account.id;

  return (
    <div className="space-y-4">
      <Card as="div">
        <Link
          to="/@{$username}"
          params={{ username: account.acct }}
          className="inline-flex items-center gap-2 rounded text-sm text-fg-muted hover:text-fg focus-ring"
        >
          <Avatar account={account} size="sm" />
          {displayName(account)}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight break-words">
          {album.data.name}
        </h1>
        {album.data.description && (
          <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">
            {album.data.description}
          </p>
        )}
        <p className="mt-2 text-sm text-fg-muted">
          {t('albums.count', { count: album.data.mediaCount })}
        </p>
        {own && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('albums.edit')}
            </Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t('albums.delete')}
            </Button>
          </div>
        )}
      </Card>
      <Card as="div" className="p-2 sm:p-2">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-fg-muted">{t('albums.empty')}</p>
        ) : (
          <MediaGrid items={items} onOpen={setViewing} />
        )}
      </Card>
      {viewing !== null && (
        <GalleryViewer
          items={items}
          account={account}
          startIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
      {editing && <AlbumFormDialog album={album.data} onClose={() => setEditing(false)} />}
      {deleting && (
        <ConfirmDialog
          title={t('albums.deleteTitle', { name: album.data.name })}
          description={t('albums.deleteDescription')}
          confirmLabel={t('albums.delete')}
          danger
          pending={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
      {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
    </div>
  );
}
