// Knowledge: the playbook as rules the creator can read, edit and add to. Seeded from the playbook skill's
// references (one rule per `##` section); every background prompt and the chat read the live rules, so an edit here
// changes what Claude does. Lessons from references (shared/references.ts) land here as suggestions, and later ones
// from my results. Lessons from my comments on finished videos (source `comments`) are active at once: each is a
// mistake a video made, written as the general rule, and every prompt that picks, makes or judges a video lists them
// and the check before a render tests each one (server/src/knowledge/lessons.ts).

export const KNOWLEDGE_TOPICS = ['content-model', 'hooks', 'retention', 'editing', 'packaging', 'sound-design', 'motion', 'platforms', 'halal', 'clipping'] as const;
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

export const KNOWLEDGE_TOPIC_INFO: Record<KnowledgeTopic, { label: string; hint: string }> = {
  'content-model': { label: 'Content model', hint: 'Hook → content → payoff: the shape every video has' },
  hooks: { label: 'Hooks', hint: 'The first 1–3 seconds: picture, words and on-screen text' },
  retention: { label: 'Retention', hint: 'Pacing, value per second, endings, length' },
  editing: { label: 'Editing', hint: 'Cuts, framing and the camera, what is on screen when' },
  packaging: { label: 'Packaging', hint: 'First frame, on-screen text, titles, captions, hashtags' },
  'sound-design': { label: 'Sound design', hint: 'Which effect, where, how loud (never music)' },
  motion: { label: 'Motion', hint: 'Animation, graphics and kinetic type' },
  platforms: { label: 'Platforms', hint: 'What TikTok, Reels and Shorts reward now' },
  halal: { label: 'Halal', hint: 'No music, nothing haram: before everything else' },
  clipping: { label: 'Clipping', hint: 'Picking moments from long videos, campaign rules' },
};

/** Where a rule came from: the playbook, me, Claude's suggestion, my results, a reference I measured, my comments. */
export type KnowledgeSource = 'playbook' | 'you' | 'claude' | 'results' | 'reference' | 'comments';
export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSource, string> = {
  playbook: 'Playbook',
  you: 'Mine',
  claude: 'Claude',
  results: 'From results',
  reference: 'From a reference',
  comments: 'From my comments',
};

/** `proposed`: suggested (by Claude, or from results), waiting for my OK. `off`: kept but left out of prompts. */
export type KnowledgeStatus = 'active' | 'proposed' | 'off';

export type KnowledgeRule = {
  id: string;
  /** null = every page. */
  workspaceId: string | null;
  topic: KnowledgeTopic;
  title: string;
  body: string;
  source: KnowledgeSource;
  status: KnowledgeStatus;
  /** A seeded rule I've changed (an update of the playbook leaves it alone). */
  edited: boolean;
  /** Seeded halal rules: shown, never changed or turned off. */
  locked: boolean;
  /** Why Claude suggested it, for a suggested rule. */
  note: string;
  /** The reference video it was drafted from. */
  referenceId: string | null;
  /** A lesson from my comments: how many comments taught it, and the newest one's words and video. */
  taught?: { count: number; last: { text: string; pieceId: string; workspaceId: string; title: string } | null };
  position: number;
  createdAt: number;
  updatedAt: number;
};

export const RULE_TITLE_MAX = 120;
export const RULE_BODY_MAX = 6000;
