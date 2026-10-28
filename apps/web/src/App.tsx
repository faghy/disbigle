import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { instanceQueryOptions } from './api/queries.ts';
import { StreamingProvider } from './components/StreamingProvider.tsx';
import { trackingRefused, trackPageView } from './lib/analytics.ts';
import { createAppRouter } from './router.tsx';

export function App({
  queryClient,
  router,
}: {
  queryClient: QueryClient;
  router?: ReturnType<typeof createAppRouter>;
}) {
  const [appRouter] = useState(() => router ?? createAppRouter(queryClient));
  // Anonymous page views, when this server uses Matomo (see lib/analytics.ts).
  useEffect(() => {
    if (trackingRefused()) return;
    // The first screen can be reported both here and by the router's first event: once only.
    let lastTracked = '';
    const track = async () => {
      const href = appRouter.state.location.href;
      const pattern = appRouter.state.matches.at(-1)?.fullPath;
      // Not resolved yet: the router's event reports it.
      if (!pattern || href === lastTracked) return;
      lastTracked = href;
      const analytics = (await queryClient.fetchQuery(instanceQueryOptions).catch(() => null))
        ?.analytics;
      if (analytics) trackPageView(analytics, pattern);
    };
    void track();
    return appRouter.subscribe('onResolved', (event) => {
      if (event.pathChanged) void track();
    });
  }, [appRouter, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <StreamingProvider>
        <RouterProvider router={appRouter} />
      </StreamingProvider>
    </QueryClientProvider>
  );
}
