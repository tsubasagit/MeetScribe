import type { Message } from './types';

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let webLockResolve: (() => void) | null = null;

// --- Web Lock: Offscreen Documentがブラウザに破棄されるのを防止 ---
function acquireWebLock(): void {
  navigator.locks.request('meetscribe-recording', () => {
    return new Promise<void>((resolve) => {
      webLockResolve = resolve;
    });
  });
}

function releaseWebLock(): void {
  if (webLockResolve) {
    webLockResolve();
    webLockResolve = null;
  }
}

// --- AudioContext の自動復帰 ---
function watchAudioContext(): void {
  if (healthCheckInterval) clearInterval(healthCheckInterval);

  healthCheckInterval = setInterval(() => {
    // AudioContext が suspended になったら強制 resume
    if (audioContext && audioContext.state === 'suspended') {
      console.log('[MeetScribe] AudioContext suspended → resuming');
      audioContext.resume();
    }

    // MediaRecorder が paused になったら resume
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      console.log('[MeetScribe] MediaRecorder paused → resuming');
      mediaRecorder.resume();
    }

    // トラックの状態チェック
    if (mediaStream) {
      const track = mediaStream.getAudioTracks()[0];
      if (track && track.readyState === 'ended') {
        console.warn('[MeetScribe] 音声トラックが終了しています');
      }
    }
  }, 2000);
}

function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// --- 音声キャプチャ ---
async function startCapture(streamId: string): Promise<void> {
  try {
    console.log('[MeetScribe] getUserMedia開始, streamId:', streamId);

    // Web Lock を取得（ドキュメント破棄を防止）
    acquireWebLock();

    // ストリームIDからMediaStreamを取得
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });

    const audioTracks = mediaStream.getAudioTracks();
    console.log('[MeetScribe] 取得トラック数:', audioTracks.length);
    audioTracks.forEach((track, i) => {
      console.log(`[MeetScribe] Track${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
    });

    if (audioTracks.length === 0) {
      throw new Error('音声トラックが取得できませんでした');
    }

    // AudioContextで音声をパススルー再生
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    // AudioContext の statechange を監視して自動復帰
    audioContext.onstatechange = () => {
      console.log(`[MeetScribe] AudioContext state: ${audioContext?.state}`);
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    };

    // MediaRecorderで録音
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      stopHealthCheck();
      const blob = new Blob(audioChunks, { type: mimeType });
      console.log(`[MeetScribe] 録音完了: ${audioChunks.length}チャンク, ${blob.size}バイト`);
      const base64 = await blobToBase64(blob);
      const baseMimeType = mimeType.split(';')[0];

      chrome.runtime.sendMessage({
        type: 'recording-stopped',
        audioBase64: base64,
        mimeType: baseMimeType,
      } satisfies Message);

      cleanup();
    };

    // 1秒ごとにチャンク収集
    mediaRecorder.start(1000);

    // ヘルスチェック開始（AudioContext / MediaRecorder の自動復帰）
    watchAudioContext();

    console.log('[MeetScribe] 録音開始完了');
  } catch (err) {
    console.error('[MeetScribe] キャプチャ開始エラー:', err);
    chrome.runtime.sendMessage({
      type: 'recording-error',
      error: String(err),
    } satisfies Message);
    cleanup();
  }
}

function stopCapture(): void {
  stopHealthCheck();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanup(): void {
  stopHealthCheck();
  releaseWebLock();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  mediaRecorder = null;
  audioChunks = [];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Service Workerからのメッセージを受信
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'start-capture':
      console.log('[MeetScribe] start-capture received');
      startCapture(message.streamId);
      sendResponse({ ok: true });
      break;
    case 'stop-capture':
      console.log('[MeetScribe] stop-capture received');
      stopCapture();
      sendResponse({ ok: true });
      break;
  }
  return true;
});
