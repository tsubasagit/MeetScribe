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
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'タブ音声の録音処理',
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

// 録音開始
async function startRecording(tabId: number): Promise<void> {
  try {
    // タブの音声ストリームIDを取得
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Offscreen Documentを準備
    await ensureOffscreenDocument();

    // Offscreenに録音開始を指示
    chrome.runtime.sendMessage({ type: 'start-capture', streamId } satisfies Message);

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
