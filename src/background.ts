import type { Message, RecordingState } from './types';

// --- 状態管理（chrome.storage で永続化し、Service Worker再起動に耐える） ---

interface RecordingInfo {
  state: RecordingState;
  startTime: number | null;
  tabId: number | null;
  tabUrl: string | null;
}

const DEFAULT_INFO: RecordingInfo = {
  state: 'idle',
  startTime: null,
  tabId: null,
  tabUrl: null,
};

// メモリキャッシュ（高速アクセス用）
let info: RecordingInfo = { ...DEFAULT_INFO };

async function loadState(): Promise<void> {
  const result = await chrome.storage.session.get('recordingInfo');
  if (result.recordingInfo) {
    info = result.recordingInfo as RecordingInfo;
    updateBadge(info.state);
  }
}

async function saveState(patch: Partial<RecordingInfo>): Promise<void> {
  Object.assign(info, patch);
  await chrome.storage.session.set({ recordingInfo: info });
  updateBadge(info.state);
}

// Service Worker 起動時に状態を復元
loadState();

// --- Keep-alive: 録音中はService Workerがスリープしないよう定期ping ---

const KEEPALIVE_ALARM = 'meetscribe-keepalive';

function startKeepAlive(): void {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // 24秒ごと
}

function stopKeepAlive(): void {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Service Worker を起こすだけ。状態を再読み込み。
    loadState();
  }
});

// --- Offscreen Document 管理 ---

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
    ],
    justification: 'タブ音声のキャプチャと録音処理',
  });
}

async function closeOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

// --- バッジ ---

function updateBadge(state: RecordingState): void {
  if (state === 'recording') {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
  } else if (state === 'processing') {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#2196F3' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// --- Offscreenへのメッセージ送信（再試行付き） ---

async function sendToOffscreen(message: Message, retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('Offscreen Documentとの通信に失敗しました');
}

// --- 録音開始 / 停止 ---

async function startRecording(tabId: number): Promise<void> {
  try {
    // 前回のストリームが残っている場合はクリーンアップ
    await closeOffscreenDocument();

    // タブのURLを記録（URL変更検知用）
    const tab = await chrome.tabs.get(tabId);
    const tabOrigin = tab.url ? new URL(tab.url).origin : null;

    // タブの音声ストリームIDを取得
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Offscreen Documentを新規作成
    await ensureOffscreenDocument();

    // Offscreenに録音開始を指示
    await sendToOffscreen({ type: 'start-capture', streamId });

    // 状態を永続化
    await saveState({
      state: 'recording',
      startTime: Date.now(),
      tabId,
      tabUrl: tabOrigin,
    });

    // Keep-alive開始
    startKeepAlive();
  } catch (err) {
    console.error('[MeetScribe] 録音開始エラー:', err);
    await saveState({ ...DEFAULT_INFO });
    stopKeepAlive();
    throw err;
  }
}

async function stopRecording(): Promise<void> {
  await saveState({ state: 'processing' });
  stopKeepAlive();
  try {
    await chrome.runtime.sendMessage({ type: 'stop-capture' } satisfies Message);
  } catch {
    // Offscreenが既に閉じている場合
    console.warn('[MeetScribe] Offscreenへの停止メッセージ送信失敗');
    await saveState({ ...DEFAULT_INFO });
  }
}

// --- タブ監視 ---

// タブが閉じられたら録音を自動停止
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState();
  if (info.state === 'recording' && info.tabId === tabId) {
    console.log('[MeetScribe] 録音中のタブが閉じられました。自動停止します。');
    await stopRecording();
  }
});

// タブのURL origin が変わったら録音を自動停止（SPA内遷移は無視）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  await loadState();
  if (info.state !== 'recording' || info.tabId !== tabId) return;

  // origin レベルで比較（YouTubeのSPA内遷移では停止しない）
  try {
    const newOrigin = new URL(changeInfo.url).origin;
    if (info.tabUrl && newOrigin !== info.tabUrl) {
      console.log('[MeetScribe] 録音中のタブが別サイトに遷移しました。自動停止します。');
      await stopRecording();
    }
  } catch {
    // URL解析失敗は無視
  }
});

// --- メッセージハンドラ ---

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'start-recording':
        startRecording(message.tabId)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;

      case 'stop-recording':
        stopRecording().then(() => sendResponse({ success: true }));
        return true;

      case 'get-state':
        loadState().then(() => {
          sendResponse({
            state: info.state,
            startTime: info.startTime,
          });
        });
        return true;

      case 'recording-stopped': {
        const duration = info.startTime ? Date.now() - info.startTime : 0;
        const resultId = `result_${Date.now()}`;

        chrome.storage.local.set({
          pendingAudio: {
            id: resultId,
            audioBase64: message.audioBase64,
            mimeType: message.mimeType,
            duration,
            timestamp: Date.now(),
          },
        });

        chrome.tabs.create({
          url: chrome.runtime.getURL(`results.html?id=${resultId}`),
        });

        closeOffscreenDocument();
        saveState({ ...DEFAULT_INFO });
        stopKeepAlive();
        break;
      }

      case 'recording-error':
        console.error('[MeetScribe] 録音エラー:', message.error);
        closeOffscreenDocument();
        saveState({ ...DEFAULT_INFO });
        stopKeepAlive();
        break;
    }
  }
);
