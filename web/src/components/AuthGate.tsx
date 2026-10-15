import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { LockScreen } from '@/components/AppChrome';
import { Spinner } from '@/components/ui/spinner';
import { desktop } from '@/lib/desktop';
import { useLiveEvents } from '@/lib/live';
import { isApp, nativeRoute, pairing, unpair, unpairedReason } from '@/lib/native';
import { keys, queryClient, useAuth, type AuthStatus } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';

export function AuthGate() {
  return isApp ? <AppGate /> : <SessionGate />;
}

/** The website and the desktop app: a cookie session. */
function SessionGate() {
  const auth = useAuth();
  const location = useLocation();
  const authed = !!auth.data?.authenticated;
  useLiveEvents(authed);

  const navigate = useNavigate();
  useEffect(() => desktop?.onNavigate((path) => navigate(path)), [navigate]);

  useEffect(() => {
    // Any 401 from the API (e.g. session expired) signs the desktop app back in, or sends a browser to the login screen.
    const onUnauthorized = async () => {
      if (desktop) {
        await desktop.signIn().catch(() => {});
        return queryClient.invalidateQueries();
      }
      queryClient.setQueryData(keys.auth, (d: AuthStatus | undefined) => d && { ...d, authenticated: false });
    };
    window.addEventListener('app:unauthorized', onUnauthorized);
    return () => window.removeEventListener('app:unauthorized', onUnauthorized);
  }, []);

  if (auth.isPending)
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  if (!authed) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

/**
 * The Android app: paired means signed in, even while the computer can't be reached (the UI is in the APK and capture
 * works offline). A 401 means the computer unpaired this phone.
 */
function AppGate() {
  const paired = useStore(pairing);
  const route = useStore(nativeRoute);
  const navigate = useNavigate();
  useLiveEvents(!!paired);

  useEffect(() => {
    const onUnauthorized = () => {
      unpairedReason.set('This phone was unpaired from Content Studio on your computer. Pair it again to carry on.');
      void unpair({ revoked: true });
    };
    window.addEventListener('app:unauthorized', onUnauthorized);
    return () => window.removeEventListener('app:unauthorized', onUnauthorized);
  }, []);

  // Notifications, launcher shortcuts and the share sheet ask for a screen.
  useEffect(() => {
    if (route && paired) {
      nativeRoute.set(null);
      navigate(route.path);
    }
  }, [route, paired, navigate]);

  if (paired === undefined) return null;
  if (!paired) return <Navigate to="/pair" replace />;
  return (
    <>
      <Outlet />
      <LockScreen />
    </>
  );
}
