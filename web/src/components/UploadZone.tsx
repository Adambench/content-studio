import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Wraps content with drag-and-drop upload; also exposes a button. */
export function UploadZone({ onFiles, accept, children, className }: { onFiles: (files: File[]) => void; accept?: string; children: React.ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn('relative', className)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files].filter((f) => !accept || accept.split(',').some((a) => matches(f, a.trim())));
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-background/80 text-sm font-medium">
          Drop to upload
        </div>
      )}
    </div>
  );
}

function matches(file: File, accept: string) {
  if (accept.endsWith('/*')) return file.type.startsWith(accept.slice(0, -1));
  if (accept.startsWith('.')) return file.name.toLowerCase().endsWith(accept.toLowerCase());
  return file.type === accept;
}

export function UploadButton({
  onFiles,
  onPick,
  accept,
  label = 'Upload',
  capture,
  variant = 'default',
}: {
  onFiles: (files: File[]) => void;
  /** Used instead of the file input when set (the Android app's own picker, see useNativePick). */
  onPick?: (accept: string | undefined, camera: boolean) => void;
  accept?: string;
  label?: string;
  capture?: boolean;
  variant?: 'default' | 'outline' | 'secondary';
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        capture={capture ? 'environment' : undefined}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button size="sm" variant={variant} onClick={() => (onPick ? onPick(accept, !!capture) : ref.current?.click())}>
        <Upload /> {label}
      </Button>
    </>
  );
}
