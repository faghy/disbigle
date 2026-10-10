import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { contextQueryOptions, statusQueryOptions } from '../api/socialQueries.ts';
import { Composer } from '../components/Composer.tsx';
import { FeedSection } from '../components/FeedSection.tsx';
import { ChevronLeftIcon } from '../components/icons.tsx';
import { StatusCard } from '../components/StatusCard.tsx';
import { Alert, LoadingState } from '../components/ui.tsx';
import { NotFoundPage } from './ErrorPages.tsx';

export function StatusPage() {
  const { t } = useTranslation();
  const { statusId } = useParams({ from: '/@{$username}/$statusId' });
  const user = useCurrentUser();
  const router = useRouter();
  const status = useQuery(statusQueryOptions(statusId));
  const context = useQuery(contextQueryOptions(statusId));
  const replyRef = useRef<HTMLTextAreaElement>(null);

  if (status.isPending) return <LoadingState label={t('common.loading')} />;
  if (status.isError) {
    if (status.error instanceof ApiError && status.error.status === 404) return <NotFoundPage />;
    return <Alert>{errorMessage(status.error)}</Alert>;
  }

  // Context is loaded separately; until then the thread shows only the post itself.
  const ancestors = context.data?.ancestors ?? [];
  const descendants = context.data?.descendants ?? [];
  const main = status.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.history.back()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring"
        >
          <ChevronLeftIcon size={18} />
          {t('common.back')}
        </button>
        <h1 className="text-lg font-semibold">{t('thread.title')}</h1>
      </div>

      <FeedSection>
        {ancestors.length > 0 && (
          <section aria-label={t('thread.ancestors')}>
            {ancestors.map((ancestor) => (
              <StatusCard key={ancestor.id} status={ancestor} />
            ))}
          </section>
        )}

        <div aria-current="page">
          <StatusCard
            status={main}
            highlighted
            onReply={user ? () => replyRef.current?.focus() : undefined}
          />
        </div>

        {user && (
          <div className="border-b border-border p-3 sm:p-4">
            <Composer replyTo={main.reblog ?? main} compact textareaRef={replyRef} />
          </div>
        )}

        {context.isError && <Alert className="m-4">{errorMessage(context.error)}</Alert>}
        {descendants.length > 0 && (
          <section
            aria-label={t('thread.replies')}
            className="ml-4 border-l-2 border-border sm:ml-8"
          >
            {descendants.map((reply) => (
              <StatusCard key={reply.id} status={reply} />
            ))}
          </section>
        )}
        {context.isSuccess && descendants.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-fg-muted">{t('thread.noReplies')}</p>
        )}
      </FeedSection>
    </div>
  );
}
