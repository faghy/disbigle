import {
  type CreateGroupRequest,
  type Group,
  type GroupPrivacy,
  groupPrivacies,
} from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, fieldErrorsFrom } from '../api/errors.ts';
import { groupKeys, groups } from '../api/groups.ts';
import { useCurrentUser } from '../api/queries.ts';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { GroupCard, PrivacyLabel } from '../components/GroupParts.tsx';
import { GroupIcon, SearchIcon } from '../components/icons.tsx';
import {
  Alert,
  Button,
  Card,
  cx,
  LoadingState,
  TextAreaField,
  TextField,
} from '../components/ui.tsx';

export function GroupsPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('groups.title')}
        description={t('groups.description')}
        icon={GroupIcon}
        actions={
          user && !creating ? (
            <Button onClick={() => setCreating(true)}>{t('groups.create')}</Button>
          ) : undefined
        }
      />
      {creating && <CreateGroupForm onCancel={() => setCreating(false)} />}
      {user && <Invitations />}
      {user && <MyGroups />}
      <DiscoverGroups />
    </div>
  );
}

/** A handle suggested from the name: letters, digits and underscores. */
function handleFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

function CreateGroupForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const privacyName = useId();
  const [form, setForm] = useState<Required<CreateGroupRequest>>({
    name: '',
    handle: '',
    description: '',
    privacy: 'public',
  });
  const [handleEdited, setHandleEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => groups.create({ ...form, name: form.name.trim() }),
    onSuccess: (group) => {
      queryClient.setQueryData(groupKeys.group(group.handle), group);
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      void navigate({ to: '/groups/$handle', params: { handle: group.handle } });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = t('validation.required');
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(form.handle)) found.handle = t('groups.form.handleInvalid');
    setErrors(found);
    if (Object.keys(found).length === 0) create.mutate();
  };
  const serverErrors = fieldErrorsFrom(create.error);
  const allErrors = { ...serverErrors, ...errors };
  const generalError =
    create.error && Object.keys(serverErrors).length === 0 ? errorMessage(create.error) : null;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <h2 className="text-lg font-semibold">{t('groups.form.title')}</h2>
        <TextField
          label={t('groups.form.name')}
          value={form.name}
          maxLength={100}
          autoFocus
          error={allErrors.name}
          onChange={(event) => {
            const name = event.target.value;
            setForm((f) => ({ ...f, name, handle: handleEdited ? f.handle : handleFrom(name) }));
          }}
        />
        <TextField
          label={t('groups.form.handle')}
          hint={t('groups.form.handleHint', { handle: form.handle || '…' })}
          value={form.handle}
          maxLength={30}
          autoCapitalize="none"
          spellCheck={false}
          error={allErrors.handle}
          onChange={(event) => {
            setHandleEdited(true);
            setForm((f) => ({ ...f, handle: event.target.value.trim() }));
          }}
        />
        <TextAreaField
          label={t('groups.form.description')}
          value={form.description}
          maxLength={2000}
          error={allErrors.description}
          onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
        />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('groups.form.privacy')}</legend>
          {groupPrivacies.map((privacy) => (
            <PrivacyOption
              key={privacy}
              name={privacyName}
              privacy={privacy}
              checked={form.privacy === privacy}
              onChange={() => setForm((f) => ({ ...f, privacy }))}
            />
          ))}
        </fieldset>
        <Alert>{generalError}</Alert>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t('groups.form.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A radio choice of privacy, with what it means. */
export function PrivacyOption({
  name,
  privacy,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  privacy: GroupPrivacy;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5',
        checked ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-muted',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        className="mt-1 size-4 accent-accent"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>
        <PrivacyLabel privacy={privacy} className="font-medium text-fg" />
        <span className="block text-sm text-fg-muted">
          {t(`groups.privacy.${privacy}.description`)}
        </span>
      </span>
    </label>
  );
}

function Invitations() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invited = useQuery({
    queryKey: groupKeys.list('invited'),
    queryFn: () => groups.list('invited'),
  });
  const answer = useMutation({
    mutationFn: ({ group, accept }: { group: Group; accept: boolean }) =>
      accept ? groups.join(group.id) : groups.leave(group.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
  if (!invited.data || invited.data.length === 0) return null;
  return (
    <FeedSection>
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">
        {t('groups.invitations')}
      </h2>
      <ul className="divide-y divide-border">
        {invited.data.map((group) => (
          <li key={group.id}>
            <GroupCard
              group={group}
              actions={
                <>
                  <Button
                    onClick={() => answer.mutate({ group, accept: true })}
                    disabled={answer.isPending}
                  >
                    {t('groups.accept')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => answer.mutate({ group, accept: false })}
                    disabled={answer.isPending}
                  >
                    {t('groups.decline')}
                  </Button>
                </>
              }
            />
          </li>
        ))}
      </ul>
      {answer.error && <Alert className="m-4">{errorMessage(answer.error)}</Alert>}
    </FeedSection>
  );
}

function MyGroups() {
  const { t } = useTranslation();
  const mine = useQuery({ queryKey: groupKeys.list('mine'), queryFn: () => groups.list('mine') });
  return (
    <FeedSection>
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">{t('groups.mine')}</h2>
      {mine.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : mine.isError ? (
        <Alert className="m-4">{errorMessage(mine.error)}</Alert>
      ) : mine.data.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-fg-muted">{t('groups.noneYet')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {mine.data.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </FeedSection>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function DiscoverGroups() {
  const { t } = useTranslation();
  const searchId = useId();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const found = useQuery({
    queryKey: groupKeys.list('discover', query),
    queryFn: () => groups.list('discover', query || undefined),
  });
  return (
    <FeedSection>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <h2 className="flex-1 text-sm font-semibold">{t('groups.discover')}</h2>
        <label htmlFor={searchId} className="sr-only">
          {t('groups.search')}
        </label>
        <div className="relative w-full sm:w-64">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
          />
          <input
            id={searchId}
            type="search"
            className="input-base py-1.5 pl-9 text-sm"
            placeholder={t('groups.search')}
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
      </div>
      {found.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : found.isError ? (
        <Alert className="m-4">{errorMessage(found.error)}</Alert>
      ) : found.data.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-fg-muted">
          {query ? t('groups.noMatch', { query }) : t('groups.noGroups')}
        </p>
      ) : (
        <ul aria-label={t('groups.discover')} className="divide-y divide-border">
          {found.data.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </FeedSection>
  );
}
