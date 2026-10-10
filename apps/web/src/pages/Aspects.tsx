import type { Aspect } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage, fieldErrorsFrom } from '../api/errors.ts';
import { social } from '../api/social.ts';
import { aspectMembersQueryOptions, aspectsQueryOptions } from '../api/socialQueries.ts';
import { AccountList } from '../components/AccountList.tsx';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { FeedHeader } from '../components/FeedSection.tsx';
import { AspectsIcon, ChevronDownIcon } from '../components/icons.tsx';
import { Alert, Button, Card, cx, LoadingState } from '../components/ui.tsx';

const MAX_NAME = 100;

export function AspectsPage() {
  const { t } = useTranslation();
  const aspects = useQuery(aspectsQueryOptions);

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('aspects.title')}
        description={t('aspects.description')}
        icon={AspectsIcon}
      />
      <CreateAspect />
      {aspects.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : aspects.isError ? (
        <Alert>{errorMessage(aspects.error)}</Alert>
      ) : aspects.data.length === 0 ? (
        <Card className="text-center text-fg-muted">{t('aspects.empty')}</Card>
      ) : (
        <ul className="space-y-3">
          {aspects.data.map((aspect) => (
            <li key={aspect.id}>
              <AspectRow aspect={aspect} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useNameValidation() {
  const { t } = useTranslation();
  return (name: string) => (name.trim() ? null : t('validation.required'));
}

function CreateAspect() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const validate = useNameValidation();

  const create = useMutation({
    mutationFn: (value: string) => social.createAspect(value),
    onSuccess: (aspect) => {
      queryClient.setQueryData<Aspect[]>(socialKeys.aspects, (list) => [...(list ?? []), aspect]);
      setName('');
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(name);
    setError(problem);
    if (!problem) create.mutate(name.trim());
  };
  const serverError = create.error
    ? (fieldErrorsFrom(create.error).name ?? errorMessage(create.error))
    : null;
  const shown = error ?? serverError;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium">
            {t('aspects.newName')}
          </label>
          <input
            id={id}
            className="input-base"
            maxLength={MAX_NAME}
            value={name}
            placeholder={t('aspects.newPlaceholder')}
            aria-invalid={shown ? true : undefined}
            aria-describedby={shown ? `${id}-error` : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" loading={create.isPending}>
          {t('aspects.create')}
        </Button>
      </form>
      {shown && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-danger">
          {shown}
        </p>
      )}
    </Card>
  );
}

function AspectRow({ aspect }: { aspect: Aspect }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(aspect.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const inputId = useId();
  const membersId = useId();
  const validate = useNameValidation();

  const rename = useMutation({
    mutationFn: (value: string) => social.renameAspect(aspect.id, value),
    onSuccess: (updated) => {
      queryClient.setQueryData<Aspect[]>(socialKeys.aspects, (list) =>
        list?.map((a) => (a.id === updated.id ? updated : a)),
      );
      setRenaming(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => social.deleteAspect(aspect.id),
    onSuccess: () => {
      setConfirming(false);
      queryClient.setQueryData<Aspect[]>(socialKeys.aspects, (list) =>
        list?.filter((a) => a.id !== aspect.id),
      );
      queryClient.removeQueries({ queryKey: socialKeys.timeline('aspect', aspect.id) });
    },
  });

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(name);
    setNameError(problem);
    if (!problem) rename.mutate(name.trim());
  };
  const renameError =
    nameError ??
    (rename.error ? (fieldErrorsFrom(rename.error).name ?? errorMessage(rename.error)) : null);

  return (
    <Card className="p-4 sm:p-5">
      {renaming ? (
        <form onSubmit={onRename} noValidate className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t('aspects.renameLabel', { name: aspect.name })}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              // biome-ignore lint/a11y/noAutofocus: shown on request to rename this aspect
              autoFocus
              className="input-base flex-1"
              maxLength={MAX_NAME}
              value={name}
              aria-invalid={renameError ? true : undefined}
              aria-describedby={renameError ? `${inputId}-error` : undefined}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(false);
              }}
            />
            <div className="flex gap-2">
              <Button type="submit" loading={rename.isPending}>
                {t('settings.save')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setRenaming(false);
                  setName(aspect.name);
                  setNameError(null);
                  rename.reset();
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
          {renameError && (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
              {renameError}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <AspectsIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">
              <Link
                to="/aspects/$aspectId"
                params={{ aspectId: aspect.id }}
                className="rounded hover:underline focus-ring"
              >
                {aspect.name}
              </Link>
            </h2>
            <p className="text-sm text-fg-muted">
              {t('aspects.memberCount', { count: aspect.memberCount })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              aria-expanded={showMembers}
              aria-controls={membersId}
              onClick={() => setShowMembers((v) => !v)}
            >
              {t('aspects.members')}
              <ChevronDownIcon size={16} className={cx(showMembers && 'rotate-180')} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => setRenaming(true)}
              aria-label={t('aspects.renameLabel', { name: aspect.name })}
            >
              {t('aspects.rename')}
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              aria-label={t('aspects.deleteLabel', { name: aspect.name })}
            >
              {t('aspects.delete')}
            </Button>
          </div>
        </div>
      )}

      {showMembers && (
        <div id={membersId} className="mt-3 border-t border-border pt-3">
          <AspectMembers aspect={aspect} />
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('aspects.deleteTitle', { name: aspect.name })}
          description={
            remove.error ? (
              <span className="text-danger">{errorMessage(remove.error)}</span>
            ) : (
              t('aspects.deleteDescription')
            )
          }
          confirmLabel={t('aspects.delete')}
          pending={remove.isPending}
          onCancel={() => {
            setConfirming(false);
            remove.reset();
          }}
          onConfirm={() => remove.mutate()}
        />
      )}
    </Card>
  );
}

function AspectMembers({ aspect }: { aspect: Aspect }) {
  const { t } = useTranslation();
  const members = useQuery(aspectMembersQueryOptions(aspect.id));
  return <AccountList query={members} empty={t('aspects.noMembers')} />;
}
