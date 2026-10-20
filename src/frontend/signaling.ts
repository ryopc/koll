// WebSocket シグナリングクライアント

import type { SignalMessage } from '../worker/types';

type SignalingEventMap = {
  open: void;
  close: { code: number; reason: string };
  error: Event;
  message: SignalMessage;
  calling: { from: string };
  'peer-joined': { userId: string };
  'peer-left': { userId: string };
};

type EventHandler<K extends keyof SignalingEventMap> = (data: SignalingEventMap[K]) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private phoneNumber: string;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private handlers: Map<keyof SignalingEventMap, Set<Function>> = new Map();
  private url: string;

  constructor(phoneNumber: string, token: string) {
    this.phoneNumber = phoneNumber;
    this.token = token;
    
    // WebSocket URL 構築（相対パス）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/ws?phone=${encodeURIComponent(phoneNumber)}&token=${encodeURIComponent(token)}`;
  }

  /**
   * 接続開始
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('[Signaling] Connected');
          this.reconnectAttempts = 0;
          this.emit('open', undefined);
          resolve();
        };
        
        this.ws.onclose = (event) => {
          console.log('[Signaling] Closed:', event.code, event.reason);
          this.emit('close', { code: event.code, reason: event.reason });
          
          // 正常終了でない場合は再接続試行
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };
        
        this.ws.onerror = (event) => {
          console.error('[Signaling] Error:', event);
          this.emit('error', event);
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as SignalMessage;
            this.handleMessage(message);
          } catch (e) {
            console.error('[Signaling] Invalid message:', e);
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 再接続スケジュール
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Signaling] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(() => {
        // 再接続失敗時は次の試行へ
      });
    }, delay);
  }

  /**
   * メッセージハンドリング
   */
  private handleMessage(message: SignalMessage): void {
    this.emit('message', message);
    
    switch (message.type) {
      case 'calling':
        this.emit('calling', { from: message.from });
        break;
      case 'peer-joined':
        this.emit('peer-joined', { userId: message.userId });
        break;
      case 'peer-left':
        this.emit('peer-left', { userId: message.userId });
        break;
    }
  }

  /**
   * メッセージ送信
   */
  send(message: SignalMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * join メッセージ送信
   */
  join(roomId: string): boolean {
    return this.send({
      type: 'join',
      roomId,
      userId: this.phoneNumber,
    });
  }

  /**
   * offer 送信
   */
  sendOffer(sdp: RTCSessionDescriptionInit, to: string): boolean {
    return this.send({
      type: 'offer',
      sdp,
      from: this.phoneNumber,
      to,
    });
  }

  /**
   * answer 送信
   */
  sendAnswer(sdp: RTCSessionDescriptionInit, to: string): boolean {
    return this.send({
      type: 'answer',
      sdp,
      from: this.phoneNumber,
      to,
    });
  }

  /**
   * ICE candidate 送信
   */
  sendIceCandidate(candidate: RTCIceCandidateInit, to: string): boolean {
    return this.send({
      type: 'ice-candidate',
      candidate,
      from: this.phoneNumber,
      to,
    });
  }

  /**
   * leave 送信
   */
  leave(): boolean {
    return this.send({
      type: 'leave',
      userId: this.phoneNumber,
    });
  }

  /**
   * 切断
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * イベントリスナー登録
   */
  on<K extends keyof SignalingEventMap>(event: K, handler: EventHandler<K>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    
    // アン登録関数を返す
    return () => this.off(event, handler);
  }

  /**
   * イベントリスナー削除
   */
  off<K extends keyof SignalingEventMap>(event: K, handler: EventHandler<K>): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * イベント発行
   */
  private emit<K extends keyof SignalingEventMap>(event: K, data: SignalingEventMap[K]): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error(`[Signaling] Handler error for ${event}:`, e);
      }
    });
  }

  /**
   * 接続状態取得
   */
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  /**
   * 自分の電話番号取得
   */
  get myPhoneNumber(): string {
    return this.phoneNumber;
  }
}