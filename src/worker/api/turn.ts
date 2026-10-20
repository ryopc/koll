import { Hono } from 'hono';
import type { Env } from '../types';

const turn = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

// 認証ミドルウェア
async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  const result = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, Date.now()).first();
  if (!result) {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }
  c.set('userId', result.user_id);
  await next();
}

// Cloudflare Realtime TURN API から ICE サーバー取得
async function fetchCloudflareTurnCredentials(env: Env, ttl = 86400): Promise<{ iceServers: RTCIceServer[] } | null> {
  const turnKeyId = env.TURN_KEY_ID;
  const turnApiToken = env.TURN_API_TOKEN;
  
  if (!turnKeyId || !turnApiToken) {
    return null;
  }
  
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${turnApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      }
    );
    
    if (!response.ok) {
      console.error('Cloudflare TURN API error:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    return { iceServers: data.iceServers };
  } catch (e) {
    console.error('Cloudflare TURN fetch error:', e);
    return null;
  }
}

// GET /api/turn/credentials - TURN 短期認証情報取得
turn.get('/credentials', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const ttl = 86400; // 24時間
  
  // Cloudflare Realtime TURN から取得試行
  const turnResult = await fetchCloudflareTurnCredentials(c.env, ttl);
  
  if (turnResult) {
    return c.json({
      success: true,
      iceServers: turnResult.iceServers,
      ttl,
      source: 'cloudflare-realtime',
    });
  }
  
  // フォールバック: STUN のみ
  return c.json({
    success: true,
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ],
    ttl,
    source: 'stun-only',
  });
});

// 開発用: TURN 設定確認エンドポイント
turn.get('/config-check', authMiddleware, async (c) => {
  const hasConfig = !!(c.env.TURN_KEY_ID && c.env.TURN_API_TOKEN);
  return c.json({
    success: true,
    configured: hasConfig,
    source: hasConfig ? 'cloudflare-realtime' : 'none',
  });
});

export default turn;