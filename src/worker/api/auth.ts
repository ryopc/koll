import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import type { Env, AuthResponse, User } from '../types';
import { generateRandomPhoneNumber } from '../phoneNumber';

const auth = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

// JWT 秘密鍵を取得（環境変数から、または開発用デフォルト）
function getJwtSecret(env: Env): Uint8Array {
  const secret = env.JWT_SECRET || 'dev-secret-change-in-production';
  return new TextEncoder().encode(secret);
}

// トークン生成（30日有効）
async function createToken(userId: number, env: Env): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getJwtSecret(env));
}

// トークン検証
async function verifyToken(token: string, env: Env): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    return { userId: payload.userId as number };
  } catch {
    return null;
  }
}

// 電話番号生成（091-XXXX-XXXX のランダム形式）
// 衝突確率は 1/100000000 未満だが、DB の UNIQUE 制約に引っかからないよう再試行する
async function generatePhoneNumber(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const phoneNumber = generateRandomPhoneNumber();
    const existing = await db.prepare('SELECT 1 FROM users WHERE phone_number = ?').bind(phoneNumber).first();
    if (!existing) return phoneNumber;
  }
  throw new Error('Failed to generate a unique phone number');
}

// 認証ミドルウェア
export async function authMiddleware(c: import('hono').Context<{ Bindings: Env; Variables: { userId: number } }>, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  const verified = await verifyToken(token, c.env);
  if (!verified) {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }
  c.set('userId', verified.userId);
  await next();
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ success: false, error: 'ユーザー名とパスワードは必須です' }, 400);
  }
  
  if (username.length < 3 || username.length > 20) {
    return c.json({ success: false, error: 'ユーザー名は3-20文字で入力してください' }, 400);
  }
  
  if (password.length < 6) {
    return c.json({ success: false, error: 'パスワードは6文字以上で入力してください' }, 400);
  }
  
  try {
    // 既存ユーザーチェック
    const existing = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
    if (existing) {
      return c.json({ success: false, error: 'このユーザー名は既に使用されています' }, 409);
    }
    
    // パスワードハッシュ化
    const passwordHash = await bcrypt.hash(password, 12);
    
    // 電話番号生成（ランダム）
    const phoneNumber = await generatePhoneNumber(c.env.DB);
    
    // ユーザー作成（prefix_index は旧スキーマ互換のため 0 のまま）
    const result = await c.env.DB.prepare(
      'INSERT INTO users (username, password_hash, phone_number, prefix_index) VALUES (?, ?, ?, 0)'
    ).bind(username, passwordHash, phoneNumber).run();
    
    const userId = result.meta.last_row_id;
    
    // トークン生成
    const token = await createToken(userId, c.env);
    
    // セッション保存
    await c.env.DB.prepare(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, userId, Date.now() + 30 * 24 * 60 * 60 * 1000).run();
    
    return c.json<AuthResponse>({
      success: true,
      token,
      user: { id: userId, username, phone_number: phoneNumber },
    });
  } catch (e) {
    console.error('Register error:', e);
    return c.json({ success: false, error: '登録に失敗しました' }, 500);
  }
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ success: false, error: 'ユーザー名とパスワードは必須です' }, 400);
  }
  
  try {
    const user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, phone_number FROM users WHERE username = ?'
    ).bind(username).first<User & { password_hash: string }>();
    
    if (!user) {
      return c.json({ success: false, error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return c.json({ success: false, error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }
    
    const token = await createToken(user.id, c.env);
    
    // セッション保存（古いセッションは削除）
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    await c.env.DB.prepare(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, user.id, Date.now() + 30 * 24 * 60 * 60 * 1000).run();
    
    return c.json<AuthResponse>({
      success: true,
      token,
      user: { id: user.id, username: user.username, phone_number: user.phone_number },
    });
  } catch (e) {
    console.error('Login error:', e);
    return c.json({ success: false, error: 'ログインに失敗しました' }, 500);
  }
});

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  try {
    const user = await c.env.DB.prepare(
      'SELECT id, username, phone_number FROM users WHERE id = ?'
    ).bind(userId).first<User>();
    
    if (!user) {
      return c.json({ success: false, error: 'ユーザーが見つかりません' }, 404);
    }
    
    return c.json<AuthResponse>({
      success: true,
      user,
    });
  } catch (e) {
    console.error('Me error:', e);
    return c.json({ success: false, error: '取得に失敗しました' }, 500);
  }
});

// POST /api/auth/logout
auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return c.json({ success: true });
});

export default auth;