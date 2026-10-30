import type { Account, Group, GroupMember, GroupRole } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { ApiError } from '../api/client.ts';
import { errorMessage, fieldErrorsFrom } from '../api/errors.ts';
import { groupKeys, groupQueryOptions, groups } from '../api/groups.ts';
import { useCurrentUser, useInstance, useLimits } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Composer } from '../components/Composer.tsx';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { FeedSection } from '../components/FeedSection.tsx';
import { GroupAvatar, PrivacyLabel } from '../components/GroupParts.tsx';
import { InfoIcon, PencilIcon } from '../components/icons.tsx';
import { CurrentGroupContext } from '../components/StatusCard.tsx';
import { Timeline } from '../components/Timeline.tsx';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  cx,
  LoadingState,
  Spinner,
  TextAreaField,
  TextField,
} from '../components/ui.tsx';
import { NotFoundPage } from './ErrorPages.tsx';
import { PrivacyOption } from './Groups.tsx';

export function GroupPage() {
  const { t } = useTranslation();
  const { handle } = useParams({ from: '/groups/$handle' });
  const group = useQuery(groupQueryOptions(handle));
  if (group.isPending) return <LoadingState label={t('common.loading')} />;
  if (group.isError) {
    if (group.error instanceof ApiError && group.error.status === 404) return <NotFoundPage />;
    return <Alert>{errorMessage(group.error)}</Alert>;
  }
  return (
    <CurrentGroupContext.Provider value={group.data.id}>
      <GroupView group={group.data} />
    </CurrentGroupContext.Provider>
  );
}

type TabId = 'posts' | 'members' | 'requests' | 'settings';

const isMember = (group: Group) => group.membership?.state === 'member';
const isModerator = (group: Group) =>
  isMember(group) && (group.membership?.role === 'admin' || group.membership?.role === 'moderator');
const isAdmin = (group: Group) => isMember(group) && group.membership?.role === 'admin';

/** Keeps every cached copy of the group (by id and by handle) up to date. */
function useStoreGroup() {
  const queryClient = useQueryClient();
  return (group: Group) => {
    queryClient.setQueryData(groupKeys.group(group.handle), group);
    queryClient.setQueryData(groupKeys.group(group.id), group);
    void queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
  };
}

function GroupView({ group }: { group: Group }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('posts');
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'posts', label: t('groups.tabs.posts') },
    { id: 'members', label: t('groups.tabs.members'), count: group.membersCount },
    // Public groups take everyone at once: no requests to look at.
    ...(isModerator(group) && group.privacy !== 'public'
      ? [{ id: 'requests' as const, label: t('groups.tabs.requests'), count: group.requestsCount }]
      : []),
    ...(isAdmin(group) ? [{ id: 'settings' as const, label: t('groups.tabs.settings') }] : []),
  ];
  const current = tabs.some((item) => item.id === tab) ? tab : 'posts';
  return (
    <div className="space-y-4">
      <GroupHeader group={group} />
      <Tabs tabs={tabs} tab={current} onChange={setTab}>
        {current === 'posts' && <GroupPosts group={group} />}
        {current === 'members' && <Members group={group} />}
        {current === 'requests' && <Requests group={group} />}
        {current === 'settings' && <GroupSettings group={group} />}
      </Tabs>
    </div>
  );
}

function GroupHeader({ group }: { group: Group }) {
  const { t } = useTranslation();
  const instance = useInstance();
  const domain = instance.data?.domain;
  const groupImages = useGroupImages(group);
  const images = isAdmin(group) ? groupImages : null;
  return (
    <Card as="div" className="relative">
      <div className="relative -mx-5 -mt-5 mb-4 overflow-hidden rounded-t-[calc(1.5rem-1.5px)] sm:-mx-6 sm:-mt-6">
        {group.headerUrl ? (
          <img
            src={group.headerUrl}
            alt=""
            className="aspect-[3/1] w-full bg-surface-muted object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="aspect-[6/1] w-full bg-gradient-to-r from-accent-soft via-surface-muted to-accent-soft"
          />
        )}
        {images && (
          <ImageEditButton
            label={t('groups.image.edit.header')}
            pending={images.uploading === 'header'}
            onFile={(file) => images.choose('header', file)}
            className="absolute top-3 right-3"
          />
        )}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative -mt-14 self-start sm:-mt-16">
          <GroupAvatar
            group={group}
            size="lg"
            className="ring-4 ring-surface sm:size-24 sm:text-3xl"
          />
          {images && (
            <ImageEditButton
              label={t('groups.image.edit.avatar')}
              pending={images.uploading === 'avatar'}
              onFile={(file) => images.choose('avatar', file)}
              className="absolute -right-1 -bottom-1"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{group.name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PrivacyLabel privacy={group.privacy} />
            <span className="text-sm text-fg-muted">
              {t('groups.members', { count: group.membersCount })}
            </span>
          </p>
          {group.privacy === 'public' && domain && (
            <p className="mt-1 text-sm break-all text-fg-muted">
              {t('groups.fediverseHandle', { handle: `@${group.handle}@${domain}` })}
            </p>
          )}
        </div>
        <MembershipActions group={group} />
      </div>
      {group.description && (
        <p className="mt-4 whitespace-pre-wrap break-words">{group.description}</p>
      )}
      {images?.error && <Alert className="mt-4">{images.error}</Alert>}
    </Card>
  );
}

/** Join, ask to join, accept an invitation, withdraw a request, or leave. */
function MembershipActions({ group }: { group: Group }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const storeGroup = useStoreGroup();
  const queryClient = useQueryClient();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const join = useMutation({
    mutationFn: () => groups.join(group.id),
    onSuccess: (updated) => {
      storeGroup(updated);
      void queryClient.invalidateQueries({ queryKey: socialKeys.timeline('group', group.id) });
    },
  });
  const leave = useMutation({
    mutationFn: () => groups.leave(group.id),
    onSuccess: async () => {
      setConfirmLeave(false);
      // The group may be out of reach now (secret groups).
      await queryClient.invalidateQueries({ queryKey: groupKeys.all });
      void queryClient.invalidateQueries({ queryKey: socialKeys.timeline('group', group.id) });
    },
  });
  if (!user) {
    return (
      <Link to="/login" className={buttonClass('primary', 'self-start')}>
        {t('groups.signInToJoin')}
      </Link>
    );
  }
  const state = group.membership?.state;
  const error = join.error ?? leave.error;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {!state && group.privacy !== 'secret' && (
          <Button loading={join.isPending} onClick={() => join.mutate()}>
            {group.privacy === 'public' ? t('groups.join') : t('groups.askToJoin')}
          </Button>
        )}
        {state === 'invited' && (
          <>
            <Button loading={join.isPending} onClick={() => join.mutate()}>
              {t('groups.accept')}
            </Button>
            <Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>
              {t('groups.decline')}
            </Button>
          </>
        )}
        {state === 'requested' && (
          <Button variant="secondary" loading={leave.isPending} onClick={() => leave.mutate()}>
            {t('groups.cancelRequest')}
          </Button>
        )}
        {state === 'member' && (
          <Button variant="secondary" onClick={() => setConfirmLeave(true)}>
            {t('groups.leave')}
          </Button>
        )}
      </div>
      {state === 'requested' && <p className="text-sm text-fg-muted">{t('groups.requestSent')}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
      {confirmLeave && (
        <ConfirmDialog
          title={t('groups.leaveTitle', { name: group.name })}
          description={group.privacy === 'public' ? undefined : t('groups.leavePrivate')}
          confirmLabel={t('groups.leave')}
          pending={leave.isPending}
          onConfirm={() => leave.mutate()}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function Tabs({
  tabs,
  tab,
  onChange,
  children,
}: {
  tabs: { id: TabId; label: string; count?: number | undefined }[];
  tab: TabId;
  onChange: (tab: TabId) => void;
  children: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((item) => item.id === tab);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`${baseId}-${next.id}-tab`)?.focus();
  };
  return (
    <FeedSection>
      <div
        role="tablist"
        aria-label={t('groups.tabs.label')}
        onKeyDown={onKeyDown}
        className="flex overflow-x-auto border-b border-border"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-${item.id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-3 text-sm font-medium focus-ring sm:px-4',
              tab === item.id
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="rounded-full bg-surface-muted px-1.5 text-xs tabular-nums text-fg-muted">
                {new Intl.NumberFormat(i18n.language).format(item.count)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${tab}-tab`}>
        {children}
      </div>
    </FeedSection>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-4 flex items-start gap-2 rounded-2xl border-2 border-dashed border-border-strong px-4 py-3 text-sm text-fg-muted">
      <InfoIcon size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function GroupPosts({ group }: { group: Group }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const member = isMember(group);
  const queryKey = socialKeys.timeline('group', group.id);
  if (group.privacy !== 'public' && !member) {
    return <Notice>{t('groups.privateNotice')}</Notice>;
  }
  return (
    <>
      {member ? (
        <div className="border-b border-border p-3 sm:p-4">
          <Composer group={group} />
        </div>
      ) : (
        user && <Notice>{t('groups.joinToWrite')}</Notice>
      )}
      <Timeline
        queryKey={queryKey}
        fetchPage={(page) => groups.timeline(group.id, page)}
        stream={null}
        label={t('groups.tabs.posts')}
        empty={t('groups.noPosts')}
      />
    </>
  );
}

const roleOrder: GroupRole[] = ['admin', 'moderator', 'member'];

function Members({ group }: { group: Group }) {
  const { t } = useTranslation();
  const visible = group.privacy === 'public' || isMember(group);
  const members = useQuery({
    queryKey: groupKeys.members(group.id, 'member'),
    queryFn: () => groups.members(group.id),
    enabled: visible,
  });
  if (!visible) return <Notice>{t('groups.membersPrivate')}</Notice>;
  return (
    <div>
      {isMember(group) && <InvitePeople group={group} />}
      {isAdmin(group) && members.data && (
        <p className="flex gap-2 border-b border-border px-4 py-3 text-sm text-fg-muted sm:px-5">
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          {members.data.some((member) => member.account.local && member.role !== 'admin')
            ? t('groups.rolesHint')
            : t('groups.rolesHintAlone')}
        </p>
      )}
      {members.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : members.isError ? (
        <Alert className="m-4">{errorMessage(members.error)}</Alert>
      ) : (
        <ul aria-label={t('groups.tabs.members')} className="divide-y divide-border">
          {members.data.map((member) => (
            <li key={member.account.id}>
              <MemberRow group={group} member={member} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({ group, member }: { group: Group; member: GroupMember }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const roleId = useId();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['groups', 'members', group.id] });
    void queryClient.invalidateQueries({ queryKey: groupKeys.group(group.handle) });
  };
  const setRole = useMutation({
    mutationFn: (role: GroupRole) => groups.setRole(group.id, member.account.id, role),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => groups.removeMember(group.id, member.account.id),
    onSuccess: () => {
      setConfirmRemove(false);
      refresh();
    },
  });
  const isSelf = user?.account.id === member.account.id;
  const canChangeRole = isAdmin(group) && !isSelf && member.account.local;
  const canRemove = !isSelf && isModerator(group) && (member.role === 'member' || isAdmin(group));
  const error = setRole.error ?? remove.error;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <Link
        to="/@{$username}"
        params={{ username: member.account.acct }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded focus-ring"
      >
        <Avatar account={member.account} size="sm" />
        <span className="min-w-0">
          <span className="block truncate font-medium hover:underline">
            {member.account.displayName || member.account.username}
          </span>
          <span className="block truncate text-sm text-fg-muted">@{member.account.acct}</span>
        </span>
      </Link>
      {canChangeRole ? (
        <>
          <label htmlFor={roleId} className="sr-only">
            {t('groups.roleOf', { name: member.account.displayName || member.account.username })}
          </label>
          <select
            id={roleId}
            className="input-base w-auto py-1.5 text-sm"
            value={member.role}
            disabled={setRole.isPending}
            onChange={(event) => setRole.mutate(event.target.value as GroupRole)}
          >
            {roleOrder.map((role) => (
              <option key={role} value={role}>
                {t(`groups.roles.${role}`)}
              </option>
            ))}
          </select>
        </>
      ) : (
        member.role !== 'member' && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {t(`groups.roles.${member.role}`)}
          </span>
        )
      )}
      {canRemove && (
        <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
          {t('groups.remove')}
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={t('groups.removeTitle', {
            name: member.account.displayName || member.account.username,
          })}
          confirmLabel={t('groups.remove')}
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

/** Finds people on this server and invites them. */
function InvitePeople({ group }: { group: Group }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim().replace(/^@/, '')), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const people = useQuery({
    queryKey: ['search', 'accounts', query],
    queryFn: () => social.searchAccounts(query),
    enabled: query.length > 0,
  });
  const invite = useMutation({
    mutationFn: (account: Account) => groups.invite(group.id, account.id),
    onSuccess: (_, account) => {
      setInvited((list) => [...list, account.id]);
      void queryClient.invalidateQueries({ queryKey: ['groups', 'members', group.id] });
    },
  });
  if (group.privacy === 'secret' && !isModerator(group)) return null;
  const candidates = (people.data ?? []).filter((a) => a.local && !a.group).slice(0, 5);
  return (
    <div className="border-b border-border px-4 py-3 sm:px-5">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium">
        {t('groups.invite')}
      </label>
      <input
        id={inputId}
        type="search"
        className="input-base text-sm"
        placeholder={t('groups.invitePlaceholder')}
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      {query && candidates.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
          {candidates.map((account) => (
            <li key={account.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar account={account} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {account.displayName || account.username}
                </span>
                <span className="block truncate text-xs text-fg-muted">@{account.acct}</span>
              </span>
              {invited.includes(account.id) ? (
                <span className="text-sm text-fg-muted">{t('groups.invited')}</span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={invite.isPending}
                  onClick={() => invite.mutate(account)}
                >
                  {t('groups.inviteButton')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {invite.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(invite.error)}
        </p>
      )}
    </div>
  );
}

function Requests({ group }: { group: Group }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: groupKeys.members(group.id, 'requested'),
    queryFn: () => groups.members(group.id, 'requested'),
  });
  const invited = useQuery({
    queryKey: groupKeys.members(group.id, 'invited'),
    queryFn: () => groups.members(group.id, 'invited'),
  });
  const answer = useMutation({
    mutationFn: ({ accountId, accept }: { accountId: string; accept: boolean }) =>
      accept ? groups.approve(group.id, accountId) : groups.reject(group.id, accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups', 'members', group.id] });
      void queryClient.invalidateQueries({ queryKey: groupKeys.group(group.handle) });
    },
  });
  const withdraw = useMutation({
    mutationFn: (accountId: string) => groups.removeMember(group.id, accountId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.members(group.id, 'invited') }),
  });
  return (
    <div>
      <h2 className="px-5 pt-4 text-sm font-semibold">{t('groups.requests')}</h2>
      {requests.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : requests.isError ? (
        <Alert className="m-4">{errorMessage(requests.error)}</Alert>
      ) : requests.data.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">{t('groups.noRequests')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {requests.data.map((member) => (
            <li key={member.account.id}>
              <PersonRow account={member.account}>
                <Button
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ accountId: member.account.id, accept: true })}
                >
                  {t('groups.approve')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ accountId: member.account.id, accept: false })}
                >
                  {t('groups.decline')}
                </Button>
              </PersonRow>
            </li>
          ))}
        </ul>
      )}
      {answer.error && <Alert className="m-4">{errorMessage(answer.error)}</Alert>}
      {invited.data && invited.data.length > 0 && (
        <>
          <h2 className="border-t border-border px-5 pt-4 text-sm font-semibold">
            {t('groups.pendingInvitations')}
          </h2>
          <ul className="divide-y divide-border">
            {invited.data.map((member) => (
              <li key={member.account.id}>
                <PersonRow account={member.account}>
                  <Button
                    variant="ghost"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(member.account.id)}
                  >
                    {t('groups.withdrawInvitation')}
                  </Button>
                </PersonRow>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PersonRow({ account, children }: { account: Account; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <Link
        to="/@{$username}"
        params={{ username: account.acct }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded focus-ring"
      >
        <Avatar account={account} size="sm" />
        <span className="min-w-0">
          <span className="block truncate font-medium hover:underline">
            {account.displayName || account.username}
          </span>
          <span className="block truncate text-sm text-fg-muted">@{account.acct}</span>
        </span>
      </Link>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

const strictness = { public: 0, private: 1, secret: 2 } as const;

function GroupSettings({ group }: { group: Group }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeGroup = useStoreGroup();
  const privacyName = useId();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [privacy, setPrivacy] = useState(group.privacy);
  const [saved, setSaved] = useState(false);
  const [confirmPrivacy, setConfirmPrivacy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useMutation({
    mutationFn: () => groups.update(group.id, { name: name.trim(), description, privacy }),
    onSuccess: (updated) => {
      setConfirmPrivacy(false);
      setSaved(true);
      storeGroup(updated);
    },
  });
  const remove = useMutation({
    mutationFn: () => groups.remove(group.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: groupKeys.group(group.handle) });
      await queryClient.invalidateQueries({ queryKey: groupKeys.all });
      void navigate({ to: '/groups' });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    if (!name.trim()) return;
    if (privacy !== group.privacy) setConfirmPrivacy(true);
    else update.mutate();
  };
  const fieldErrors = fieldErrorsFrom(update.error);
  return (
    <div className="space-y-6 p-4 sm:p-5">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField
          label={t('groups.form.name')}
          value={name}
          maxLength={100}
          error={!name.trim() ? t('validation.required') : fieldErrors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextAreaField
          label={t('groups.form.description')}
          value={description}
          maxLength={2000}
          error={fieldErrors.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('groups.form.privacy')}</legend>
          {(['public', 'private', 'secret'] as const).map((option) => (
            <PrivacyOption
              key={option}
              name={privacyName}
              privacy={option}
              checked={privacy === option}
              disabled={strictness[option] < strictness[group.privacy]}
              onChange={() => setPrivacy(option)}
            />
          ))}
          <p className="text-sm text-fg-muted">{t('groups.form.privacyOneWay')}</p>
        </fieldset>
        <Alert>
          {update.error && Object.keys(fieldErrors).length === 0
            ? errorMessage(update.error)
            : null}
        </Alert>
        <Alert tone="success">{saved ? t('groups.form.saved') : null}</Alert>
        <Button type="submit" loading={update.isPending && !confirmPrivacy}>
          {t('settings.save')}
        </Button>
      </form>

      <GroupImages group={group} />

      <section className="space-y-2 border-t border-border pt-5">
        <h2 className="font-semibold text-danger">{t('groups.deleteTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('groups.deleteDescription')}</p>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {t('groups.delete')}
        </Button>
        {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
      </section>

      {confirmPrivacy && (
        <ConfirmDialog
          title={t('groups.privacyConfirmTitle', {
            privacy: t(`groups.privacy.${privacy}.label`),
          })}
          description={t('groups.privacyConfirm')}
          confirmLabel={t('settings.save')}
          danger={false}
          pending={update.isPending}
          onConfirm={() => update.mutate()}
          onCancel={() => setConfirmPrivacy(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('groups.deleteConfirmTitle', { name: group.name })}
          description={t('groups.deleteDescription')}
          confirmLabel={t('groups.delete')}
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

const GROUP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Upload and removal of the group's picture and cover, with the same checks as profiles. */
function useGroupImages(group: Group) {
  const { t } = useTranslation();
  const limits = useLimits();
  const storeGroup = useStoreGroup();
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: ImageKind; file: File }) =>
      groups.uploadImage(group.id, kind, file),
    onSuccess: storeGroup,
  });
  const remove = useMutation({
    mutationFn: (kind: ImageKind) => groups.removeImage(group.id, kind),
    onSuccess: storeGroup,
  });
  const choose = (kind: ImageKind, file: File) => {
    setProblem(null);
    if (!GROUP_IMAGE_TYPES.includes(file.type)) {
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
    upload.mutate({ kind, file });
  };
  const failure = upload.error ?? remove.error;
  return {
    choose,
    remove,
    uploading: upload.isPending ? upload.variables.kind : null,
    pending: upload.isPending || remove.isPending,
    error: problem ?? (failure ? errorMessage(failure) : null),
  };
}

type ImageKind = 'avatar' | 'header';

/** The round pencil on the group's picture or cover: picks a new image. */
function ImageEditButton({
  label,
  pending,
  onFile,
  className,
}: {
  label: string;
  pending: boolean;
  onFile: (file: File) => void;
  className?: string;
}) {
  return (
    <label
      title={label}
      className={cx(
        'flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-surface/90 text-fg shadow-sm backdrop-blur hover:bg-surface focus-within:ring-2 focus-within:ring-accent',
        className,
      )}
    >
      {pending ? <Spinner /> : <PencilIcon size={16} />}
      <span className="sr-only">{label}</span>
      <input
        type="file"
        accept={GROUP_IMAGE_TYPES.join(',')}
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function GroupImages({ group }: { group: Group }) {
  const { t } = useTranslation();
  const images = useGroupImages(group);
  return (
    <section className="space-y-4 border-t border-border pt-5">
      <h2 className="font-semibold">{t('groups.images')}</h2>
      {(['avatar', 'header'] as const).map((kind) => {
        const current = kind === 'avatar' ? group.avatarUrl : group.headerUrl;
        return (
          <div key={kind} className="flex flex-wrap items-center gap-3">
            <span className="w-full sm:w-60">
              <span className="block text-sm font-medium">{t(`groups.image.${kind}`)}</span>
              <span className="block text-xs text-fg-muted">{t(`groups.image.${kind}Size`)}</span>
            </span>
            <label className={buttonClass('secondary', 'cursor-pointer')}>
              {current ? t('groups.image.change') : t('groups.image.choose')}
              <input
                type="file"
                accept={GROUP_IMAGE_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) images.choose(kind, file);
                }}
              />
            </label>
            {current && (
              <Button variant="ghost" onClick={() => images.remove.mutate(kind)}>
                {t('groups.image.remove')}
              </Button>
            )}
          </div>
        );
      })}
      {images.pending && (
        <p className="text-sm text-fg-muted" role="status">
          {t('common.loading')}
        </p>
      )}
      {images.error && <Alert>{images.error}</Alert>}
    </section>
  );
}
