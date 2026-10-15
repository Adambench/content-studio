import { WORKSPACE_COLORS, type WorkspaceColor } from '@shared/types';
import { COLOR_DOT } from '@/lib/colors';
import { cn } from '@/lib/utils';

export function ColorPicker({ value, onChange }: { value: WorkspaceColor; onChange: (c: WorkspaceColor) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {WORKSPACE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('size-7 rounded-full ring-offset-2 ring-offset-background transition', COLOR_DOT[c], value === c ? 'ring-2 ring-foreground' : 'opacity-70 hover:opacity-100')}
        />
      ))}
    </div>
  );
}
