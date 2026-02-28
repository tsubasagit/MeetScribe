// 録音状態
export type RecordingState = 'idle' | 'recording' | 'processing';

// Service Worker ↔ Popup / Offscreen 間のメッセージ
export type Message =
  | { type: 'start-recording'; tabId: number }
  | { type: 'stop-recording' }
  | { type: 'recording-started' }
  | { type: 'recording-stopped'; audioBase64: string; mimeType: string }
  | { type: 'recording-error'; error: string }
  | { type: 'get-state' }
  | { type: 'state'; state: RecordingState; startTime: number | null }
  | { type: 'start-capture'; streamId: string }
  | { type: 'stop-capture' };

// Gemini API レスポンス
export interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text?: string }>;
    };
  }>;
  error?: { message: string; code: number };
}

// 議事録結果
export interface MeetingResult {
  id: string;
  timestamp: number;
  duration: number;
  transcript: string;
  summary: MeetingSummary;
}

export interface MeetingSummary {
  overview: string;
  discussionPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
}

export interface ActionItem {
  task: string;
  assignee?: string;
  deadline?: string;
}

// 設定
export interface Settings {
  geminiApiKey: string;
  language: string;
}
