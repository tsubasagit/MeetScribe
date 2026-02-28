import type { Message, RecordingState, Settings } from './types';

const statusEl = document.getElementById('status') as HTMLDivElement;
const timerEl = document.getElementById('timer') as HTMLDivElement;
const btnRecord = document.getElementById('btn-record') as HTMLButtonElement;
const linkResults = document.getElementById('link-results') as HTMLAnchorElement;
const linkSettings = document.getElementById('link-settings') as HTMLAnchorElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement;
const inputApiKey = document.getElementById('input-api-key') as HTMLInputElement;
const selectLanguage = document.getElementById('select-language') as HTMLSelectElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;

// 同意確認モーダル
const consentModal = document.getElementById('consent-modal') as HTMLDivElement;
const consentCheckbox = document.getElementById('consent-checkbox') as HTMLInputElement;
const btnConsentOk = document.getElementById('btn-consent-ok') as HTMLButtonElement;
const btnConsentCancel = document.getElementById('btn-consent-cancel') as HTMLButtonElement;

let currentState: RecordingState = 'idle';
let startTime: number | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

// UI更新
function updateUI(state: RecordingState): void {
  currentState = state;

  statusEl.className = `status ${state}`;
  switch (state) {
    case 'idle':
      statusEl.textContent = '待機中';
      btnRecord.textContent = '録音開始';
      btnRecord.className = 'btn btn-start';
      btnRecord.disabled = false;
      break;
    case 'recording':
      statusEl.textContent = '録音中';
      btnRecord.textContent = '録音停止';
      btnRecord.className = 'btn btn-stop';
      btnRecord.disabled = false;
      break;
    case 'processing':
      statusEl.textContent = '処理中...';
      btnRecord.textContent = '処理中';
      btnRecord.className = 'btn btn-start';
      btnRecord.disabled = true;
      break;
  }
}

// タイマー
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function startTimer(start: number): void {
  stopTimer();
  startTime = start;
  timerInterval = setInterval(() => {
    if (startTime) {
      timerEl.textContent = formatTime(Date.now() - startTime);
    }
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00:00';
}

// 同意確認モーダル制御
consentCheckbox.addEventListener('change', () => {
  btnConsentOk.disabled = !consentCheckbox.checked;
});

btnConsentCancel.addEventListener('click', () => {
  consentModal.classList.add('hidden');
  consentCheckbox.checked = false;
  btnConsentOk.disabled = true;
});

// 同意後に実際に録音を開始
async function beginRecording(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('アクティブなタブが見つかりません');
    return;
  }

  btnRecord.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: 'start-recording',
    tabId: tab.id,
  } satisfies Message);

  if (response?.success) {
    updateUI('recording');
    startTimer(Date.now());
  } else {
    alert(`録音開始に失敗しました: ${response?.error || '不明なエラー'}`);
    btnRecord.disabled = false;
  }
}

btnConsentOk.addEventListener('click', () => {
  consentModal.classList.add('hidden');
  consentCheckbox.checked = false;
  btnConsentOk.disabled = true;
  beginRecording();
});

// 録音ボタン
btnRecord.addEventListener('click', async () => {
  if (currentState === 'idle') {
    // APIキーチェック
    const { settings } = await chrome.storage.local.get('settings') as { settings?: Settings };
    if (!settings?.geminiApiKey) {
      settingsPanel.classList.remove('hidden');
      inputApiKey.focus();
      alert('先にGemini API Keyを設定してください');
      return;
    }

    // 同意確認モーダルを表示
    consentModal.classList.remove('hidden');
  } else if (currentState === 'recording') {
    // 録音停止
    chrome.runtime.sendMessage({ type: 'stop-recording' } satisfies Message);
    stopTimer();
    updateUI('processing');
  }
});

// 前回結果リンク
linkResults.addEventListener('click', async (e) => {
  e.preventDefault();
  const { lastResultId } = await chrome.storage.local.get('lastResultId');
  if (lastResultId) {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`results.html?id=${lastResultId}`),
    });
  } else {
    alert('まだ結果がありません');
  }
});

// 設定トグル
linkSettings.addEventListener('click', (e) => {
  e.preventDefault();
  settingsPanel.classList.toggle('hidden');
});

// 設定保存
btnSaveSettings.addEventListener('click', async () => {
  const settings: Settings = {
    geminiApiKey: inputApiKey.value.trim(),
    language: selectLanguage.value,
  };
  await chrome.storage.local.set({ settings });
  alert('設定を保存しました');
  settingsPanel.classList.add('hidden');
});

// 初期化: 状態復元
async function init(): Promise<void> {
  // 保存済み設定を読み込み
  const { settings } = await chrome.storage.local.get('settings') as { settings?: Settings };
  if (settings) {
    inputApiKey.value = settings.geminiApiKey || '';
    selectLanguage.value = settings.language || 'ja';
  }

  // 現在の録音状態を取得
  const response = await chrome.runtime.sendMessage({ type: 'get-state' } satisfies Message);
  if (response) {
    updateUI(response.state);
    if (response.state === 'recording' && response.startTime) {
      startTimer(response.startTime);
    }
  }
}

init();
