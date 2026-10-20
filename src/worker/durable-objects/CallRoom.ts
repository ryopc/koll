import { DurableObject } from 'cloudflare:workers';
import type { Env, SignalMessage, RoomState, CallState } from '../types';

const PREFIXES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ROOM_TTL_MS = 30 * 60 * 1000; // 30分

export class CallRoom extends DurableObject<Env> {
  private state: RoomState;
  private alarmSet = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = {
      participants: new Map(),
      callState: 'waiting',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    // ストレージから復元
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RoomState>('roomState');
      if (stored) {
        this.state = {
          ...stored,
          participants: new Map(), // WebSocket は復元できないので空で開始
        };
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    const url = new URL(request.url);
    const phone = url.searchParams.get('phone');
    const token = url.searchParams.get('token');

    if (!phone) {
      return new Response('Missing phone parameter', { status: 400 });
    }

    // トークン検証（簡易版：本番では JWT 検証）
    const user = await this.validateToken(token, phone);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.handleWebSocket(server, phone);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async validateToken(token: string | null, phone: string): Promise<boolean> {
    if (!token) return false;
    try {
      // 簡易検証: sessions テーブルから確認
      const result = await this.env.DB.prepare(
        'SELECT 1 FROM sessions WHERE token = ? AND user_id = (SELECT id FROM users WHERE phone_number = ?) AND expires_at > ?'
      ).bind(token, phone, Date.now()).first();
      return !!result;
    } catch {
      return false;
    }
  }

  private handleWebSocket(ws: WebSocket, phone: string): void {
    ws.accept();

    // 既存の同一電話番号の接続があれば切断（最新タブ優先）
    const existing = this.state.participants.get(phone);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.send(JSON.stringify({ type: 'error', message: '新しいタブで開かれました' }));
      existing.close(1000, 'Superseded by new tab');
    }

    this.state.participants.set(phone, ws);
    this.state.lastActivity = Date.now();
    this.setAlarm();

    // 参加通知を他の参加者に送信
    this.broadcastExcept(phone, { type: 'peer-joined', userId: phone });

    // 着信側が既にいる場合、発信側に着信通知
    if (this.state.participants.size === 2) {
      const [caller, callee] = Array.from(this.state.participants.keys());
      // 後から入ってきた方が発信側（caller）とする
      const callerWs = this.state.participants.get(caller);
      if (callerWs) {
        callerWs.send(JSON.stringify({ type: 'calling', from: callee }));
      }
    }

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as SignalMessage;
        this.handleMessage(phone, message);
      } catch (e) {
        console.error('Invalid message:', e);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.addEventListener('close', () => {
      this.handleLeave(phone);
    });

    ws.addEventListener('error', () => {
      this.handleLeave(phone);
    });
  }

  private handleMessage(from: string, message: SignalMessage): void {
    this.state.lastActivity = Date.now();
    this.setAlarm();

    switch (message.type) {
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        // 指定された宛先へユニキャスト
        const targetWs = this.state.participants.get(message.to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...message, from }));
        }
        break;
      case 'leave':
        this.handleLeave(from);
        break;
    }
  }

  private handleLeave(phone: string): void {
    this.state.participants.delete(phone);
    this.broadcastExcept(phone, { type: 'peer-left', userId: phone });

    // 参加者がいなくなったらルーム終了
    if (this.state.participants.size === 0) {
      this.state.callState = 'ended';
      this.clearAlarm();
    }
  }

  private broadcastExcept(excludePhone: string, message: SignalMessage): void {
    const data = JSON.stringify(message);
    for (const [phone, ws] of this.state.participants) {
      if (phone !== excludePhone && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private setAlarm(): void {
    if (!this.alarmSet) {
      this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      this.alarmSet = true;
    }
  }

  private clearAlarm(): void {
    if (this.alarmSet) {
      this.ctx.storage.deleteAlarm();
      this.alarmSet = false;
    }
  }

  async alarm(): Promise<void> {
    // 非アクティブタイムアウト: 参加者全員切断
    for (const [phone, ws] of this.state.participants) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'ルームがタイムアウトしました' }));
        ws.close(1000, 'Room timeout');
      }
    }
    this.state.participants.clear();
    this.state.callState = 'ended';
    this.alarmSet = false;
  }
}