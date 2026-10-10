import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from '@tanstack/react-router';
import { meQueryOptions } from './api/queries.ts';
import { RootLayout } from './components/Layout.tsx';
import { ErrorPage, NotFoundPage } from './pages/ErrorPages.tsx';
import { HomePage } from './pages/Home.tsx';
import { LoginPage } from './pages/Login.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { RegisterPage } from './pages/Register.tsx';
import { AccountSettingsPage } from './pages/settings/AccountSettings.tsx';
import { ProfileSettingsPage } from './pages/settings/ProfileSettings.tsx';
import { SecuritySettingsPage } from './pages/settings/SecuritySettings.tsx';
import { SettingsLayout } from './pages/settings/SettingsLayout.tsx';

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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
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
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
