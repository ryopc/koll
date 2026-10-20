import { DurableObject } from 'cloudflare:workers';
import type { Env, SignalMessage, RoomState, CallState } from '../types';
import { sendPushNotification } from '../api/push';

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

    // ルーム参加前の参加者数をチェック
    const wasEmpty = this.state.participants.size === 0;
    const hadOneParticipant = this.state.participants.size === 1;

    this.state.participants.set(phone, ws);
    this.state.lastActivity = Date.now();
    this.setAlarm();

    // 参加通知を他の参加者に送信
    this.broadcastExcept(phone, { type: 'peer-joined', userId: phone });

    // 着信処理
    if (hadOneParticipant) {
      // 既に1人いる（着信側が待機中） -> 発信側が参加
      const callee = Array.from(this.state.participants.keys()).find(p => p !== phone);
      if (callee) {
        const callerWs = this.state.participants.get(phone);
        if (callerWs) {
          callerWs.send(JSON.stringify({ type: 'calling', from: callee }));
        }
      }
    } else if (wasEmpty) {
      // 誰もいない（着信側が最初に参加） -> 相手が後で来るのを待つ
      // 何もしない（相手が join した時に calling 送信）
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

  private async handleLeave(phone: string): Promise<void> {
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

  /**
   * 着信側がオンライン（WebSocket 接続中）かチェック
   */
  private isCalleeOnline(calleePhone: string): boolean {
    const ws = this.state.participants.get(calleePhone);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * 発信者が join した際、着信側がオフラインなら Push 通知送信
   */
  private async notifyCalleeIfOffline(callerPhone: string, calleePhone: string): Promise<void> {
    // 着信側がこのルームにいない（オフライン）場合のみ Push 送信
    if (!this.isCalleeOnline(calleePhone)) {
      try {
        // 着信側のユーザーID取得
        const calleeUser = await this.env.DB.prepare(
          'SELECT id FROM users WHERE phone_number = ?'
        ).bind(calleePhone).first<{ id: number }>();
        
        if (calleeUser) {
          await sendPushNotification(this.env, calleeUser.id, {
            title: 'Koll 着信',
            body: `${callerPhone} から着信があります`,
            data: {
              type: 'incoming-call',
              from: callerPhone,
              roomId: calleePhone,
            },
            actions: [
              { action: 'answer', title: '応答' },
              { action: 'decline', title: '拒否' },
            ],
          });
        }
      } catch (e) {
        console.error('Push notification failed:', e);
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