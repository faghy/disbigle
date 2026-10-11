import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../../api/cache.ts';
import { errorMessage, fieldErrorsFrom } from '../../api/errors.ts';
import {
  type FilterContext,
  filterContexts,
  filterKeys,
  filters,
  type KeywordFilter,
} from '../../api/filters.ts';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  LoadingState,
  PageTitle,
  TextField,
} from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

const durations = [
  { seconds: null, key: 'forever' },
  { seconds: 86_400, key: 'day' },
  { seconds: 604_800, key: 'week' },
  { seconds: 2_592_000, key: 'month' },
] as const;

export function MutedWordsPage() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: filterKeys.all, queryFn: filters.list });
  return (
    <>
      <PageTitle description={t('filters.description')}>{t('filters.title')}</PageTitle>
      <div className="space-y-6">
        <AddFilter />
        <section aria-labelledby="filters-list" className="space-y-3">
          <h2 id="filters-list" className="font-semibold">
            {t('filters.yourWords')}
          </h2>
          {list.isPending ? (
            <LoadingState label={t('common.loading')} />
          ) : list.isError ? (
            <Alert>{errorMessage(list.error)}</Alert>
          ) : list.data.length === 0 ? (
            <Card className="text-center text-sm text-fg-muted">{t('filters.empty')}</Card>
          ) : (
            <ul className="space-y-2" aria-label={t('filters.yourWords')}>
              {list.data.map((filter) => (
                <li key={filter.id}>
                  <FilterItem filter={filter} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Filters change what timelines return, so cached lists are refreshed after a change. */
function useRefreshFiltered() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: filterKeys.all });
    void queryClient.invalidateQueries({ queryKey: socialKeys.timelines });
    void queryClient.invalidateQueries({ queryKey: socialKeys.notifications });
    void queryClient.invalidateQueries({ queryKey: ['context'] });
  };
}

function AddFilter() {
  const { t } = useTranslation();
  const refresh = useRefreshFiltered();
  const durationId = useId();
  const [phrase, setPhrase] = useState('');
  const [wholeWord, setWholeWord] = useState(true);
  const [contexts, setContexts] = useState<FilterContext[]>([...filterContexts]);
  const [duration, setDuration] = useState('forever');
  const [errors, setErrors] = useState<{ phrase?: string; contexts?: string }>({});

  const add = useMutation({
    mutationFn: filters.create,
    onSuccess: () => {
      setPhrase('');
      refresh();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!phrase.trim()) found.phrase = t('validation.required');
    if (contexts.length === 0) found.contexts = t('filters.contextsRequired');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const option = durations.find((d) => d.key === duration);
    add.mutate({
      phrase: phrase.trim(),
      wholeWord,
      contexts,
      expiresIn: option?.seconds ?? null,
    });
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField
          label={t('filters.phrase')}
          hint={t('filters.phraseHint')}
          maxLength={100}
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          error={errors.phrase ?? fieldErrorsFrom(add.error).phrase}
        />
        <CheckboxField
          label={t('filters.wholeWord')}
          hint={t('filters.wholeWordHint')}
          checked={wholeWord}
          onChange={(event) => setWholeWord(event.target.checked)}
        />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('filters.contexts')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {filterContexts.map((context) => (
              <CheckboxField
                key={context}
                label={t(`filters.context.${context}`)}
                checked={contexts.includes(context)}
                onChange={(event) =>
                  setContexts((list) =>
                    event.target.checked ? [...list, context] : list.filter((c) => c !== context),
                  )
                }
              />
            ))}
          </div>
          {errors.contexts && <p className="text-sm text-danger">{errors.contexts}</p>}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor={durationId} className="block text-sm font-medium">
            {t('filters.duration')}
          </label>
          <select
            id={durationId}
            className="input-base w-auto"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          >
            {durations.map((option) => (
              <option key={option.key} value={option.key}>
                {t(`filters.durations.${option.key}`)}
              </option>
            ))}
          </select>
        </div>
        <Alert>
          {add.error && !fieldErrorsFrom(add.error).phrase ? errorMessage(add.error) : null}
        </Alert>
        <Alert tone="success">{add.isSuccess ? t('filters.added') : null}</Alert>
        <Button type="submit" loading={add.isPending}>
          {t('filters.add')}
        </Button>
      </form>
    </Card>
  );
}

function FilterItem({ filter }: { filter: KeywordFilter }) {
  const { t, i18n } = useTranslation();
  const refresh = useRefreshFiltered();
  const remove = useMutation({ mutationFn: () => filters.remove(filter.id), onSuccess: refresh });
  const expired = filter.expiresAt !== null && new Date(filter.expiresAt).getTime() <= Date.now();
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold break-words">“{filter.phrase}”</p>
        <p className="text-sm text-fg-muted">
          {filter.contexts.map((c) => t(`filters.context.${c}`)).join(', ')}
          {' · '}
          {filter.wholeWord ? t('filters.wholeWordShort') : t('filters.partialShort')}
          {' · '}
          {filter.expiresAt ? (
            <time dateTime={filter.expiresAt} title={fullDateTime(filter.expiresAt, i18n.language)}>
              {expired
                ? t('filters.expired')
                : t('filters.expires', { time: relativeTime(filter.expiresAt, i18n.language) })}
            </time>
          ) : (
            t('filters.forever')
          )}
        </p>
        {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
      </div>
      <Button
        variant="secondary"
        loading={remove.isPending}
        onClick={() => remove.mutate()}
        aria-label={t('filters.removeLabel', { phrase: filter.phrase })}
      >
        {t('filters.remove')}
      </Button>
    </Card>
  );
}
