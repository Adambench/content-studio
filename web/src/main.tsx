import '@fontsource-variable/geist';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Shell } from '@/components/Shell';
import { Toaster } from '@/components/ui/sonner';
import { ApiError, api, loadSavedToken } from '@/lib/api';
import { connectNative } from '@/lib/native';
import { connectLive, queryClient } from '@/lib/queries';
import { BrainPage } from '@/pages/BrainPage';
import { InboxPage } from '@/pages/InboxPage';
import { ServerPage } from '@/pages/ServerPage';
import { SignInPage } from '@/pages/SignInPage';
import { VideoPage } from '@/pages/VideoPage';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <InboxPage /> },
      { path: '/p/:pageId', element: <InboxPage /> },
      { path: '/v/:videoId', element: <VideoPage /> },
      { path: '/brain', element: <BrainPage /> },
      { path: '/server', element: <ServerPage /> },
      { path: '*', element: <InboxPage /> },
    ],
  },
]);

function App() {
  useEffect(() => connectLive(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}

await connectNative();
loadSavedToken();
// Off the tailnet, nothing but a paired device gets in: ask for a code first.
const signedIn = await api('/api/signed-in').then(
  () => true,
  (e) => !(e instanceof ApiError && e.status === 401),
);
createRoot(document.getElementById('root')!).render(<StrictMode>{signedIn ? <App /> : <SignInPage />}</StrictMode>);
