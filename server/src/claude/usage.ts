import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeUsage } from '../../../shared/types';
import { emit } from '../lib/events';
import { setSetting } from '../lib/settings';

type Window = { utilization: number; resetsAt: number };

/** Store the latest subscription usage the SDK reported so the UI can show it. */
export function recordUsage(info: SDKRateLimitInfo): ClaudeUsage {
  // `unifiedWindows` isn't in the published types yet; read it defensively.
  const windows = (info as SDKRateLimitInfo & { unifiedWindows?: Record<string, Window> }).unifiedWindows ?? {};
  const fiveHour = windows.five_hour ?? (info.rateLimitType === 'five_hour' && info.utilization !== undefined && info.resetsAt ? { utilization: info.utilization, resetsAt: info.resetsAt } : undefined);
  const sevenDay = windows.seven_day ?? (info.rateLimitType === 'seven_day' && info.utilization !== undefined && info.resetsAt ? { utilization: info.utilization, resetsAt: info.resetsAt } : undefined);
  const usage: ClaudeUsage = {
    status: info.status,
    fiveHour: fiveHour && { utilization: fiveHour.utilization, resetsAt: fiveHour.resetsAt * 1000 },
    sevenDay: sevenDay && { utilization: sevenDay.utilization, resetsAt: sevenDay.resetsAt * 1000 },
    updatedAt: Date.now(),
  };
  setSetting('claudeUsage', usage);
  emit({ type: 'changed', entity: 'settings' });
  return usage;
}
