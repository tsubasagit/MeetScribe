import type { Message } from './types';

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;

// 音声ストリームを取得してパススルー再生 + 録音開始
async function startCapture(streamId: string): Promise<void> {
  try {
    console.log('[MeetScribe] getUserMedia開始, streamId:', streamId);

    // ストリームIDからMediaStreamを取得
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any, // Chrome独自制約のためany
      video: false,
    });

    // ストリームの状態をログ
    const audioTracks = mediaStream.getAudioTracks();
    console.log('[MeetScribe] 取得トラック数:', audioTracks.length);
    audioTracks.forEach((track, i) => {
      console.log(`[MeetScribe] Track${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}, label=${track.label}`);
    });

    if (audioTracks.length === 0) {
      throw new Error('音声トラックが取得できませんでした。タブで音声が再生されているか確認してください。');
    }

    // AudioContextで音声をユーザーにも聞こえるようにパススルー
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

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
      const blob = new Blob(audioChunks, { type: mimeType });
      console.log(`[MeetScribe] 録音完了: ${audioChunks.length}チャンク, ${blob.size}バイト`);
      const base64 = await blobToBase64(blob);

      // Gemini APIに送るmimeTypeはcodecパラメータを除去
      const baseMimeType = mimeType.split(';')[0];

      // Service Workerに音声データを送信
      chrome.runtime.sendMessage({
        type: 'recording-stopped',
        audioBase64: base64,
        mimeType: baseMimeType,
      } satisfies Message);

      cleanup();
    };

    // 1秒ごとにチャンクを収集（短い録音でもデータを確保）
    mediaRecorder.start(1000);
  } catch (err) {
    console.error('キャプチャ開始エラー:', err);
    chrome.runtime.sendMessage({
      type: 'recording-error',
      error: String(err),
    } satisfies Message);
    cleanup();
  }
}

function stopCapture(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanup(): void {
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
      // data:audio/webm;base64,XXXXX の XXXXX 部分を返す
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
      console.log('[MeetScribe] start-capture received, streamId:', message.streamId);
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
