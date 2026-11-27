// Off the tailnet (the phone over the public address) the app asks for a pairing code once: shown on the laptop
// under Server → Pair a phone, or by `cs pair`. A link with the code after # (the QR there) fills it in.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn } from '@/lib/native';

export function SignInPage() {
  const [code, setCode] = useState(() => window.location.hash.slice(1).toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(code);
      window.location.replace('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid h-dvh place-items-center bg-background px-4 text-foreground">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <h1 className="text-lg font-semibold">Content Studio</h1>
        <p className="text-sm text-muted-foreground">Code from the laptop: Server → Pair a phone.</p>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="font-mono tracking-widest" autoFocus />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || code.trim().length < 4}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
