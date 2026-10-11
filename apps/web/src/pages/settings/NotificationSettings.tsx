import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../api/errors.ts';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  LoadingState,
  PageTitle,
} from '../../components/ui.tsx';
import {
  defaultPushAlerts,
  detectPushSupport,
  ensureServiceWorker,
  forgetAlerts,
  loadAlerts,
  type PushAlerts,
  type PushAlertType,
  pushAlertTypes,
  pushApi,
  saveAlerts,
  urlBase64ToUint8Array,
} from '../../lib/push.ts';

type PermissionState = NotificationPermission | 'unknown';

/** Browser push errors have their own meaning (not the WebAuthn one `errorMessage` assumes). */
function pushErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof Error && error.name === 'NotAllowedError')
    return t('settings.notifications.denied');
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'InvalidStateError'))
    return t('settings.notifications.subscribeFailed');
  return errorMessage(error);
}

export function NotificationSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle description={t('settings.notifications.description')}>
        {t('settings.notifications.title')}
      </PageTitle>
      <PushCard />
    </>
  );
}

function PushCard() {
  const { t } = useTranslation();
  const [support] = useState(detectPushSupport);
  const [permission, setPermission] = useState<PermissionState>(() =>
    typeof Notification === 'undefined' ? 'unknown' : Notification.permission,
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [alerts, setAlerts] = useState<PushAlerts>(defaultPushAlerts);
  const [loading, setLoading] = useState(support === 'supported');

  // Look for an existing subscription on this device (without registering anything).
  useEffect(() => {
    if (support !== 'supported') return;
    let cancelled = false;
    (async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const existing = (await registration?.pushManager.getSubscription()) ?? null;
      if (cancelled) return;
      setSubscription(existing);
      if (existing) {
        const server = await pushApi.get(existing.endpoint).catch(() => undefined);
        if (cancelled) return;
        if (server) {
          const alerts = { ...defaultPushAlerts, ...server.alerts };
          setAlerts(alerts);
          saveAlerts(existing.endpoint, alerts);
        } else {
          // Unknown to the server (or it could not be asked): send it again with the
          // choices remembered on this device, tied to whoever is signed in now.
          const saved = loadAlerts(existing.endpoint);
          setAlerts(saved);
          void pushApi.save(existing, saved).catch(() => {});
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [support]);

  const enable = useMutation({
    mutationFn: async () => {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return null;
      const [registration, { publicKey }] = await Promise.all([
        ensureServiceWorker(),
        pushApi.key(),
      ]);
      await navigator.serviceWorker.ready;
      const created = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      try {
        const saved = await pushApi.save(created, alerts);
        saveAlerts(created.endpoint, saved.alerts);
        setAlerts({ ...defaultPushAlerts, ...saved.alerts });
      } catch (error) {
        // Do not leave a browser subscription the server does not know about.
        await created.unsubscribe().catch(() => {});
        throw error;
      }
      return created;
    },
    onSuccess: (created) => {
      if (created) setSubscription(created);
    },
  });

  const disable = useMutation({
    mutationFn: async (current: PushSubscription) => {
      await pushApi.remove(current.endpoint);
      await current.unsubscribe();
      forgetAlerts();
    },
    onSuccess: () => setSubscription(null),
  });

  const update = useMutation({
    mutationFn: async ({ current, next }: { current: PushSubscription; next: PushAlerts }) =>
      pushApi.save(current, next),
    onMutate: ({ next }) => {
      const previous = alerts;
      setAlerts(next);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context) setAlerts(context.previous);
    },
    onSuccess: (saved, { current }) => saveAlerts(current.endpoint, saved.alerts),
  });

  const error = enable.error ?? disable.error ?? update.error;

  let body: ReactNode;
  if (support === 'unsupported') {
    body = <Alert tone="info">{t('settings.notifications.unsupported')}</Alert>;
  } else if (support === 'ios-install') {
    body = (
      <div className="space-y-2 text-sm">
        <Alert tone="info">{t('settings.notifications.iosIntro')}</Alert>
        <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
          <li>{t('settings.notifications.iosStep1')}</li>
          <li>{t('settings.notifications.iosStep2')}</li>
          <li>{t('settings.notifications.iosStep3')}</li>
        </ol>
      </div>
    );
  } else if (loading) {
    body = <LoadingState label={t('common.loading')} />;
  } else if (subscription) {
    body = (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          {t('settings.notifications.on')}
        </p>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">
            {t('settings.notifications.typesLegend')}
          </legend>
          {pushAlertTypes.map((type: PushAlertType) => (
            <CheckboxField
              key={type}
              label={t(`settings.notifications.types.${type}`)}
              checked={alerts[type]}
              disabled={update.isPending}
              onChange={(event) =>
                update.mutate({
                  current: subscription,
                  next: { ...alerts, [type]: event.target.checked },
                })
              }
            />
          ))}
        </fieldset>
        <p role="status" className="text-xs text-success empty:hidden">
          {update.isSuccess && !update.isPending ? t('settings.saved') : ''}
        </p>
        <Button
          variant="secondary"
          loading={disable.isPending}
          onClick={() => disable.mutate(subscription)}
        >
          {t('settings.notifications.disable')}
        </Button>
      </div>
    );
  } else if (permission === 'denied') {
    body = <Alert tone="info">{t('settings.notifications.denied')}</Alert>;
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">{t('settings.notifications.offHint')}</p>
        {enable.isSuccess && enable.data === null && (
          <Alert tone="info">{t('settings.notifications.notAllowed')}</Alert>
        )}
        <Button loading={enable.isPending} onClick={() => enable.mutate()}>
          {t('settings.notifications.enable')}
        </Button>
      </div>
    );
  }

  return (
    <Card aria-labelledby="push-title" className="space-y-4">
      <div>
        <h2 id="push-title" className="font-semibold">
          {t('settings.notifications.pushTitle')}
        </h2>
        <p className="text-sm text-fg-muted">{t('settings.notifications.pushHint')}</p>
      </div>
      {body}
      <Alert>{error ? pushErrorMessage(error, t) : null}</Alert>
    </Card>
  );
}
