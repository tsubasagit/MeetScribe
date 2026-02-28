import type { GeminiResponse, MeetingSummary, Settings } from './types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash-001';

async function callGemini(
  apiKey: string,
  parts: any[],
  systemInstruction?: string
): Promise<string> {
  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini API エラー: ${data.error.message} (code: ${data.error.code})`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini APIから有効な応答がありませんでした');
  }

  return text;
}

/**
 * Phase1: 音声 → 文字起こし
 */
export async function transcribeAudio(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
  language: string
): Promise<string> {
  const langName = language === 'ja' ? '日本語' : 'English';

  const parts = [
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
    {
      text: `この音声を${langName}で文字起こししてください。

要件:
- 話者が区別できる場合は「話者A:」「話者B:」のように話者ラベルを付ける
- タイムスタンプを [MM:SS] 形式で適宜付与する
- 相槌や不明瞭な部分は (不明瞭) と記載する
- 出力は文字起こしテキストのみ（説明や前置きは不要）`,
    },
  ];

  return callGemini(apiKey, parts);
}

/**
 * Phase2: 文字起こしテキスト → 構造化要約
 */
export async function summarizeTranscript(
  apiKey: string,
  transcript: string,
  language: string
): Promise<MeetingSummary> {
  const langName = language === 'ja' ? '日本語' : 'English';

  const systemInstruction = `あなたは議事録作成のプロフェッショナルです。${langName}で出力してください。`;

  const parts = [
    {
      text: `以下の会議の文字起こしから、構造化された議事録要約を作成してください。

必ず以下のJSON形式で出力してください（JSON以外のテキストは含めないこと）:
{
  "overview": "会議の概要（2-3文）",
  "discussionPoints": ["議論ポイント1", "議論ポイント2", ...],
  "decisions": ["決定事項1", "決定事項2", ...],
  "actionItems": [
    {"task": "タスク内容", "assignee": "担当者名（不明なら省略）", "deadline": "期限（不明なら省略）"},
    ...
  ]
}

文字起こし:
---
${transcript}
---`,
    },
  ];

  const responseText = await callGemini(apiKey, parts, systemInstruction);

  // JSONパース（コードブロックで囲まれている場合にも対応）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('要約のJSONパースに失敗しました');
  }

  const summary: MeetingSummary = JSON.parse(jsonMatch[0]);
  return summary;
}

/**
 * 設定を取得
 */
export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings as Settings | undefined;
  if (!settings?.geminiApiKey) {
    throw new Error('Gemini API Keyが設定されていません。拡張のポップアップから設定してください。');
  }
  return settings;
}
