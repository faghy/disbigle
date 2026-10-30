import type { Status } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { groupKeys, groups } from '../api/groups.ts';
import { Modal } from './Dialog.tsx';
import { GroupAvatar, PrivacyLabel } from './GroupParts.tsx';
import { Alert, Button, LoadingState } from './ui.tsx';

/** Picks one or more of your groups to share a public post in; pressing again takes it back. */
export function ShareToGroupDialog({ status, onClose }: { status: Status; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: groupKeys.list('mine'), queryFn: () => groups.list('mine') });
  const [shared, setShared] = useState<Set<string>>(new Set());
  const toggle = useMutation({
    mutationFn: async ({ groupId, share }: { groupId: string; share: boolean }) => {
      if (share) await groups.share(status.id, groupId);
      else await groups.unshare(status.id, groupId);
    },
    onSuccess: (_result, { groupId, share }) => {
      setShared((current) => {
        const next = new Set(current);
        if (share) next.add(groupId);
        else next.delete(groupId);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: socialKeys.timeline('group', groupId) });
    },
  });
  // A post can't be shared back into the group it was written in.
  const choices = (mine.data ?? []).filter((group) => group.id !== status.group?.id);

  return (
    <Modal
      title={t('shareToGroup.title')}
      description={t('shareToGroup.description')}
      onClose={onClose}
    >
      {mine.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : mine.isError ? (
        <Alert>{errorMessage(mine.error)}</Alert>
      ) : choices.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">{t('shareToGroup.noGroups')}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {choices.map((group) => {
            const done = shared.has(group.id);
            return (
              <li key={group.id} className="flex items-center gap-3 py-2.5">
                <GroupAvatar group={group} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{group.name}</span>
                  <PrivacyLabel privacy={group.privacy} className="text-xs" />
                </span>
                <Button
                  variant={done ? 'secondary' : 'primary'}
                  className="min-h-9 px-3 py-1 text-sm"
                  aria-pressed={done}
                  aria-label={
                    done
                      ? t('shareToGroup.undoIn', { name: group.name })
                      : t('shareToGroup.shareIn', { name: group.name })
                  }
                  loading={toggle.isPending && toggle.variables?.groupId === group.id}
                  onClick={() => toggle.mutate({ groupId: group.id, share: !done })}
                >
                  {done ? t('shareToGroup.shared') : t('shareToGroup.share')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {toggle.error && <Alert className="mt-3">{errorMessage(toggle.error)}</Alert>}
    </Modal>
  );
}
