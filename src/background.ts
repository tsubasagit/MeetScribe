import type { Message, RecordingState } from './types';

let recordingState: RecordingState = 'idle';
let recordingStartTime: number | null = null;
let recordingTabId: number | null = null;

// Offscreen Document管理
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

// バッジ表示
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

function setState(state: RecordingState): void {
  recordingState = state;
  updateBadge(state);
}

// Offscreenにメッセージを送信（準備完了まで再試行）
async function sendToOffscreen(message: Message, retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch {
      // Offscreenがまだロードされていない場合、少し待って再試行
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('Offscreen Documentとの通信に失敗しました');
}

// 録音開始
async function startRecording(tabId: number): Promise<void> {
  try {
    // 前回のストリームが残っている場合はクリーンアップ
    await closeOffscreenDocument();

    // タブの音声ストリームIDを取得
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Offscreen Documentを新規作成
    await ensureOffscreenDocument();

    // Offscreenに録音開始を指示（ロード完了まで再試行）
    await sendToOffscreen({ type: 'start-capture', streamId });

    recordingTabId = tabId;
    recordingStartTime = Date.now();
    setState('recording');
  } catch (err) {
    console.error('録音開始エラー:', err);
    setState('idle');
    throw err;
  }
}

// 録音停止
async function stopRecording(): Promise<void> {
  setState('processing');
  chrome.runtime.sendMessage({ type: 'stop-capture' } satisfies Message);
}

// タブが閉じられたら録音を自動停止して保存
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState === 'recording' && recordingTabId === tabId) {
    console.log('[MeetScribe] 録音中のタブが閉じられました。録音を自動停止します。');
    stopRecording();
  }
});

// タブのURLが変わったら録音を自動停止して保存
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    recordingState === 'recording' &&
    recordingTabId === tabId &&
    changeInfo.url
  ) {
    console.log('[MeetScribe] 録音中のタブのURLが変更されました。録音を自動停止します。');
    stopRecording();
  }
});

// メッセージハンドラ
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'start-recording':
        startRecording(message.tabId)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true; // 非同期レスポンス

      case 'stop-recording':
        stopRecording();
        sendResponse({ success: true });
        break;

      case 'get-state':
        sendResponse({
          state: recordingState,
          startTime: recordingStartTime,
        });
        break;

      case 'recording-stopped': {
        // Offscreenから音声データ受信 → storage に保存して結果ページを開く
        const duration = recordingStartTime ? Date.now() - recordingStartTime : 0;
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

        // 結果ページを開く
        chrome.tabs.create({
          url: chrome.runtime.getURL(`results.html?id=${resultId}`),
        });

        // クリーンアップ
        closeOffscreenDocument();
        recordingTabId = null;
        recordingStartTime = null;
        setState('idle');
        break;
      }

      case 'recording-error':
        console.error('録音エラー:', message.error);
        closeOffscreenDocument();
        recordingTabId = null;
        recordingStartTime = null;
        setState('idle');
        break;
    }
  }
);
