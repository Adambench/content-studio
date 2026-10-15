import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, resolveModel } from './options';
import { recordUsage } from './usage';

/** Ask Claude for JSON matching `schema`, with no tools. Used by background jobs. */
export async function askStructured<T>(input: { system: string; prompt: string; schema: Record<string, unknown>; model?: string }): Promise<T> {
  const q = query({
    prompt: input.prompt,
    options: {
      ...baseOptions(),
      model: resolveModel(input.model),
      systemPrompt: input.system,
      tools: [],
      outputFormat: { type: 'json_schema', schema: input.schema },
      persistSession: false,
      maxTurns: 4,
    },
  });
  for await (const message of q) {
    if (message.type === 'rate_limit_event') recordUsage(message.rate_limit_info);
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(`Claude couldn't finish: ${message.errors?.join('; ') || message.subtype}`);
      if (message.structured_output === undefined) throw new Error('Claude returned no structured output');
      return message.structured_output as T;
    }
  }
  throw new Error('Claude ended without a result');
}
