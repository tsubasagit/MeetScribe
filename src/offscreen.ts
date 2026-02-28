import type { Message } from './types';

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;

// 音声ストリームを取得してパススルー再生 + 録音開始
async function startCapture(streamId: string): Promise<void> {
  try {
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
      const base64 = await blobToBase64(blob);

      // Service Workerに音声データを送信
      chrome.runtime.sendMessage({
        type: 'recording-stopped',
        audioBase64: base64,
        mimeType,
      } satisfies Message);

      cleanup();
    };

    // 30秒ごとにチャンクを収集
    mediaRecorder.start(30000);
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
chrome.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case 'start-capture':
      startCapture(message.streamId);
      break;
    case 'stop-capture':
      stopCapture();
      break;
  }
});
