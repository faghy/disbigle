import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createAppRouter } from './router.tsx';

export function App({
  queryClient,
  router,
}: {
  queryClient: QueryClient;
  router?: ReturnType<typeof createAppRouter>;
}) {
  const [appRouter] = useState(() => router ?? createAppRouter(queryClient));
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={appRouter} />
    </QueryClientProvider>
  );
}
