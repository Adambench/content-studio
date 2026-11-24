// A shell on ai-server in ~/studio, in the page: for anything the app doesn't do (run `claude` here for Claude Code).

import { TerminalView } from '@/components/TerminalView';

export function TerminalPage() {
  return (
    <div className="flex h-full flex-col gap-2 p-3 md:p-4">
      <div className="text-xs text-muted-foreground">ai-server · ~/studio</div>
      <TerminalView path="/api/terminal" className="min-h-0 flex-1" />
    </div>
  );
}
