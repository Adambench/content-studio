import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { isApp } from '@/lib/native';
import { AccountsPage } from '@/pages/AccountsPage';
import { CardPage } from '@/pages/CardPage';
import { HomePage, SectionPage } from '@/pages/HomePage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { LoginPage } from '@/pages/LoginPage';
import { NewWorkspacePage } from '@/pages/NewWorkspacePage';
import { PairPage } from '@/pages/PairPage';
import { SeriesPage } from '@/pages/SeriesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SharePage } from '@/pages/SharePage';
import { ToolboxPage } from '@/pages/ToolboxPage';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettingsPage';

/** Addresses from before Phase 14 (old notifications, bookmarks) land where they belong now. */
function Legacy() {
  const { wid, pid } = useParams();
  if (pid) return <Navigate to={`/c/${pid}`} replace />;
  return <Navigate to={wid ? `/p/${wid}` : '/'} replace />;
}

export const router = createBrowserRouter([
  // The Android app pairs instead of signing in with a password.
  { path: '/login', element: isApp ? <Navigate to="/pair" replace /> : <LoginPage /> },
  { path: '/pair', element: isApp ? <PairPage /> : <Navigate to="/login" replace /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'p/:wid', element: <SectionPage /> },
          { path: 'p/:wid/:section', element: <SectionPage /> },
          { path: 'p/:wid/series/:sid', element: <SeriesPage /> },
          { path: 'c/:id', element: <CardPage /> },
          { path: 'knowledge', element: <KnowledgePage /> },
          { path: 'toolbox', element: <ToolboxPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/:wid', element: <WorkspaceSettingsPage /> },
          { path: 'settings/:wid/accounts', element: <AccountsPage /> },
          { path: 'share', element: <SharePage /> },
          { path: 'new', element: <NewWorkspacePage /> },
          { path: 'w/:wid/p/:pid', element: <Legacy /> },
          { path: 'w/:wid/p/:pid/edit', element: <Legacy /> },
          { path: 'w/:wid/*', element: <Legacy /> },
          // The phone's old Videos list (one list at / since 0.3.3); the laptop's videos are on the board.
          { path: 'videos', element: <Navigate to="/" replace /> },
          { path: 'today', element: <Navigate to="/" replace /> },
          { path: 'review', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
