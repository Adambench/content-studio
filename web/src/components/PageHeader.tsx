import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, className, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 md:px-6', className)}>
      {/* Never squeezed to nothing: the actions wrap under the title instead. */}
      <div className="min-w-32 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </header>
  );
}
