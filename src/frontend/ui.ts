// UI 制御モジュール

import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { register, login, logout, fetchMe, isAuthenticated, getToken, clearAuth } from './auth.js';
import { storePhoneNumber, getStoredPhoneNumber, clearPhoneNumber } from './phoneNumber.js';
import { getContacts, addContact, updateContact, deleteContact, lookupContactName, formatContactPhone, validateContactPhone } from './contacts.js';
import { subscribeToPush, unsubscribeFromPush, requestNotificationPermission, isPushSupported } from './push.js';
import { buildRTCConfiguration } from './turn.js';

// 状態管理
type AppState = 'auth' | 'idle' | 'calling' | 'in-call' | 'incoming';

interface CallInfo {
  remoteNumber: string;
  isOutgoing: boolean;
  startTime: number;
  timerInterval: number | null;
}

interface Contact {
  id: number;
  contact_phone: string;
  display_name: string | null;
  created_at: number;
  updated_at: number;
}

let currentState: AppState = 'auth';
let currentCall: CallInfo | null = null;
let signaling: SignalingClient | null = null;
let currentContacts: Contact[] = [];
const webrtc = new WebRTCManager();

// DOM 要素キャッシュ
const els = {
  // Screens
  authScreen: document.getElementById('auth-screen')!,
  phoneScreen: document.getElementById('phone-screen')!,
  
  // Auth forms
  loginForm: document.getElementById('login-form') as HTMLFormElement,
  registerForm: document.getElementById('register-form') as HTMLFormElement,
  showRegister: document.getElementById('show-register')!,
  showLogin: document.getElementById('show-login')!,
  authError: document.getElementById('auth-error')!,
  authLoading: document.getElementById('auth-loading')!,
  
  // Phone screen
  myPhoneNumber: document.getElementById('my-phone-number')!,
  logoutBtn: document.getElementById('logout-btn')!,
  logoutBtn2: document.getElementById('logout-btn-2')!,
  
  // Tabs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  
  // Dial
  dialInput: document.getElementById('dial-input') as HTMLInputElement,
  dialKeys: document.querySelectorAll('.dial-key[data-digit]'),
  backspaceBtn: document.getElementById('backspace-btn')!,
  callBtn: document.getElementById('call-btn')!,
  clearBtn: document.getElementById('clear-btn')!,
  
  // Contacts
  contactsList: document.getElementById('contacts-list')!,
  contactsSearch: document.getElementById('contacts-search') as HTMLInputElement,
  addContactBtn: document.getElementById('add-contact-btn')!,
  
  // History
  historyList: document.getElementById('history-list')!,
  
  // Settings
  micPermissionBtn: document.getElementById('mic-permission-btn')!,
  installBtn: document.getElementById('install-btn')!,
  
  // Incoming modal
  incomingModal: document.getElementById('incoming-modal')!,
  incomingNumber: document.getElementById('incoming-number')!,
  incomingName: document.getElementById('incoming-name')!,
  acceptBtn: document.getElementById('accept-btn')!,
  declineBtn: document.getElementById('decline-btn')!,
  
  // Call modal
  callModal: document.getElementById('call-modal')!,
  callStatus: document.getElementById('call-status')!,
  callNumber: document.getElementById('call-number')!,
  callTimer: document.getElementById('call-timer')!,
  muteBtn: document.getElementById('mute-btn')!,
  speakerBtn: document.getElementById('speaker-btn')!,
  holdBtn: document.getElementById('hold-btn')!,
  hangupBtn: document.getElementById('hangup-btn')!,
  
  // Contact modal
  contactModal: document.getElementById('contact-modal')!,
  contactForm: document.getElementById('contact-form') as HTMLFormElement,
  contactId: document.getElementById('contact-id') as HTMLInputElement,
  contactPhone: document.getElementById('contact-phone') as HTMLInputElement,
  contactName: document.getElementById('contact-name') as HTMLInputElement,
  contactError: document.getElementById('contact-error')!,
  contactCancelBtn: document.getElementById('contact-cancel-btn')!,
  
  // Toast
  toastContainer: document.getElementById('toast-container')!,
};

// 通話履歴（localStorage）
const HISTORY_KEY = 'koll_call_history';

interface HistoryEntry {
  number: string;
  type: 'outgoing' | 'incoming' | 'missed';
  timestamp: number;
  duration: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

function addToHistory(entry: Omit<HistoryEntry, 'timestamp'>): void {
  const history = loadHistory();
  history.unshift({ ...entry, timestamp: Date.now() });
  saveHistory(history);
  renderHistory();
}

function renderHistory(): void {
  const history = loadHistory();
  if (history.length === 0) {
    els.historyList.innerHTML = '<p class="empty-state">通話履歴がありません</p>';
    return;
  }
  
  els.historyList.innerHTML = history.map(h => `
    <div class="history-item">
      <div class="history-avatar">${h.number.slice(3, 4).toUpperCase()}</div>
      <div class="history-info">
        <div class="history-name">${formatPhoneForDisplay(h.number)}</div>
        <div class="history-meta">
          <span class="history-type ${h.type}">${getTypeLabel(h.type)}</span>
          <span class="history-time">${formatTime(h.timestamp)}</span>
          ${h.duration > 0 ? `<span class="history-duration">${formatDuration(h.duration)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'outgoing': return '発信';
    case 'incoming': return '着信';
    case 'missed': return '不在着信';
    default: return '';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) + ' ' + 
         d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}:${(mins % 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`;
  return `${mins}:${(secs % 60).toString().padStart(2, '0')}`;
}

function formatPhoneForDisplay(phone: string): string {
  return phone.replace(/^ph([a-z])-(\d{4})(\d{4})$/, 'ph$1-$2-$3');
}

function getContactDisplayName(phone: string): string {
  const contact = currentContacts.find(c => c.contact_phone === phone);
  return contact?.display_name || formatPhoneForDisplay(phone);
}

// Toast 通知
function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideUp 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 画面切り替え
function showScreen(screen: 'auth' | 'phone'): void {
  els.authScreen.classList.toggle('active', screen === 'auth');
  els.authScreen.classList.toggle('hidden', screen !== 'auth');
  els.phoneScreen.classList.toggle('active', screen === 'phone');
  els.phoneScreen.classList.toggle('hidden', screen !== 'phone');
  currentState = screen === 'auth' ? 'auth' : 'idle';
}

// タブ切り替え
function switchTab(tabId: string): void {
  els.tabBtns.forEach(btn => {
    const isActive = btn.id === `tab-${tabId}`;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive.toString());
  });
  els.tabPanels.forEach(panel => {
    const isActive = panel.id === `panel-${tabId}`;
    panel.classList.toggle('active', isActive);
    panel.classList.toggle('hidden', !isActive);
  });
  
  // タブ切り替え時の処理
  if (tabId === 'contacts') {
    loadContacts();
  }
}

// モーダル表示/非表示
function showModal(modal: HTMLElement): void {
  modal.classList.remove('hidden');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function hideModal(modal: HTMLElement): void {
  modal.classList.add('hidden');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// 着信モーダル表示
async function showIncomingCall(fromNumber: string): Promise<void> {
  els.incomingNumber.textContent = formatPhoneForDisplay(fromNumber);
  const name = await lookupContactName(fromNumber);
  els.incomingName.textContent = name || '';
  showModal(els.incomingModal);
  currentState = 'incoming';
}

// 通話モーダル表示
function showCallModal(number: string, isOutgoing: boolean): void {
  els.callNumber.textContent = formatPhoneForDisplay(number);
  els.callStatus.textContent = isOutgoing ? '接続中...' : '着信中...';
  els.callTimer.textContent = '00:00';
  showModal(els.callModal);
  currentState = isOutgoing ? 'calling' : 'in-call';
  
  // タイマー開始
  if (currentCall) {
    currentCall.startTime = Date.now();
    currentCall.timerInterval = window.setInterval(updateCallTimer, 1000);
  }
}

function hideCallModal(): void {
  hideModal(els.callModal);
  hideModal(els.incomingModal);
  if (currentCall?.timerInterval) {
    clearInterval(currentCall.timerInterval);
    currentCall.timerInterval = null;
  }
  currentCall = null;
  currentState = 'idle';
  updateCallControls();
}

function updateCallTimer(): void {
  if (!currentCall) return;
  const elapsed = Date.now() - currentCall.startTime;
  const secs = Math.floor(elapsed / 1000);
  const mins = Math.floor(secs / 60);
  els.callTimer.textContent = `${mins.toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`;
}

// 通話コントロール更新
function updateCallControls(): void {
  if (!currentCall) return;
  
  els.muteBtn.setAttribute('aria-pressed', webrtc.isMuted.toString());
  els.holdBtn.setAttribute('aria-pressed', 'false');
}

// 認証フロー
async function handleLogin(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const formData = new FormData(els.loginForm);
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;
  
  setAuthLoading(true);
  els.authError.classList.add('hidden');
  
  const result = await login(username, password);
  
  if (result.success) {
    await initAfterAuth();
  } else {
    showAuthError(result.error || 'ログインに失敗しました');
  }
  
  setAuthLoading(false);
}

async function handleRegister(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const formData = new FormData(els.registerForm);
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;
  const confirm = formData.get('passwordConfirm') as string;
  
  if (password !== confirm) {
    showAuthError('パスワードが一致しません');
    return;
  }
  
  setAuthLoading(true);
  els.authError.classList.add('hidden');
  
  const result = await register(username, password);
  
  if (result.success) {
    await initAfterAuth();
  } else {
    showAuthError(result.error || '登録に失敗しました');
  }
  
  setAuthLoading(false);
}

function setAuthLoading(loading: boolean): void {
  els.authLoading.classList.toggle('hidden', !loading);
  (els.loginForm.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = loading;
  (els.registerForm.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = loading;
}

function showAuthError(message: string): void {
  els.authError.textContent = message;
  els.authError.classList.remove('hidden');
}

// 認証後の初期化
async function initAfterAuth(): Promise<void> {
  const user = await fetchMe();
  if (!user) {
    showAuthError('ユーザー情報の取得に失敗しました');
    return;
  }
  
  // 電話番号保存
  storePhoneNumber({ phoneNumber: user.phone_number, prefixIndex: 0 });
  
  // 自分の番号表示
  els.myPhoneNumber.textContent = formatPhoneForDisplay(user.phone_number);
  
  // Signaling 接続
  await connectSignaling(user.phone_number);
  
  // WebRTC 設定取得・ローカルストリーム取得
  try {
    const rtcConfig = await buildRTCConfiguration();
    // WebRTCManager に設定を適用（内部で再作成）
    await webrtc.getLocalStream();
  } catch (e) {
    showToast('マイクの許可が必要です', 'warning');
  }
  
  // Push 通知セットアップ
  await setupPushNotifications();
  
  // 履歴表示
  renderHistory();
  
  // 連絡先読み込み
  await loadContacts();
  
  // PWA インストールボタン
  setupInstallPrompt();
  
  // 画面切り替え
  showScreen('phone');
}

async function setupPushNotifications(): Promise<void> {
  if (!isPushSupported()) {
    console.log('Push notifications not supported');
    return;
  }
  
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.log('Push notification permission not granted');
    return;
  }
  
  try {
    await subscribeToPush();
    console.log('Push subscription successful');
  } catch (e) {
    console.error('Push subscribe error:', e);
  }
}

async function connectSignaling(phoneNumber: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  
  signaling = new SignalingClient(phoneNumber, token);
  
  // イベントハンドラ登録
  signaling.on('open', () => {
    console.log('[UI] Signaling connected');
    // 自分のルームに参加（着信待機）
    signaling!.join(phoneNumber);
  });
  
  signaling.on('calling', ({ from }) => {
    console.log('[UI] Incoming call from:', from);
    currentCall = {
      remoteNumber: from,
      isOutgoing: false,
      startTime: 0,
      timerInterval: null,
    };
    showIncomingCall(from);
  });
  
  signaling.on('peer-joined', ({ userId }) => {
    console.log('[UI] Peer joined:', userId);
    if (currentState === 'calling' && currentCall) {
      // 相手が参加 → アンサー待ち
      els.callStatus.textContent = '接続中...';
    }
  });
  
  signaling.on('peer-left', ({ userId }) => {
    console.log('[UI] Peer left:', userId);
    if (currentState === 'in-call' || currentState === 'calling') {
      endCall('相手が切断しました');
    }
  });
  
  signaling.on('message', (message) => {
    handleSignalingMessage(message);
  });
  
  signaling.on('close', () => {
    console.log('[UI] Signaling closed');
    // 再接続は SignalingClient 内部で処理
  });
  
  signaling.on('error', () => {
    console.error('[UI] Signaling error');
  });
  
  await signaling.connect();
}

// シグナリングメッセージ処理
async function handleSignalingMessage(message: any): Promise<void> {
  switch (message.type) {
    case 'offer':
      await handleOffer(message);
      break;
    case 'answer':
      await handleAnswer(message);
      break;
    case 'ice-candidate':
      await handleIceCandidate(message);
      break;
  }
}

async function handleOffer(message: any): Promise<void> {
  if (!currentCall || currentCall.remoteNumber !== message.from) {
    // 新しい着信
    currentCall = {
      remoteNumber: message.from,
      isOutgoing: false,
      startTime: 0,
      timerInterval: null,
    };
    showIncomingCall(message.from);
  }
  
  const answer = await webrtc.createAnswer(message.sdp, message.from);
  if (answer && signaling) {
    signaling.sendAnswer(answer, message.from);
  }
}

async function handleAnswer(message: any): Promise<void> {
  if (currentCall && currentCall.remoteNumber === message.from) {
    await webrtc.setRemoteAnswer(message.sdp);
    els.callStatus.textContent = '接続済み';
    currentState = 'in-call';
    currentCall.startTime = Date.now();
    if (currentCall.timerInterval) {
      clearInterval(currentCall.timerInterval);
    }
    currentCall.timerInterval = window.setInterval(updateCallTimer, 1000);
  }
}

async function handleIceCandidate(message: any): Promise<void> {
  await webrtc.addIceCandidate(message.candidate);
}

// 発信処理
async function makeCall(): Promise<void> {
  const number = els.dialInput.value.trim();
  if (!number) {
    showToast('番号を入力してください', 'warning');
    return;
  }
  
  // 自分の番号への発信防止
  const myNumber = getStoredPhoneNumber()?.phoneNumber;
  if (myNumber && number === myNumber) {
    showToast('自分の番号にはかけられません', 'warning');
    return;
  }
  
  currentCall = {
    remoteNumber: number,
    isOutgoing: true,
    startTime: 0,
    timerInterval: null,
  };
  
  showCallModal(number, true);
  els.callStatus.textContent = '呼び出し中...';
  
  // シグナリングで相手のルームに参加
  if (signaling) {
    signaling.join(number);
    
    // ローカルストリーム確保
    await webrtc.getLocalStream();
    
    // オファー作成・送信
    const offer = await webrtc.createOffer(number);
    if (offer && signaling) {
      signaling.sendOffer(offer, number);
    }
  }
}

// 着信応答
async function acceptCall(): Promise<void> {
  if (!currentCall || !signaling) return;
  
  hideModal(els.incomingModal);
  showCallModal(currentCall.remoteNumber, false);
  els.callStatus.textContent = '接続中...';
  
  try {
    await webrtc.getLocalStream();
  } catch (e) {
    console.error('Accept call error:', e);
    endCall('接続に失敗しました');
  }
}

// 着信拒否
function declineCall(): void {
  if (currentCall && signaling) {
    signaling.send({
      type: 'leave',
      userId: currentCall.remoteNumber,
    } as any);
  }
  addToHistory({ number: currentCall?.remoteNumber || '', type: 'missed', duration: 0 });
  hideCallModal();
}

// 通話終了
function endCall(reason?: string): void {
  if (currentCall) {
    const duration = currentCall.startTime ? Date.now() - currentCall.startTime : 0;
    addToHistory({
      number: currentCall.remoteNumber,
      type: currentCall.isOutgoing ? 'outgoing' : 'incoming',
      duration,
    });
    
    if (signaling) {
      signaling.leave();
    }
  }
  
  webrtc.close();
  hideCallModal();
  
  if (reason) {
    showToast(reason, 'warning');
  }
}

// ミュート切り替え
function toggleMute(): void {
  const muted = webrtc.isMuted;
  webrtc.setMuted(!muted);
  updateCallControls();
}

// スピーカー切り替え
async function toggleSpeaker(): Promise<void> {
  const pressed = els.speakerBtn.getAttribute('aria-pressed') === 'true';
  els.speakerBtn.setAttribute('aria-pressed', (!pressed).toString());
  await webrtc.setSpeakerphone(!pressed);
}

// 保留切り替え
async function toggleHold(): Promise<void> {
  const pressed = els.holdBtn.getAttribute('aria-pressed') === 'true';
  els.holdBtn.setAttribute('aria-pressed', (!pressed).toString());
  await webrtc.setHold(!pressed);
  els.callStatus.textContent = !pressed ? '保留中' : '通話中';
}

// ログアウト
async function handleLogout(): Promise<void> {
  if (currentState !== 'idle') {
    endCall();
  }
  
  if (signaling) {
    signaling.disconnect();
    signaling = null;
  }
  
  await logout();
  clearPhoneNumber();
  clearAuth();
  
  // フォームリセット
  els.loginForm.reset();
  els.registerForm.reset();
  els.registerForm.classList.add('hidden');
  els.loginForm.classList.remove('hidden');
  
  showScreen('auth');
}

// ダイヤル入力処理
function handleDialInput(digit: string): void {
  if (currentState !== 'idle') return;
  const current = els.dialInput.value;
  if (current.length < 20) {
    els.dialInput.value = current + digit;
  }
}

function handleBackspace(): void {
  if (currentState !== 'idle') return;
  els.dialInput.value = els.dialInput.value.slice(0, -1);
}

function handleClear(): void {
  if (currentState !== 'idle') return;
  els.dialInput.value = '';
}

// 連絡先機能
async function loadContacts(query?: string): Promise<void> {
  currentContacts = await getContacts(query);
  renderContacts();
}

function renderContacts(): void {
  if (currentContacts.length === 0) {
    els.contactsList.innerHTML = '<p class="empty-state">連絡先がありません</p>';
    return;
  }
  
  els.contactsList.innerHTML = currentContacts.map(contact => `
    <div class="contact-item" data-id="${contact.id}" data-phone="${contact.contact_phone}">
      <div class="contact-avatar">${contact.display_name?.[0]?.toUpperCase() || contact.contact_phone.slice(3, 4).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${contact.display_name || formatContactPhone(contact.contact_phone)}</div>
        <div class="contact-phone">${formatContactPhone(contact.contact_phone)}</div>
      </div>
      <div class="contact-actions">
        <button class="contact-action-btn call" aria-label="発信" data-phone="${contact.contact_phone}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
        </button>
        <button class="contact-action-btn edit" aria-label="編集" data-id="${contact.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="contact-action-btn delete" aria-label="削除" data-id="${contact.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
  
  // イベントリスナー追加
  els.contactsList.querySelectorAll('.contact-action-btn.call').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const phone = (e.currentTarget as HTMLElement).dataset.phone!;
      els.dialInput.value = phone;
      makeCall();
    });
  });
  
  els.contactsList.querySelectorAll('.contact-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt((e.currentTarget as HTMLElement).dataset.id!, 10);
      openContactModal(id);
    });
  });
  
  els.contactsList.querySelectorAll('.contact-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt((e.currentTarget as HTMLElement).dataset.id!, 10);
      if (confirm('この連絡先を削除しますか？')) {
        const success = await deleteContact(id);
        if (success) {
          showToast('連絡先を削除しました', 'success');
          loadContacts(els.contactsSearch.value);
        } else {
          showToast('削除に失敗しました', 'error');
        }
      }
    });
  });
}

// 連絡先検索
function handleContactsSearch(): void {
  const query = els.contactsSearch.value.trim();
  loadContacts(query || undefined);
}

// 連絡先モーダル
let editingContactId: number | null = null;

function openContactModal(id?: number): void {
  editingContactId = id || null;
  
  if (id) {
    const contact = currentContacts.find(c => c.id === id);
    if (contact) {
      els.contactModal.querySelector('h2')!.textContent = '連絡先を編集';
      els.contactPhone.value = formatContactPhone(contact.contact_phone);
      els.contactPhone.disabled = true;
      els.contactName.value = contact.display_name || '';
      els.contactId.value = id.toString();
    }
  } else {
    els.contactModal.querySelector('h2')!.textContent = '連絡先を追加';
    els.contactPhone.value = '';
    els.contactPhone.disabled = false;
    els.contactName.value = '';
    els.contactId.value = '';
  }
  
  els.contactError.classList.add('hidden');
  showModal(els.contactModal);
}

async function handleContactSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  
  const phone = els.contactPhone.value.trim();
  const name = els.contactName.value.trim() || null;
  
  if (!validateContactPhone(phone)) {
    showContactError('電話番号の形式が正しくありません (phx-xxxx-xxxx)');
    return;
  }
  
  try {
    let success: boolean;
    if (editingContactId) {
      success = await updateContact(editingContactId, name ?? null);
    } else {
      const contact = await addContact(phone, name ?? undefined);
      success = !!contact;
    }
    
    if (success) {
      showToast(editingContactId ? '連絡先を更新しました' : '連絡先を追加しました', 'success');
      hideModal(els.contactModal);
      loadContacts(els.contactsSearch.value);
    } else {
      showContactError('保存に失敗しました');
    }
  } catch (e: any) {
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique')) {
      showContactError('この番号は既に登録されています');
    } else {
      showContactError('保存に失敗しました');
    }
  }
}

function showContactError(message: string): void {
  els.contactError.textContent = message;
  els.contactError.classList.remove('hidden');
}

// PWA インストールプロンプト
let deferredPrompt: BeforeInstallPromptEvent | null = null;

function setupInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as any;
    els.installBtn.classList.remove('hidden');
  });
  
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    els.installBtn.classList.add('hidden');
    showToast('インストール完了', 'success');
  });
}

async function handleInstall(): Promise<void> {
  if (!deferredPrompt) return;
  
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  
  if (outcome === 'accepted') {
    showToast('インストールを開始しました', 'success');
  }
  deferredPrompt = null;
  els.installBtn.classList.add('hidden');
}

// マイク権限チェック
async function checkMicPermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    showToast('マイクアクセス: 許可済み', 'success');
  } catch (e) {
    showToast('マイクアクセス: 拒否されています', 'error');
  }
}

// イベントリスナー登録
function setupEventListeners(): void {
  // Auth
  els.loginForm.addEventListener('submit', handleLogin);
  els.registerForm.addEventListener('submit', handleRegister);
  els.showRegister.addEventListener('click', () => {
    els.loginForm.classList.add('hidden');
    els.registerForm.classList.remove('hidden');
  });
  els.showLogin.addEventListener('click', () => {
    els.registerForm.classList.add('hidden');
    els.loginForm.classList.remove('hidden');
  });
  
  // Logout
  els.logoutBtn.addEventListener('click', handleLogout);
  els.logoutBtn2.addEventListener('click', handleLogout);
  
  // Tabs
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.id.replace('tab-', '');
      switchTab(tabId);
    });
  });
  
  // Dial pad
  els.dialKeys.forEach(key => {
    key.addEventListener('click', () => {
      const digit = key.getAttribute('data-digit')!;
      handleDialInput(digit);
    });
  });
  els.backspaceBtn.addEventListener('click', handleBackspace);
  els.clearBtn.addEventListener('click', handleClear);
  els.callBtn.addEventListener('click', makeCall);
  
  // Contacts
  els.contactsSearch.addEventListener('input', handleContactsSearch);
  els.addContactBtn.addEventListener('click', () => openContactModal());
  els.contactForm.addEventListener('submit', handleContactSubmit);
  els.contactCancelBtn.addEventListener('click', () => hideModal(els.contactModal));
  
  // Incoming
  els.acceptBtn.addEventListener('click', acceptCall);
  els.declineBtn.addEventListener('click', declineCall);
  
  // Call controls
  els.muteBtn.addEventListener('click', toggleMute);
  els.speakerBtn.addEventListener('click', toggleSpeaker);
  els.holdBtn.addEventListener('click', toggleHold);
  els.hangupBtn.addEventListener('click', () => endCall());
  
  // Settings
  els.micPermissionBtn.addEventListener('click', checkMicPermission);
  els.installBtn.addEventListener('click', handleInstall);
  
  // Keyboard support for dial input
  document.addEventListener('keydown', (e) => {
    if (currentState !== 'idle') return;
    
    const isDialInputFocused = e.target === els.dialInput;
    
    // ダイヤル入力欄にフォーカスがある場合は通常のキーボード入力を許可（アルファベット含む）
    if (isDialInputFocused) {
      // バックスペース、エンター、エスケープのみ制御用として処理
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        makeCall();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
      // その他のキー（アルファベット等）はブラウザのデフォルト動作（入力）に任せる
      return;
    }
    
    // フォーカスがない場合は従来通りテンキー操作
    if (e.key >= '0' && e.key <= '9') {
      handleDialInput(e.key);
    } else if (e.key === '*' || e.key === '#') {
      handleDialInput(e.key);
    } else if (e.key === 'Backspace') {
      handleBackspace();
    } else if (e.key === 'Escape') {
      handleClear();
    } else if (e.key === 'Enter') {
      makeCall();
    }
  });
  
  // WebRTC イベント
  webrtc.on('connection-state-change', (state) => {
    console.log('[UI] Connection state:', state);
    if (state === 'connected' && currentState === 'calling') {
      currentState = 'in-call';
      els.callStatus.textContent = '通話中';
      if (currentCall) {
        currentCall.startTime = Date.now();
        if (currentCall.timerInterval) clearInterval(currentCall.timerInterval);
        currentCall.timerInterval = window.setInterval(updateCallTimer, 1000);
      }
    } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      if (currentState !== 'idle') {
        endCall(state === 'failed' ? '接続に失敗しました' : '通話が終了しました');
      }
    }
  });
  
  webrtc.on('error', (error) => {
    console.error('[UI] WebRTC error:', error);
    showToast('通話エラー: ' + error.message, 'error');
  });
  
  // Contact modal close on backdrop click
  els.contactModal.addEventListener('click', (e) => {
    if (e.target === els.contactModal) {
      hideModal(els.contactModal);
    }
  });
}

// 初期化
async function init(): Promise<void> {
  setupEventListeners();
  renderHistory();
  
  // 既存認証チェック
  if (isAuthenticated()) {
    const user = await fetchMe();
    if (user) {
      await initAfterAuth();
      return;
    }
  }
  
  // 認証画面表示
  showScreen('auth');
}

// 開始
init().catch(console.error);

// Service Worker 登録（PWA）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

// 型拡張: beforeinstallprompt イベント
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}