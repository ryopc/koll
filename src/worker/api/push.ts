import { Hono } from 'hono';
import webpush from 'web-push';
import type { Env } from '../types';

const push = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

// VAPID 設定
function getVapidKeys(env: Env) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  
  if (!publicKey || !privateKey) {
    // 開発用デフォルト（本番では必ず環境変数で設定）
    return {
      publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      privateKey: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls',
    };
  }
  return { publicKey, privateKey };
}

function initWebPush(env: Env) {
  const { publicKey, privateKey } = getVapidKeys(env);
  webpush.setVapidDetails(
    'mailto:admin@koll.app',
    publicKey,
    privateKey
  );
}

// 認証ミドルウェア（auth.ts からインポートする想定）
async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  // 簡易検証（本番では JWT verify）
  const result = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, Date.now()).first();
  if (!result) {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }
  c.set('userId', result.user_id);
  await next();
}

// GET /api/push/vapid-public-key
push.get('/vapid-public-key', async (c) => {
  const { publicKey } = getVapidKeys(c.env);
  return c.json({ success: true, publicKey });
});

// POST /api/push/subscribe
push.post('/subscribe', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { endpoint, keys } = await c.req.json();
  
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json({ success: false, error: 'Invalid subscription data' }, 400);
  }
  
  try {
    // 既存の同一エンドポイントを削除（更新扱い）
    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
    ).bind(userId, endpoint).run();
    
    // 新規登録
    await c.env.DB.prepare(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)'
    ).bind(userId, endpoint, keys.p256dh, keys.auth).run();
    
    return c.json({ success: true });
  } catch (e) {
    console.error('Push subscribe error:', e);
    return c.json({ success: false, error: 'Failed to subscribe' }, 500);
  }
});

// DELETE /api/push/subscribe
push.delete('/subscribe', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { endpoint } = await c.req.json();
  
  if (!endpoint) {
    return c.json({ success: false, error: 'Endpoint required' }, 400);
  }
  
  try {
    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
    ).bind(userId, endpoint).run();
    
    return c.json({ success: true });
  } catch (e) {
    console.error('Push unsubscribe error:', e);
    return c.json({ success: false, error: 'Failed to unsubscribe' }, 500);
  }
});

// ユーザーの Push 購読情報取得（内部用）
export async function getUserPushSubscriptions(db: D1Database, userId: number): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
  const results = await db.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  ).bind(userId).all();
  
  return (results.results || []).map(r => ({
    endpoint: r.endpoint as string,
    p256dh: r.p256dh as string,
    auth: r.auth as string,
  }));
}

// Push 通知送信（着信時など）
export async function sendPushNotification(
  env: Env,
  userId: number,
  payload: { title: string; body: string; icon?: string; data?: Record<string, unknown>; actions?: Array<{ action: string; title: string }> }
): Promise<boolean> {
  const subscriptions = await getUserPushSubscriptions(env.DB, userId);
  
  if (subscriptions.length === 0) {
    return false;
  }
  
  initWebPush(env);
  
  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: 'incoming-call',
    renotify: true,
    requireInteraction: true,
    data: payload.data || {},
    actions: payload.actions || [
      { action: 'answer', title: '応答' },
      { action: 'decline', title: '拒否' },
    ],
  });
  
  let sent = false;
  
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        pushPayload
      );
      sent = true;
    } catch (e: any) {
      console.error('Push send error:', e);
      // 410 Gone = 購読無効 -> DB から削除
      if (e.statusCode === 410) {
        await env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
        ).bind(userId, sub.endpoint).run();
      }
    }
  }
  
  return sent;
}

export default push;