import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAuth } from '@/lib/queries';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (auth.isPending) return null;
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  if (auth.data?.authenticated) return <Navigate to={next} replace />;
  const setup = auth.data?.setupRequired;
  if (setup && auth.data?.desktopManaged)
    return (
      <main className="grid min-h-full place-items-center px-6 py-12">
        <div className="w-full max-w-sm space-y-3 text-center">
          <img src="/icon.svg" alt="" className="mx-auto size-12" />
          <h1 className="text-xl font-semibold tracking-tight">Set a password first</h1>
          <p className="text-sm text-muted-foreground">
            Open Content Studio on your computer and choose a phone password in <span className="text-foreground">Settings → Phone access</span>. Then reload this page.
          </p>
        </div>
      </main>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (setup && password !== confirm) return setError('Passwords don’t match.');
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { body: { password } });
      queryClient.setQueryData(keys.auth, { setupRequired: false, authenticated: true });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-full place-items-center px-6 py-12">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <img src="/icon.svg" alt="" className="mx-auto size-12" />
          <h1 className="text-xl font-semibold tracking-tight">{setup ? 'Welcome to Content Studio' : 'Sign in to Content Studio'}</h1>
          <p className="text-sm text-muted-foreground">
            {setup ? 'Choose a password. Anyone who reaches this app over the internet will need it.' : 'Your content studio.'}
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {setup && (
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
            {busy && <Spinner />}
            {setup ? 'Create password' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  );
}
