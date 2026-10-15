import { ScanQrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { parsePairingLink } from '@shared/devices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { isNative, pair, pairing, pendingPairLink, Studio, unpairedReason } from '@/lib/native';
import { useStore } from '@/lib/ui-state';

/** The Android app's first screen: pair with Content Studio on the computer (Settings → Phone access there). */
export function PairPage() {
  const paired = useStore(pairing);
  const link = useStore(pendingPairLink);
  const reason = useStore(unpairedReason);
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'scan' | 'pair' | null>(null);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  async function submit(value: string) {
    if (busyRef.current) return;
    const parsed = parsePairingLink(value);
    if (!parsed) return setError('That isn’t a pairing link. Copy the whole link under the QR code on your computer.');
    busyRef.current = true;
    setBusy('pair');
    setError('');
    try {
      await pair(parsed.server, parsed.code);
      unpairedReason.set(null);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  // A pairing link opened from outside the app (the camera app recognised the QR code). It only fills the field: any
  // web page could link here, so pairing with the address it names takes a tap.
  useEffect(() => {
    if (!link) return;
    pendingPairLink.set(null);
    setText(link);
  }, [link]);

  async function scan() {
    setError('');
    setBusy('scan');
    try {
      const { value } = await Studio.scanQrCode();
      setBusy(null);
      if (value) {
        setText(value);
        await submit(value);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (paired) return <Navigate to="/" replace />;
  const target = parsePairingLink(text);
  return (
    <main className="pt-safe pb-safe grid min-h-full place-items-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <img src="/icon.svg" alt="" className="mx-auto size-14" />
          <h1 className="text-xl font-semibold tracking-tight">Pair with your computer</h1>
          <p className="text-sm text-muted-foreground">
            On your computer, open Content Studio → <span className="text-foreground">Settings → Phone access</span> and choose <span className="text-foreground">Pair a phone</span>.
          </p>
        </div>
        {reason && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{reason}</p>}
        {isNative && (
          <Button size="lg" className="w-full" onClick={scan} disabled={!!busy}>
            {busy === 'scan' ? <Spinner /> : <ScanQrCode />} Scan the QR code
          </Button>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(text);
          }}
        >
          <Label htmlFor="pair-link" className="text-muted-foreground">
            {isNative ? 'Or paste the link shown under it' : 'Paste the link shown under the QR code'}
          </Label>
          <div className="flex gap-2">
            <Input id="pair-link" value={text} onChange={(e) => setText(e.target.value)} placeholder="contentstudio://pair?…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <Button type="submit" variant={target ? 'default' : 'secondary'} disabled={!text.trim() || !!busy}>
              {busy === 'pair' && <Spinner />} Pair
            </Button>
          </div>
          {target && (
            <p className="text-xs text-muted-foreground">
              With Content Studio at <span className="font-mono text-foreground">{target.server.replace(/^https?:\/\//, '')}</span>
            </p>
          )}
        </form>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
