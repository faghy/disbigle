import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from '@tanstack/react-router';
import { isAdmin, isModerator } from './api/admin.ts';
import { meQueryOptions } from './api/queries.ts';
import { RootLayout } from './components/Layout.tsx';
import { fullNavigation, safeRedirect } from './lib/redirect.ts';
import { AboutPage } from './pages/About.tsx';
import { AspectsPage } from './pages/Aspects.tsx';
import { AccountsPage } from './pages/admin/Accounts.tsx';
import { AdminGroupsPage } from './pages/admin/AdminGroups.tsx';
import { AdminLayout } from './pages/admin/AdminLayout.tsx';
import { DashboardPage } from './pages/admin/Dashboard.tsx';
import { DomainBlocksPage } from './pages/admin/DomainBlocks.tsx';
import { FederationPage } from './pages/admin/Federation.tsx';
import { InstanceSettingsPage } from './pages/admin/InstanceSettings.tsx';
import { PendingPage } from './pages/admin/Pending.tsx';
import { ReportsPage } from './pages/admin/Reports.tsx';
import { UsersPage } from './pages/admin/Users.tsx';
import { ContactsPage } from './pages/Contacts.tsx';
import { ErrorPage, NotFoundPage } from './pages/ErrorPages.tsx';
import { GroupPage } from './pages/Group.tsx';
import { GroupsPage } from './pages/Groups.tsx';
import { HomePage } from './pages/Home.tsx';
import { LoginPage } from './pages/Login.tsx';
import { MessagesPage } from './pages/Messages.tsx';
import { NotificationsPage } from './pages/Notifications.tsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordReset.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { RegisterPage } from './pages/Register.tsx';
import { isSearchType, SearchPage, type SearchType } from './pages/Search.tsx';
import { StatusPage } from './pages/StatusPage.tsx';
import { AccountSettingsPage } from './pages/settings/AccountSettings.tsx';
import { AuthorizedAppsPage } from './pages/settings/AuthorizedApps.tsx';
import { InvitesPage } from './pages/settings/Invites.tsx';
import { MutedWordsPage } from './pages/settings/MutedWords.tsx';
import { NotificationSettingsPage } from './pages/settings/NotificationSettings.tsx';
import { ProfileSettingsPage } from './pages/settings/ProfileSettings.tsx';
import { SecuritySettingsPage } from './pages/settings/SecuritySettings.tsx';
import { SettingsLayout } from './pages/settings/SettingsLayout.tsx';
import {
  AspectTimelinePage,
  BookmarksPage,
  FederatedTimelinePage,
  LocalTimelinePage,
  TagTimelinePage,
} from './pages/Timelines.tsx';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

/** Pages for visitors only: signed-in users go to the home page. */
async function guestOnly({
  context,
  search,
}: {
  context: RouterContext;
  search: { redirect?: string | undefined };
}) {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (!me) return;
  if (search.redirect) {
    // Already signed in: continue to the requested page (served by the server, e.g. OAuth).
    fullNavigation.assign(search.redirect);
    // Stay pending while the browser leaves the app.
    await new Promise<never>(() => {});
  }
  throw redirect({ to: '/' });
}

/** Pages for signed-in users only. */
async function signedInOnly({ context }: { context: RouterContext }) {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (!me) throw redirect({ to: '/login' });
}

/** The moderation area: moderators and administrators only. */
async function moderatorsOnly({ context }: { context: RouterContext }) {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (!me) throw redirect({ to: '/login' });
  if (!isModerator(me)) throw redirect({ to: '/' });
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (
    search: Record<string, unknown>,
  ): { reset?: 'done' | undefined; redirect?: string | undefined } => ({
    reset: search.reset === 'done' ? 'done' : undefined,
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: guestOnly,
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  validateSearch: (
    search: Record<string, unknown>,
  ): { invite?: string | undefined; redirect?: string | undefined } => ({
    invite:
      typeof search.invite === 'string' && search.invite.trim()
        ? search.invite.trim().slice(0, 64)
        : undefined,
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: guestOnly,
  component: RegisterPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: signedInOnly,
  component: SettingsLayout,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' });
  },
});

const settingsProfileRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/profile',
  component: ProfileSettingsPage,
});

const settingsAccountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/account',
  component: AccountSettingsPage,
});

const settingsAppsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/apps',
  component: AuthorizedAppsPage,
});

const settingsMutedWordsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/muted-words',
  component: MutedWordsPage,
});

const settingsInvitesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/invites',
  component: InvitesPage,
});

const settingsNotificationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/notifications',
  component: NotificationSettingsPage,
});

const settingsSecurityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/security',
  component: SecuritySettingsPage,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/@{$username}',
  component: ProfilePage,
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/@{$username}/$statusId',
  component: StatusPage,
});

const localRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/local',
  component: LocalTimelinePage,
});

const federatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public',
  component: FederatedTimelinePage,
});

const tagRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tags/$tag',
  component: TagTimelinePage,
});

const bookmarksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bookmarks',
  beforeLoad: signedInOnly,
  component: BookmarksPage,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  beforeLoad: signedInOnly,
  component: NotificationsPage,
});

const groupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/groups',
  component: GroupsPage,
});

const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/groups/$handle',
  component: GroupPage,
});

const aspectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aspects',
  beforeLoad: signedInOnly,
  component: AspectsPage,
});

const contactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contacts',
  beforeLoad: signedInOnly,
  // `?aspect=<id>` shows one aspect, `?only=followers` those who follow you only.
  validateSearch: (
    search: Record<string, unknown>,
  ): { aspect?: string | undefined; only?: 'followers' | undefined } => ({
    aspect: typeof search.aspect === 'string' ? search.aspect : undefined,
    only: search.only === 'followers' ? 'followers' : undefined,
  }),
  component: ContactsPage,
});

const aspectTimelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aspects/$aspectId',
  beforeLoad: signedInOnly,
  component: AspectTimelinePage,
});

const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/messages',
  // `?to=user@server` opens a new message to that person (the profile's "Message" button).
  validateSearch: (search: Record<string, unknown>): { to?: string | undefined } => ({
    to:
      typeof search.to === 'string' && /^@?[\w.-]+(@[\w.:-]+)?$/.test(search.to)
        ? search.to.replace(/^@/, '')
        : undefined,
  }),
  beforeLoad: signedInOnly,
  component: MessagesPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string | undefined; type?: SearchType | undefined } => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.slice(0, 500) : undefined,
    type: isSearchType(search.type) && search.type !== 'accounts' ? search.type : undefined,
  }),
  component: SearchPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: moderatorsOnly,
  component: AdminLayout,
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  // Administrators start from the overview, moderators from the waiting list.
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    throw redirect({ to: isAdmin(me) ? '/admin/dashboard' : '/admin/pending' });
  },
});

const adminsOnly = async ({ context }: { context: { queryClient: QueryClient } }) => {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (!isAdmin(me)) throw redirect({ to: '/admin/pending' });
};

const adminDashboardRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/dashboard',
  beforeLoad: adminsOnly,
  component: DashboardPage,
});

const adminGroupsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/groups',
  beforeLoad: adminsOnly,
  component: AdminGroupsPage,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  beforeLoad: adminsOnly,
  component: UsersPage,
});

const adminPendingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/pending',
  component: PendingPage,
});

const adminReportsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/reports',
  component: ReportsPage,
});

const adminAccountsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/accounts',
  component: AccountsPage,
});

const adminInstanceRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/instance',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!isAdmin(me)) throw redirect({ to: '/admin/pending' });
  },
  component: InstanceSettingsPage,
});

const adminFederationRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/federation',
  component: FederationPage,
});

const adminDomainsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/domains',
  validateSearch: (search: Record<string, unknown>): { domain?: string | undefined } => ({
    domain: typeof search.domain === 'string' ? search.domain.slice(0, 253) : undefined,
  }),
  component: DomainBlocksPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: ({ context }) => guestOnly({ context, search: {} }),
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search.token === 'string' ? search.token.slice(0, 200) : undefined,
  }),
  component: ResetPasswordPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    settingsProfileRoute,
    settingsAccountRoute,
    settingsSecurityRoute,
    settingsNotificationsRoute,
    settingsInvitesRoute,
    settingsMutedWordsRoute,
    settingsAppsRoute,
  ]),
  profileRoute,
  statusRoute,
  localRoute,
  federatedRoute,
  tagRoute,
  bookmarksRoute,
  notificationsRoute,
  groupsRoute,
  groupRoute,
  aspectsRoute,
  contactsRoute,
  aspectTimelineRoute,
  searchRoute,
  aboutRoute,
  messagesRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminDashboardRoute,
    adminUsersRoute,
    adminGroupsRoute,
    adminPendingRoute,
    adminReportsRoute,
    adminAccountsRoute,
    adminDomainsRoute,
    adminFederationRoute,
    adminInstanceRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Remote handles keep their `@` in the address bar: /@carol@mastodon.example
    pathParamsAllowedCharacters: ['@'],
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
