import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config';
import { getSetting } from '../lib/settings';

/**
 * Options every Claude call shares. Runs on the Claude subscription login (no API key):
 * an inherited ANTHROPIC_API_KEY would silently take precedence and bill that key instead, so drop it.
 */
export function baseOptions(): Options {
  const { ANTHROPIC_API_KEY: _drop, ...env } = process.env;
  return {
    cwd: config.claudeDir,
    // The Claude login also brings my claude.ai connectors (Drive, Docs…) as tools: the app's Claude gets none of them.
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: 'content-studio/0.1.0', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    // Don't load my personal Claude Code settings, hooks or CLAUDE.md files into the app's agent.
    settingSources: [],
  };
}

export function resolveModel(model?: string | null) {
  return model || getSetting('defaultModel') || 'opus';
}
