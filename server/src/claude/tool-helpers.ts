export type ToolResult = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };
export const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export class ToolError extends Error {}

/** Wrap a handler so expected problems come back to Claude as tool errors instead of crashing the turn. */
export function safe<A>(fn: (args: A) => Promise<ToolResult> | ToolResult) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}
