import '@fontsource-variable/geist';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { startApp } from '@/lib/native';
import { registerServiceWorker } from '@/lib/push';
import { queryClient } from '@/lib/queries';
import { router } from '@/router';

registerServiceWorker();

// The Android app reads its pairing before anything asks the server for data.
void startApp().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
