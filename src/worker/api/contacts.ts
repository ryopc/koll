import { Hono } from 'hono';
import type { Env } from '../types';

const contacts = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

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

// GET /api/contacts - 一覧取得（検索対応）
contacts.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q'); // 検索クエリ
  
  let sql = 'SELECT id, contact_phone, display_name, created_at, updated_at FROM contacts WHERE owner_id = ?';
  const params: (string | number)[] = [userId];
  
  if (query) {
    sql += ' AND (contact_phone LIKE ? OR display_name LIKE ?)';
    const likeQuery = `%${query}%`;
    params.push(likeQuery, likeQuery);
  }
  
  sql += ' ORDER BY display_name IS NULL, display_name, contact_phone';
  
  const results = await c.env.DB.prepare(sql).bind(...params).all();
  
  return c.json({
    success: true,
    contacts: results.results || [],
  });
});

// GET /api/contacts/lookup/:phone - 番号で名前検索（着信時用）
contacts.get('/lookup/:phone', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const phone = c.req.param('phone');
  
  const contact = await c.env.DB.prepare(
    'SELECT display_name FROM contacts WHERE owner_id = ? AND contact_phone = ?'
  ).bind(userId, phone).first();
  
  return c.json({
    success: true,
    displayName: contact?.display_name || null,
  });
});

// POST /api/contacts - 追加
contacts.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { contact_phone, display_name } = await c.req.json();
  
  if (!contact_phone) {
    return c.json({ success: false, error: '電話番号は必須です' }, 400);
  }
  
  // 形式検証
  if (!/^ph[a-z]-\d{4}-\d{4}$/.test(contact_phone)) {
    return c.json({ success: false, error: '電話番号の形式が正しくありません (phx-xxxx-xxxx)' }, 400);
  }
  
  // 自分自身を登録防止
  const me = await c.env.DB.prepare('SELECT phone_number FROM users WHERE id = ?').bind(userId).first();
  if (me && me.phone_number === contact_phone) {
    return c.json({ success: false, error: '自分の番号は登録できません' }, 400);
  }
  
  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO contacts (owner_id, contact_phone, display_name) VALUES (?, ?, ?)'
    ).bind(userId, contact_phone, display_name || null).run();
    
    return c.json({
      success: true,
      contact: {
        id: result.meta.last_row_id,
        contact_phone,
        display_name: display_name || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: 'この番号は既に登録されています' }, 409);
    }
    console.error('Contact create error:', e);
    return c.json({ success: false, error: '登録に失敗しました' }, 500);
  }
});

// PUT /api/contacts/:id - 更新
contacts.put('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { display_name } = await c.req.json();
  
  try {
    const result = await c.env.DB.prepare(
      'UPDATE contacts SET display_name = ?, updated_at = ? WHERE id = ? AND owner_id = ?'
    ).bind(display_name || null, Date.now(), id, userId).run();
    
    if (result.meta.changes === 0) {
      return c.json({ success: false, error: '連絡先が見つかりません' }, 404);
    }
    
    return c.json({ success: true });
  } catch (e) {
    console.error('Contact update error:', e);
    return c.json({ success: false, error: '更新に失敗しました' }, 500);
  }
});

// DELETE /api/contacts/:id - 削除
contacts.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM contacts WHERE id = ? AND owner_id = ?'
    ).bind(id, userId).run();
    
    if (result.meta.changes === 0) {
      return c.json({ success: false, error: '連絡先が見つかりません' }, 404);
    }
    
    return c.json({ success: true });
  } catch (e) {
    console.error('Contact delete error:', e);
    return c.json({ success: false, error: '削除に失敗しました' }, 500);
  }
});

export default contacts;