import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeUsage } from '../../../shared/types';
import { emit } from '../lib/events';
import { getSetting, setSetting } from '../lib/settings';
import { JobError } from '../jobs/queue';

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

/** Background Claude jobs (picking moments, checking frames) leave the last ~20 % of the 5-hour window for me. */
const BUSY_AT = 0.8;

/**
 * Throw a waiting JobError while the 5-hour usage is above ~80 %, so the job tries again a minute after the window
 * resets; the chat stays usable meanwhile. A reading from a window that has already reset doesn't count.
 */
export function waitForUsage() {
  const five = getSetting('claudeUsage')?.fiveHour;
  if (!five || five.utilization < BUSY_AT || five.resetsAt <= Date.now()) return;
  const delayMs = five.resetsAt - Date.now() + 60_000;
  const at = new Date(Date.now() + delayMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  throw new JobError(`Waiting for Claude’s 5-hour usage to come down (${Math.round(five.utilization * 100)} %), until about ${at}.`, { wait: true, delayMs });
}
