import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiTask } from '../../../shared/ai';
import { localStructured } from '../ai/local';
import { canFallBack, routeFor } from '../ai/route';
import { baseOptions, resolveModel } from './options';
import { recordUsage } from './usage';

export type PromptImage = { data: string; mediaType: 'image/jpeg' | 'image/png' };

/** The prompt as one user message with the images first, for a look at frames. */
async function* withImages(text: string, images: PromptImage[]): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } })), { type: 'text' as const, text }],
    },
  };
}

type StructuredInput = { system: string; prompt: string; schema: Record<string, unknown>; model?: string; images?: PromptImage[] };

/**
 * JSON matching `schema`, with no tools, from whoever answers `task` now (Claude or the self-hosted model,
 * `ai/route.ts`). Used by background jobs. `images` go before the prompt. `model` is the Claude model.
 */
export async function askStructured<T>(input: StructuredInput & { task: AiTask }): Promise<T> {
  if ((await routeFor(input.task)).provider === 'local') return localStructured<T>(input);
  try {
    return await askClaude<T>(input);
  } catch (err) {
    if (await canFallBack(input.task, err)) return localStructured<T>(input);
    throw err;
  }
}

async function askClaude<T>(input: StructuredInput): Promise<T> {
  const q = query({
    prompt: input.images?.length ? withImages(input.prompt, input.images) : input.prompt,
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
