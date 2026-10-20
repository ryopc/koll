// エントリーポイント
import './style.css';
import './ui.ts';

// 型定義のためのインポート（使用しなくても型チェック用）
import type { SignalingClient } from './signaling.js';
import type { WebRTCManager } from './webrtc.js';

// 環境変数の型定義
/// <reference types="vite/client" />

// コンソール用デバッグ情報
console.log('Koll Phone v0.1.0 - Initialized');
console.log('Environment:', import.meta.env.MODE);
console.log('PWA:', navigator.serviceWorker ? 'Supported' : 'Not supported');