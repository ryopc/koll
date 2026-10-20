// WebRTC 管理クラス（音声のみ）

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  },
  video: false,
};

type WebRTCEventMap = {
  'local-stream': MediaStream;
  'remote-stream': MediaStream;
  'connection-state-change': RTCPeerConnectionState;
  'ice-connection-state-change': RTCIceConnectionState;
  'error': Error;
  'ice-candidate': RTCIceCandidateInit;
  'negotiation-needed': void;
};

type EventHandler<K extends keyof WebRTCEventMap> = (data: WebRTCEventMap[K]) => void;

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private handlers: Map<keyof WebRTCEventMap, Set<Function>> = new Map();
  private isCaller = false;
  private remotePhoneNumber: string | null = null;

  constructor() {
    this.createPeerConnection();
  }

  /**
   * PeerConnection 作成
   */
  private createPeerConnection(): void {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('ice-candidate', event.candidate.toJSON());
      }
    };
    
    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.emit('connection-state-change', this.pc.connectionState);
      }
    };
    
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc) {
        this.emit('ice-connection-state-change', this.pc.iceConnectionState);
      }
    };
    
    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.emit('remote-stream', this.remoteStream);
    };
    
    this.pc.onnegotiationneeded = () => {
      this.emit('negotiation-needed', undefined);
    };
  }

  /**
   * ローカルストリーム取得（マイク）
   */
  async getLocalStream(): Promise<MediaStream> {
    if (this.localStream) {
      return this.localStream;
    }
    
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      
      // トラックを PeerConnection に追加
      if (this.pc) {
        this.localStream.getTracks().forEach(track => {
          this.pc!.addTrack(track, this.localStream!);
        });
      }
      
      this.emit('local-stream', this.localStream);
      return this.localStream;
    } catch (e) {
      const error = e as Error;
      console.error('[WebRTC] getUserMedia error:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 発信側としてオファー作成
   */
  async createOffer(remotePhoneNumber: string): Promise<RTCSessionDescriptionInit | null> {
    this.isCaller = true;
    this.remotePhoneNumber = remotePhoneNumber;
    
    if (!this.pc) this.createPeerConnection();
    
    try {
      const offer = await this.pc!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      
      await this.pc!.setLocalDescription(offer);
      return offer;
    } catch (e) {
      console.error('[WebRTC] Create offer error:', e);
      this.emit('error', e as Error);
      return null;
    }
  }

  /**
   * 着信側としてオファー受信・アンサー作成
   */
  async createAnswer(offer: RTCSessionDescriptionInit, remotePhoneNumber: string): Promise<RTCSessionDescriptionInit | null> {
    this.isCaller = false;
    this.remotePhoneNumber = remotePhoneNumber;
    
    if (!this.pc) this.createPeerConnection();
    
    try {
      await this.pc!.setRemoteDescription(offer);
      const answer = await this.pc!.createAnswer();
      await this.pc!.setLocalDescription(answer);
      return answer;
    } catch (e) {
      console.error('[WebRTC] Create answer error:', e);
      this.emit('error', e as Error);
      return null;
    }
  }

  /**
   * リモートアンサー設定（発信側）
   */
  async setRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    
    try {
      await this.pc.setRemoteDescription(answer);
    } catch (e) {
      console.error('[WebRTC] Set remote answer error:', e);
      this.emit('error', e as Error);
      throw e;
    }
  }

  /**
   * ICE candidate 追加
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      console.error('[WebRTC] Add ICE candidate error:', e);
      // ICE candidate エラーは致命的ではないので throw しない
    }
  }

  /**
   * ミュート切り替え
   */
  setMuted(muted: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
  }

  /**
   * ミュート状態取得
   */
  get isMuted(): boolean {
    if (!this.localStream) return true;
    return this.localStream.getAudioTracks().every(track => !track.enabled);
  }

  /**
   * スピーカー切り替え（モバイルでのみ有効）
   */
  async setSpeakerphone(enabled: boolean): Promise<void> {
    if (!this.remoteStream) return;
    
    try {
      // @ts-expect-error - setSinkId は実験的
      if ('setSinkId' in HTMLAudioElement.prototype) {
        const audio = new Audio();
        audio.srcObject = this.remoteStream;
        // @ts-expect-error
        await audio.setSinkId(enabled ? 'speaker' : 'default');
      }
    } catch (e) {
      console.warn('[WebRTC] Speaker toggle not supported:', e);
    }
  }

  /**
   * 保留/再開
   */
  async setHold(hold: boolean): Promise<void> {
    if (!this.pc || !this.localStream) return;
    
    try {
      const audioTracks = this.localStream.getAudioTracks();
      for (const track of audioTracks) {
        const sender = this.pc.getSenders().find(s => s.track === track);
        if (sender) {
          await sender.replaceTrack(hold ? null : track);
        }
      }
    } catch (e) {
      console.error('[WebRTC] Hold error:', e);
      this.emit('error', e as Error);
    }
  }

  /**
   * 切断・クリーンアップ
   */
  close(): void {
    // ローカルストリーム停止
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // リモートストリーム停止
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => track.stop());
      this.remoteStream = null;
    }
    
    // PeerConnection 切断
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    
    this.remotePhoneNumber = null;
    this.isCaller = false;
  }

  /**
   * 再接続用に PeerConnection を再作成
   */
  async restart(): Promise<void> {
    const wasMuted = this.isMuted;
    const hadStream = !!this.localStream;
    
    this.close();
    this.createPeerConnection();
    
    if (hadStream) {
      await this.getLocalStream();
      this.setMuted(wasMuted);
    }
  }

  /**
   * イベントリスナー登録
   */
  on<K extends keyof WebRTCEventMap>(event: K, handler: EventHandler<K>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    
    return () => this.off(event, handler);
  }

  /**
   * イベントリスナー削除
   */
  off<K extends keyof WebRTCEventMap>(event: K, handler: EventHandler<K>): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * イベント発行
   */
  private emit<K extends keyof WebRTCEventMap>(event: K, data: WebRTCEventMap[K]): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error(`[WebRTC] Handler error for ${event}:`, e);
      }
    });
  }

  // Getters
  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  get localStreamMedia(): MediaStream | null {
    return this.localStream;
  }

  get remoteStreamMedia(): MediaStream | null {
    return this.remoteStream;
  }

  get connected(): boolean {
    return this.pc?.connectionState === 'connected';
  }

  get connecting(): boolean {
    return this.pc?.connectionState === 'connecting';
  }
}