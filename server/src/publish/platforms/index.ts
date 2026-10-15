import type { PublishPlatform } from '../../../../shared/publish';
import type { PlatformAdapter } from './http';
import { instagram } from './instagram';
import { tiktok } from './tiktok';
import { youtube } from './youtube';

export const platforms: Record<PublishPlatform, PlatformAdapter> = { tiktok, instagram, youtube };
export { hasScope, PlatformError } from './http';
export type { AccountRow, PostRow, PostStatsResult, PublishContext, StatsBatch } from './http';
