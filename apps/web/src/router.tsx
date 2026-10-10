import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from '@tanstack/react-router';
import { isModerator } from './api/admin.ts';
import { meQueryOptions } from './api/queries.ts';
import { RootLayout } from './components/Layout.tsx';
import { AspectsPage } from './pages/Aspects.tsx';
import { AccountsPage } from './pages/admin/Accounts.tsx';
import { AdminLayout } from './pages/admin/AdminLayout.tsx';
import { DomainBlocksPage } from './pages/admin/DomainBlocks.tsx';
import { PendingPage } from './pages/admin/Pending.tsx';
import { ReportsPage } from './pages/admin/Reports.tsx';
import { ErrorPage, NotFoundPage } from './pages/ErrorPages.tsx';
import { HomePage } from './pages/Home.tsx';
import { LoginPage } from './pages/Login.tsx';
import { NotificationsPage } from './pages/Notifications.tsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordReset.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { RegisterPage } from './pages/Register.tsx';
import { SearchPage } from './pages/Search.tsx';
import { StatusPage } from './pages/StatusPage.tsx';
import { AccountSettingsPage } from './pages/settings/AccountSettings.tsx';
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
async function guestOnly({ context }: { context: RouterContext }) {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (me) throw redirect({ to: '/' });
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
  validateSearch: (search: Record<string, unknown>): { reset?: 'done' | undefined } => ({
    reset: search.reset === 'done' ? 'done' : undefined,
  }),
  beforeLoad: guestOnly,
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
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

const aspectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aspects',
  beforeLoad: signedInOnly,
  component: AspectsPage,
});

const aspectTimelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aspects/$aspectId',
  beforeLoad: signedInOnly,
  component: AspectTimelinePage,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): { q?: string | undefined } => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.slice(0, 500) : undefined,
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
  beforeLoad: () => {
    throw redirect({ to: '/admin/pending' });
  },
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

const adminDomainsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/domains',
  component: DomainBlocksPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: guestOnly,
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
  ]),
  profileRoute,
  statusRoute,
  localRoute,
  federatedRoute,
  tagRoute,
  bookmarksRoute,
  notificationsRoute,
  aspectsRoute,
  aspectTimelineRoute,
  searchRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminPendingRoute,
    adminReportsRoute,
    adminAccountsRoute,
    adminDomainsRoute,
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
