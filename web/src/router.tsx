import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { WorkspaceLayout } from '@/components/WorkspaceLayout';
import { isApp } from '@/lib/native';
import { AccountsPage } from '@/pages/AccountsPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { AssetsPage } from '@/pages/AssetsPage';
import { BoardPage } from '@/pages/BoardPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { CampaignPage } from '@/pages/CampaignPage';
import { CampaignsPage } from '@/pages/CampaignsPage';
import { CapturePage } from '@/pages/CapturePage';
import { HomeRedirect } from '@/pages/HomeRedirect';
import { IdeasPage } from '@/pages/IdeasPage';
import { InboxPage } from '@/pages/InboxPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { ToolboxPage } from '@/pages/ToolboxPage';
import { LoginPage } from '@/pages/LoginPage';
import { NewWorkspacePage } from '@/pages/NewWorkspacePage';
import { PairPage } from '@/pages/PairPage';
import { PiecePage } from '@/pages/PiecePage';
import { ResearchPage } from '@/pages/ResearchPage';
import { ReviewRedirect } from '@/pages/ReviewRedirect';
import { SettingsPage } from '@/pages/SettingsPage';
import { SharePage } from '@/pages/SharePage';
import { StudioPage } from '@/pages/StudioPage';
import { TodayPage } from '@/pages/TodayPage';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettingsPage';

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
          { index: true, element: <HomeRedirect /> },
          { path: 'today', element: <TodayPage /> },
          { path: 'campaigns', element: <CampaignsPage /> },
          { path: 'campaigns/:id', element: <CampaignPage /> },
          { path: 'review', element: <ReviewRedirect /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'knowledge', element: <KnowledgePage /> },
          { path: 'toolbox', element: <ToolboxPage /> },
          { path: 'capture', element: <CapturePage /> },
          { path: 'share', element: <SharePage /> },
          { path: 'w/new', element: <NewWorkspacePage /> },
          {
            path: 'w/:wid',
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <Navigate to="board" replace /> },
              { path: 'board', element: <BoardPage /> },
              { path: 'ideas', element: <IdeasPage /> },
              { path: 'p/:pid', element: <PiecePage /> },
              { path: 'p/:pid/edit', element: <StudioPage /> },
              { path: 'inbox', element: <InboxPage /> },
              { path: 'library', element: <Navigate to="../inbox" replace /> },
              { path: 'assets', element: <AssetsPage /> },
              { path: 'calendar', element: <CalendarPage /> },
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'analytics', element: <AnalyticsPage /> },
              { path: 'research', element: <ResearchPage /> },
              { path: 'settings', element: <WorkspaceSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
