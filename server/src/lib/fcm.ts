import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import { platformUrl } from '../publish/platforms/http';
import { badRequest } from './http';
import { getSetting } from './settings';

/*
 * Notifications to the Android app go through Firebase Cloud Messaging (HTTP v1 API). Both halves of the Firebase
 * setup are pasted into the desktop's Settings → Notifications: the service-account key (the server signs in to
 * FCM with it) and google-services.json (the app's Firebase options, which the app fetches after pairing, so the
 * APK itself carries no Firebase config).
 */

export const ANDROID_APP_ID = 'io.github.adambench.contentstudio';

/** What the app needs to start Firebase (the parts of google-services.json for this app). */
export type FirebaseAppOptions = { applicationId: string; apiKey: string; projectId: string; gcmSenderId: string; storageBucket?: string };
export type FcmServiceAccount = { projectId: string; clientEmail: string; privateKey: string };
export type FcmSetting = { serviceAccount?: FcmServiceAccount; app?: FirebaseAppOptions };

const json = (text: string, what: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest(`That isn’t the ${what} — paste the whole file.`);
  }
};

export function parseServiceAccount(text: string): FcmServiceAccount {
  const parsed = z
    .object({ type: z.literal('service_account'), project_id: z.string().min(1), client_email: z.string().min(1), private_key: z.string().includes('PRIVATE KEY') })
    .safeParse(json(text, 'service-account key'));
  if (!parsed.success) throw badRequest('That isn’t a service-account key. In Firebase: Project settings → Service accounts → Generate new private key.');
  try {
    createPrivateKey(parsed.data.private_key);
  } catch {
    throw badRequest('The private key in that file can’t be read.');
  }
  return { projectId: parsed.data.project_id, clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key };
}

export function parseGoogleServices(text: string): FirebaseAppOptions {
  const parsed = z
    .object({
      project_info: z.object({ project_number: z.string(), project_id: z.string(), storage_bucket: z.string().optional() }),
      client: z.array(
        z.object({
          client_info: z.object({ mobilesdk_app_id: z.string(), android_client_info: z.object({ package_name: z.string() }).optional() }),
          api_key: z.array(z.object({ current_key: z.string() })).optional(),
        }),
      ),
    })
    .safeParse(json(text, 'google-services.json file'));
  if (!parsed.success) throw badRequest('That isn’t a google-services.json file. In Firebase: Project settings → Your apps → the Android app → google-services.json.');
  const client = parsed.data.client.find((c) => c.client_info.android_client_info?.package_name === ANDROID_APP_ID);
  if (!client) throw badRequest(`That file has no Android app with the package name ${ANDROID_APP_ID}. Add one in Firebase with exactly that name.`);
  const apiKey = client.api_key?.[0]?.current_key;
  if (!apiKey) throw badRequest('That file has no API key for the app.');
  const info = parsed.data.project_info;
  return { applicationId: client.client_info.mobilesdk_app_id, apiKey, projectId: info.project_id, gcmSenderId: info.project_number, storageBucket: info.storage_bucket };
}

export const fcmSetting = (): FcmSetting => getSetting('fcm') ?? {};
export const fcmReady = () => !!fcmSetting().serviceAccount;

let cached: { email: string; token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

/** An OAuth access token for FCM, from a JWT signed with the service account's key (cached for its hour). */
async function accessToken(account: FcmServiceAccount) {
  if (cached && cached.email === account.clientEmail && cached.expiresAt > Date.now() + 60_000) return cached.token;
  // Notifications to several phones go out together; they share one sign-in.
  pending ??= signIn(account).finally(() => (pending = null));
  return pending;
}

async function signIn(account: FcmServiceAccount) {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const jwt = `${unsigned}.${sign('sha256', Buffer.from(unsigned), account.privateKey).toString('base64url')}`;
  const res = await fetch(platformUrl('https://oauth2.googleapis.com/token'), {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Firebase sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
  cached = { email: account.clientEmail, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/**
 * Send one notification. Returns `gone` when FCM says the token is dead (app uninstalled, data cleared, or a token
 * from another Firebase project), so the subscription can be forgotten.
 */
export async function sendFcm(token: string, n: { title: string; body: string; url: string }): Promise<'sent' | 'gone'> {
  const account = fcmSetting().serviceAccount;
  if (!account) throw new Error('Firebase isn’t set up');
  const res = await fetch(platformUrl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(account)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: n.title, body: n.body },
        data: { url: n.url },
        // The app makes the "alerts" channel and ships the small monochrome icon.
        android: { priority: 'high', ttl: '86400s', notification: { channel_id: 'alerts', icon: 'ic_stat_notify', color: '#8b5cf6' } },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return 'sent';
  const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
  const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
  if (res.status === 401) cached = null;
  if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH' || (code === 'INVALID_ARGUMENT' && /registration token/i.test(body.error?.message ?? ''))) return 'gone';
  throw new Error(`FCM ${res.status} ${code ?? ''}: ${body.error?.message ?? ''}`.trim());
}
