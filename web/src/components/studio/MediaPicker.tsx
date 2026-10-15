import { useEffect, useState } from 'react';
import { MediaCard } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Media } from '@/lib/types';

/** Pick library files; `first` (e.g. the piece's own footage) is listed before the rest. */
export function MediaPicker({
  open,
  onOpenChange,
  title,
  description,
  first = [],
  rest,
  multiple,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  first?: Media[];
  rest: Media[];
  multiple?: boolean;
  onPick: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  const others = rest.filter((m) => !first.some((f) => f.id === m.id));

  const toggle = (id: string) => {
    if (!multiple) {
      onPick([id]);
      onOpenChange(false);
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const grid = (items: Media[]) => (
    <div className="grid grid-cols-3 gap-3 p-1 sm:grid-cols-4">
      {items.map((m) => (
        <MediaCard key={m.id} media={m} selected={selected.includes(m.id)} onClick={() => toggle(m.id)} />
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[55dvh] space-y-4 overflow-y-auto">
          {first.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">This piece</h3>
              {grid(first)}
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-2">
              {first.length > 0 && <h3 className="text-xs font-medium text-muted-foreground">Library</h3>}
              {grid(others)}
            </section>
          )}
          {!first.length && !others.length && <p className="py-8 text-center text-sm text-muted-foreground">Nothing suitable in the library yet.</p>}
        </div>
        {multiple && (
          <DialogFooter>
            <Button
              disabled={!selected.length}
              onClick={() => {
                onPick(selected);
                onOpenChange(false);
              }}
            >
              Add {selected.length || ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
