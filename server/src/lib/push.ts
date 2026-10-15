import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { config } from '../config';
import { db, schema } from '../db';
import { emit } from './events';
import { fcmReady, sendFcm } from './fcm';
import { getSetting, setSetting } from './settings';

export function vapidKeys() {
  let keys = getSetting('vapid');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting('vapid', keys);
  }
  return keys;
}

export function initPush() {
  const keys = vapidKeys();
  webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
}

const forget = (id: string) => db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id)).run();

/** Send a notification to every subscribed device (phones' browsers by Web Push, the Android app by FCM). Failures never throw. */
export async function notify(title: string, body: string, url = '/') {
  emit({ type: 'notify', title, body, url });
  const subs = db.select().from(schema.pushSubscriptions).all();
  await Promise.all(
    subs.map(async (sub) => {
      if (sub.kind === 'fcm') {
        if (!fcmReady()) return;
        try {
          if ((await sendFcm(sub.endpoint, { title, body, url })) === 'gone') forget(sub.id);
        } catch (err) {
          console.warn('[push] FCM send failed:', (err as Error).message);
        }
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url }),
          { TTL: 60 * 60 * 24 },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The browser dropped this subscription; forget it.
        if (status === 404 || status === 410) forget(sub.id);
        else console.warn(`[push] send failed (${status ?? 'network'}):`, (err as Error).message);
      }
    }),
  );
}
