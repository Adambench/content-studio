import { eq, inArray } from 'drizzle-orm';
import { PUBLISH_PLATFORM_LABELS, type AccountSettings, type PostCopy, type PostOptions } from '../../../shared/publish';
import { db, now, schema } from '../db';
import { notify } from '../lib/push';
import { JobError } from '../jobs/queue';
import { accessToken, accountLabel, getAccount, markReconnect } from './accounts';
import { PlatformError, platforms, type PublishContext } from './platforms';
import { afterPublished, setPost } from './posts';
import { publicMediaUrl } from './setup';

const pieceTitle = (pieceId: string) => db.select({ title: schema.pieces.title }).from(schema.pieces).where(eq(schema.pieces.id, pieceId)).get()?.title ?? 'A post';
const postLink = (p: { workspaceId: string; id: string }) => `/w/${p.workspaceId}/calendar?post=${p.id}`;

/** The `post.publish` job: send one post to its platform. Retries resume from `remote`, so nothing goes out twice. */
export async function publishPost({ postId }: { postId: string }) {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  // Deleted, or rescheduled while waiting for a retry.
  if (!post || post.status !== 'publishing') return;
  const account = post.accountId ? db.select().from(schema.accounts).where(eq(schema.accounts.id, post.accountId)).get() : undefined;
  if (!account) throw new JobError('Its account was disconnected.', { retry: false });
  if (account.status === 'reconnect') throw new JobError(`${accountLabel(account)} needs reconnecting (Accounts page), then try again.`, { retry: false });

  const rows = db.select().from(schema.media).where(inArray(schema.media.id, post.mediaIds)).all();
  const media = post.mediaIds.map((id) => rows.find((m) => m.id === id));
  if (media.some((m) => !m)) throw new JobError('A file in this post was deleted from the library.', { retry: false });

  setPost(post, { attempts: post.attempts + 1, stage: 'Starting', error: null });
  const remote = { ...post.remote };
  let lastStage = '';
  const ctx: PublishContext = {
    post: { ...post, copy: post.copy as PostCopy, options: post.options as PostOptions },
    account: { ...account, settings: account.settings as AccountSettings },
    media: media.map((m) => m!),
    token: () => accessToken(account),
    progress: (stage) => {
      if (stage === lastStage) return;
      lastStage = stage;
      setPost(post, { stage });
    },
    remote,
    save: (patch) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete remote[k];
        else remote[k] = v;
      }
      db.update(schema.posts).set({ remote: { ...remote } }).where(eq(schema.posts.id, post.id)).run();
    },
    publicUrl: publicMediaUrl,
  };
  const adapter = platforms[post.platform];

  try {
    let result;
    try {
      result = await adapter.publish(ctx);
    } catch (err) {
      // An access token can be revoked early: one fresh token, then the account needs a human. (If the refresh
      // itself was refused, the account is already marked for reconnecting.)
      if (!(err instanceof PlatformError && err.kind === 'auth') || getAccount(account.id).status !== 'connected') throw err;
      await accessToken(account, true);
      result = await adapter.publish(ctx);
    }
    setPost(post, { status: 'published', stage: result.stage, externalId: result.externalId, url: result.url, publishedAt: now(), error: null });
    const inbox = result.stage.startsWith('In your TikTok inbox');
    await notify(inbox ? 'Ready in your TikTok inbox' : `Posted to ${PUBLISH_PLATFORM_LABELS[post.platform]}`, `${pieceTitle(post.pieceId)} — ${result.stage}`, postLink(post));
    afterPublished(post.pieceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PlatformError) {
      if (err.kind === 'auth') {
        markReconnect(account, message);
        throw new JobError(`${accountLabel(account)} needs reconnecting (Accounts page), then try again.`, { retry: false });
      }
      if (err.kind === 'fatal') throw new JobError(message, { retry: false });
      setPost(post, { stage: `Will try again: ${message}` });
      if (err.kind === 'rate') throw new JobError(message, { delayMs: err.delayMs });
      if (err.delayMs) throw new JobError(message, { delayMs: err.delayMs });
    } else setPost(post, { stage: `Will try again: ${message}` });
    throw err;
  }
}

/** All attempts used up (or not worth retrying): show why and say so on every device. */
export function onPublishFailed({ postId }: { postId: string }, message: string) {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post || post.status !== 'publishing') return;
  setPost(post, { status: 'failed', error: message, stage: '' });
  void notify(`Couldn’t post to ${PUBLISH_PLATFORM_LABELS[post.platform]}`, `${pieceTitle(post.pieceId)}: ${message}`, postLink(post));
}

export function notifyMissed(post: { id: string; workspaceId: string; pieceId: string; platform: keyof typeof PUBLISH_PLATFORM_LABELS; scheduledAt: number }) {
  const when = new Date(post.scheduledAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  void notify(
    'Missed a scheduled post',
    `“${pieceTitle(post.pieceId)}” for ${PUBLISH_PLATFORM_LABELS[post.platform]} was due ${when}, while this computer was off or asleep. Post it now or pick a new time.`,
    postLink(post),
  );
}
