import '@fontsource-variable/geist';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { Shell } from '@/components/Shell';
import { connectLive, queryClient } from '@/lib/queries';
import { connectNative } from '@/lib/native';
import { BoardPage } from '@/pages/BoardPage';
import { CardPage } from '@/pages/CardPage';
import { PageSettingsPage } from '@/pages/PageSettingsPage';
import { RulesPage } from '@/pages/RulesPage';
import { SettingsPage } from '@/pages/SettingsPage';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <BoardPage /> },
      { path: '/p/:pageId', element: <BoardPage /> },
      { path: '/p/:pageId/settings', element: <PageSettingsPage /> },
      { path: '/c/:cardId', element: <CardPage /> },
      { path: '/rules', element: <RulesPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <BoardPage /> },
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
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
