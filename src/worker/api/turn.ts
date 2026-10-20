import { Hono } from 'hono';
import type { Env, RTCIceServer } from '../types';

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

// 環境変数から TURN 設定取得
function getTurnConfig(env: Env): { 
  urls: string[]; 
  username: string; 
  credential: string;
  source: 'coturn' | 'cloudflare-realtime' | 'stun-only';
} | null {
  // 1. 自前 coturn (Static Auth - ユーザー名/パスワード固定)
  const coturnHost = env.COTURN_HOST;           // turn.ryopc.org
  const coturnUsername = env.COTURN_USERNAME;   // 静的ユーザー名
  const coturnPassword = env.COTURN_PASSWORD;   // 静的パスワード
  const coturnPort = env.COTURN_PORT || '3478';
  const coturnTlsPort = env.COTURN_TLS_PORT || '8443';
  
  if (coturnHost && coturnUsername && coturnPassword) {
    const urls = [
      `turns:${coturnHost}:${coturnTlsPort}?transport=tcp`,  // 1. TLS (暗号化・最優先)
      `turn:${coturnHost}:${coturnPort}?transport=tcp`,      // 2. TCP フォールバック
      `turn:${coturnHost}:${coturnPort}?transport=udp`,      // 3. UDP フォールバック
    ];
    return {
      urls,
      username: coturnUsername,
      credential: coturnPassword,
      source: 'coturn',
    };
  }
  
  // 2. Cloudflare Realtime TURN (動的認証情報)
  const turnKeyId = env.TURN_KEY_ID;
  const turnApiToken = env.TURN_API_TOKEN;
  if (turnKeyId && turnApiToken) {
    return { urls: [], username: '', credential: '', source: 'cloudflare-realtime' };
  }
  
  return null;
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
    
    const data = await response.json() as { iceServers: RTCIceServer[] };
    return { iceServers: data.iceServers };
  } catch (e) {
    console.error('Cloudflare TURN fetch error:', e);
    return null;
  }
}

// GET /api/turn/credentials - TURN 短期認証情報取得
turn.get('/credentials', authMiddleware, async (c) => {
  const config = getTurnConfig(c.env);
  
  if (!config) {
    // フォールバック: STUN のみ
    return c.json({
      success: true,
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
      ],
      source: 'stun-only',
    });
  }
  
  // 自前 coturn (Static Auth)
  if (config.source === 'coturn') {
    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ];
    
    for (const url of config.urls) {
      iceServers.push({
        urls: url,
        username: config.username,
        credential: config.credential,
      });
    }
    
    return c.json({
      success: true,
      iceServers,
      source: 'coturn',
    });
  }
  
  // Cloudflare Realtime TURN (動的認証情報)
  if (config.source === 'cloudflare-realtime') {
    const turnResult = await fetchCloudflareTurnCredentials(c.env);
    
    if (turnResult) {
      return c.json({
        success: true,
        iceServers: turnResult.iceServers,
        source: 'cloudflare-realtime',
      });
    }
    
    // フォールバック
    return c.json({
      success: true,
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
      ],
      source: 'stun-only',
    });
  }
  
  return c.json({
    success: true,
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ],
    source: 'stun-only',
  });
});

// 開発用: TURN 設定確認エンドポイント
turn.get('/config-check', authMiddleware, async (c) => {
  const config = getTurnConfig(c.env);
  return c.json({
    success: true,
    configured: !!config,
    source: config?.source || 'none',
    urls: config?.urls || [],
  });
});

export default turn;