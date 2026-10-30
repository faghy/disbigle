import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type AdminDashboard, admin, adminKeys } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { CheckIcon, WarningIcon } from '../../components/icons.tsx';
import { Alert, Card, cx, LoadingState } from '../../components/ui.tsx';
import { fullDateTime } from '../../lib/time.ts';
import { BarChart } from './BarChart.tsx';
import { UserRow } from './Users.tsx';

/** "1.2 GB", "340 MB"… in the reader's language. */
export function formatBytes(bytes: number, language: string) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

/** "3 d 4 h", "5 h 12 min" or "8 min". */
function formatDuration(seconds: number, language: string) {
  const unit = (value: number, name: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(language, { style: 'unit', unit: name, unitDisplay: 'short' }).format(
      value,
    );
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${unit(days, 'day')} ${unit(hours, 'hour')}`;
  if (hours > 0) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
  return unit(minutes, 'minute');
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const dashboard = useQuery({
    queryKey: adminKeys.dashboard,
    queryFn: admin.dashboard,
    refetchInterval: 60_000,
  });
  if (dashboard.isPending) return <LoadingState label={t('common.loading')} />;
  if (dashboard.isError) return <Alert>{errorMessage(dashboard.error)}</Alert>;
  const data = dashboard.data;
  return (
    <section aria-labelledby="dashboard-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-title" className="text-lg font-semibold">
          {t('admin.tabs.dashboard')}
        </h2>
        <p className="text-xs text-fg-muted">
          {t('admin.dashboard.updated', { time: fullDateTime(data.generatedAt, i18n.language) })}
        </p>
      </div>
      <Numbers data={data} />
      <LatestUsers />
      <Card className="grid gap-6 p-4 sm:grid-cols-2 sm:p-5">
        <BarChart title={t('admin.dashboard.charts.signups')} data={data.daily.signups} />
        <BarChart title={t('admin.dashboard.charts.localPosts')} data={data.daily.localPosts} />
        <BarChart title={t('admin.dashboard.charts.remotePosts')} data={data.daily.remotePosts} />
        <BarChart title={t('admin.dashboard.charts.received')} data={data.traffic.daily.received} />
      </Card>
      <Federation data={data} />
      <Server data={data} />
    </section>
  );
}

/** A headline number; with `to`, the label and number open that page. */
function Stat({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: number;
  note?: ReactNode;
  to?: '/admin/users' | '/admin/groups';
}) {
  const { i18n } = useTranslation();
  const body = (
    <>
      <span className="block text-sm text-fg-muted">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tracking-tight tabular-nums">
        {new Intl.NumberFormat(i18n.language).format(value)}
      </span>
    </>
  );
  return (
    <div
      className={cx(
        'rounded-2xl border border-border bg-surface p-4',
        to && 'transition-colors hover:border-accent hover:bg-accent-soft',
      )}
    >
      {to ? (
        <Link to={to} className="block rounded focus-ring">
          {body}
        </Link>
      ) : (
        body
      )}
      {note && <p className="mt-0.5 text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function Numbers({ data }: { data: AdminDashboard }) {
  const { t } = useTranslation();
  const { users, content, federation } = data;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={t('admin.dashboard.users')}
        value={users.total}
        to="/admin/users"
        note={
          <>
            {t('admin.dashboard.newThisWeek', { count: users.new.week })}
            {users.pending > 0 && (
              <>
                {' · '}
                <Link to="/admin/pending" className="text-accent hover:underline">
                  {t('admin.dashboard.pending', { count: users.pending })}
                </Link>
              </>
            )}
          </>
        }
      />
      <Stat
        label={t('admin.dashboard.activeWeek')}
        value={users.active.week}
        note={t('admin.dashboard.activeOther', {
          day: users.active.day,
          month: users.active.month,
        })}
      />
      <Stat
        label={t('admin.dashboard.localPosts')}
        value={content.localPosts}
        note={t('admin.dashboard.remotePosts', { count: content.remotePosts })}
      />
      <Stat
        label={t('admin.dashboard.instances')}
        value={federation.instances}
        note={t('admin.dashboard.remoteAccounts', { count: federation.remoteAccounts })}
      />
      <Stat label={t('admin.dashboard.groups')} value={content.groups} to="/admin/groups" />
      <Stat label={t('admin.dashboard.remoteFollowers')} value={federation.remoteFollowers} />
      <Stat label={t('admin.dashboard.remoteFollowing')} value={federation.remoteFollowing} />
      <Stat label={t('admin.dashboard.suspended')} value={users.suspended} />
    </div>
  );
}

/** The newest people, with their details, and the way to the full list. */
function LatestUsers() {
  const { t } = useTranslation();
  const users = useQuery({ queryKey: adminKeys.users(''), queryFn: () => admin.users() });
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
        <h3 className="font-semibold">{t('admin.dashboard.latestUsers')}</h3>
        <Link to="/admin/users" className="text-sm font-medium text-accent hover:underline">
          {t('admin.dashboard.allUsers', { count: users.data?.length ?? 0 })}
        </Link>
      </div>
      {users.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : users.isError ? (
        <Alert className="m-4">{errorMessage(users.error)}</Alert>
      ) : (
        <ul aria-label={t('admin.dashboard.latestUsers')} className="divide-y divide-border">
          {users.data.slice(0, 5).map((user) => (
            <li key={user.userId}>
              <UserRow user={user} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Federation({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const { traffic, server } = data;
  const sum = (days: { count: number }[]) => days.slice(-7).reduce((s, d) => s + d.count, 0);
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">{t('admin.dashboard.federationTitle')}</h3>
        <p className="text-sm text-fg-muted">{t('admin.dashboard.federationHint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('admin.dashboard.receivedWeek')} value={sum(traffic.daily.received)} />
        <Stat label={t('admin.dashboard.rejectedWeek')} value={sum(traffic.daily.rejected)} />
        <Stat label={t('admin.dashboard.failedWeek')} value={sum(traffic.daily.failed)} />
      </div>
      {server.queues && (
        <p className="text-sm text-fg-muted">
          {t('admin.dashboard.queues', {
            activitypub: number.format(server.queues.activitypub.waiting),
            activitypubRetry: number.format(server.queues.activitypub.retrying),
            diaspora: number.format(server.queues.diaspora.waiting),
            diasporaRetry: number.format(server.queues.diaspora.retrying),
            diasporaFailed: number.format(server.queues.diaspora.failed),
          })}
        </p>
      )}
      {traffic.servers.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('admin.dashboard.noTraffic')}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">{t('admin.dashboard.serversCaption')}</caption>
            <thead>
              <tr className="border-y border-border text-left text-xs text-fg-muted">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  {t('admin.dashboard.server')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {t('admin.dashboard.received')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {t('admin.dashboard.rejected')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">
                  {t('admin.dashboard.failed')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {traffic.servers.map((row) => (
                <tr key={row.domain}>
                  <th scope="row" className="px-4 py-2 text-left font-mono font-medium sm:px-5">
                    {row.domain === 'unknown'
                      ? t('admin.dashboard.unknownServer')
                      : row.domain === 'unsigned'
                        ? t('admin.dashboard.unsigned')
                        : row.domain}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {number.format(row.received)}
                  </td>
                  <td
                    className={cx(
                      'px-2 py-2 text-right tabular-nums',
                      row.rejected > 0 && 'text-danger',
                    )}
                  >
                    {number.format(row.rejected)}
                  </td>
                  <td
                    className={cx(
                      'px-4 py-2 text-right tabular-nums sm:px-5',
                      row.failedDeliveries > 0 && 'text-danger',
                    )}
                  >
                    {number.format(row.failedDeliveries)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** A used/total bar with a plain-words level: fine, high (over 80%) or critical (over 90%). */
function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const { t, i18n } = useTranslation();
  const share = total > 0 ? used / total : 0;
  const level = share > 0.9 ? 'critical' : share > 0.8 ? 'high' : 'ok';
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(share);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-fg-muted tabular-nums">
          {t('admin.dashboard.usedOf', {
            used: formatBytes(used, i18n.language),
            total: formatBytes(total, i18n.language),
            percent,
          })}
        </span>
      </div>
      <meter className="sr-only" min={0} max={1} value={share} aria-label={label}>
        {percent}
      </meter>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div
          className={cx(
            'h-full rounded-full',
            level === 'ok' ? 'bg-success' : level === 'high' ? 'bg-accent' : 'bg-danger',
          )}
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
      {level !== 'ok' && (
        <p
          className={cx(
            'flex items-center gap-1 text-xs',
            level === 'high' ? 'text-accent' : 'text-danger',
          )}
        >
          <WarningIcon size={14} />
          {t(`admin.dashboard.level.${level}`)}
        </p>
      )}
    </div>
  );
}

function Server({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const { host, process, disk, databaseBytes, redisBytes } = data.server;
  const load = host.load[0] ?? 0;
  const busy = load > host.cpus;
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const facts: [string, string][] = [
    [
      t('admin.dashboard.load'),
      t('admin.dashboard.loadValue', {
        values: host.load.map((v) => number.format(v)).join(' · '),
        cpus: host.cpus,
      }),
    ],
    [t('admin.dashboard.process'), formatBytes(process.rss, i18n.language)],
    ...(databaseBytes !== null
      ? [
          [t('admin.dashboard.database'), formatBytes(databaseBytes, i18n.language)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(redisBytes !== null
      ? [[t('admin.dashboard.redis'), formatBytes(redisBytes, i18n.language)] as [string, string]]
      : []),
    [t('admin.dashboard.appUptime'), formatDuration(process.uptimeSeconds, i18n.language)],
    [t('admin.dashboard.hostUptime'), formatDuration(host.uptimeSeconds, i18n.language)],
    [t('admin.dashboard.node'), process.node],
  ];
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">{t('admin.dashboard.serverTitle')}</h3>
        <p className="text-sm text-fg-muted">{t('admin.dashboard.serverHint')}</p>
      </div>
      <p
        className={cx(
          'flex items-center gap-1.5 text-sm font-medium',
          busy ? 'text-danger' : 'text-success',
        )}
      >
        {busy ? <WarningIcon size={16} /> : <CheckIcon size={16} />}
        {busy ? t('admin.dashboard.busy') : t('admin.dashboard.calm')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Meter
          label={t('admin.dashboard.memory')}
          used={host.memoryTotal - host.memoryFree}
          total={host.memoryTotal}
        />
        {disk && (
          <Meter
            label={t('admin.dashboard.disk')}
            used={disk.total - disk.free}
            total={disk.total}
          />
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-3 border-b border-border py-1.5">
            <dt className="text-fg-muted">{term}</dt>
            <dd className="text-right font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
