import type { PublishPlatform } from '../../../../shared/publish';
import type { PlatformAdapter } from './http';
import { instagram } from './instagram';

export const platforms: Record<PublishPlatform, PlatformAdapter> = { instagram };
export { hasScope, PlatformError } from './http';
export type { AccountRow, PostRow, PostStatsResult, PublishContext, StatsBatch } from './http';
