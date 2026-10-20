import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CallRoom } from './durable-objects/CallRoom';
import auth from './api/auth';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// CORS 設定
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// 認証 API ルート
app.route('/api/auth', auth);

// ヘルスチェック
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// WebSocket エンドポイント: /ws?phone=xxx&token=xxx
app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 400);
  }

  const phone = c.req.query('phone');
  const token = c.req.query('token');

  if (!phone) {
    return c.text('Missing phone parameter', 400);
  }

  // Durable Object インスタンス取得（ルームID = 電話番号）
  const id = c.env.CALL_ROOM.idFromName(phone);
  const room = c.env.CALL_ROOM.get(id);

  // リクエストを DO にフォワード
  return room.fetch(c.req.raw);
});

// 静的アセット配信（Assets バインディング）
app.all('*', async (c, next) => {
  // API パスはスキップ
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/ws') || c.req.path === '/health') {
    return next();
  }
  
  // Assets から配信
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
export { CallRoom };