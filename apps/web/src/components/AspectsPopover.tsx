import type { Account, Relationship } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { social } from '../api/social.ts';
import { useAspects } from '../api/socialQueries.ts';
import { useDismiss } from '../lib/dismiss.ts';
import { AspectsIcon, CheckIcon, ChevronDownIcon } from './icons.tsx';
import { Alert, buttonClass, cx, LoadingState } from './ui.tsx';

/** Puts the account in some of your aspects. Each change saves the full set of aspects. */
export function AspectsPopover({
  account,
  relationship,
}: {
  account: Account;
  relationship: Relationship;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const aspects = useAspects();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const save = useMutation({
    mutationFn: (aspectIds: string[]) => social.setAspectMemberships(account.id, aspectIds),
    onMutate: (aspectIds) => {
      const previous = queryClient.getQueryData<Relationship>(socialKeys.relationship(account.id));
      queryClient.setQueryData<Relationship>(socialKeys.relationship(account.id), (rel) =>
        rel ? { ...rel, aspectIds } : rel,
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(socialKeys.relationship(account.id), context.previous);
    },
    onSuccess: (rel) => {
      queryClient.setQueryData(socialKeys.relationship(account.id), rel);
      void queryClient.invalidateQueries({ queryKey: socialKeys.aspects });
      void queryClient.invalidateQueries({ queryKey: ['aspectMembers'] });
    },
  });

  const current = relationship.aspectIds;
  const names = (aspects.data ?? []).filter((a) => current.includes(a.id)).map((a) => a.name);
  const label =
    names.length === 0
      ? t('profile.aspects.add')
      : names.length <= 2
        ? names.join(', ')
        : t('profile.aspects.inMany', { count: names.length });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass(
          names.length > 0 ? 'secondary' : 'secondary',
          cx('max-w-64', names.length > 0 && 'border-accent/50 bg-accent-soft text-accent'),
        )}
      >
        {names.length > 0 ? <CheckIcon size={16} /> : <AspectsIcon size={16} />}
        <span className="truncate">{label}</span>
        <ChevronDownIcon size={16} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 z-30 mt-2 w-72 sticker rounded-2xl bg-surface p-2"
      >
        <fieldset>
          <legend className="px-2 py-1 text-sm font-semibold">
            {t('profile.aspects.legend', { name: account.displayName || account.username })}
          </legend>
          {aspects.isPending ? (
            <LoadingState label={t('common.loading')} />
          ) : aspects.data && aspects.data.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto">
              {aspects.data.map((aspect) => (
                <li key={aspect.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent focus-ring"
                      checked={current.includes(aspect.id)}
                      onChange={(event) =>
                        save.mutate(
                          event.target.checked
                            ? [...current, aspect.id]
                            : current.filter((id) => id !== aspect.id),
                        )
                      }
                    />
                    <span className="flex-1 truncate text-sm">{aspect.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-sm text-fg-muted">{t('composer.audience.noAspects')}</p>
          )}
        </fieldset>
        {save.error && <Alert className="m-2">{errorMessage(save.error)}</Alert>}
        <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2">
          <Link to="/aspects" className="rounded text-sm text-accent hover:underline focus-ring">
            {t('profile.aspects.manage')}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-surface-muted focus-ring"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
