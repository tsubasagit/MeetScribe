import type { GeminiResponse, MeetingSummary, Settings } from './types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

async function callGemini(
  apiKey: string,
  parts: any[],
  systemInstruction?: string
): Promise<string> {
  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16384,
      // Gemini 2.5 Flash: 思考モードをオフにして安定した出力を得る
      thinkingConfig: { thinkingBudget: 0 },
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

  const data = await response.json();

  if (data.error) {
    throw new Error(`Gemini API エラー: ${data.error.message} (code: ${data.error.code})`);
  }

  // Gemini 2.5 は思考パーツを含む場合がある。テキストパーツを探す
  const responseParts = data.candidates?.[0]?.content?.parts;
  if (!responseParts || responseParts.length === 0) {
    throw new Error(`Gemini APIから有効な応答がありませんでした: ${JSON.stringify(data).slice(0, 500)}`);
  }

  // thought=true でないテキストパーツを探す。なければ最後のテキストパーツを使う
  let text = '';
  for (const part of responseParts) {
    if (part.text && !part.thought) {
      text = part.text;
    }
  }
  // 見つからなければ、どのパーツでもテキストがあれば使う
  if (!text) {
    for (const part of responseParts) {
      if (part.text) {
        text = part.text;
        break;
      }
    }
  }

  if (!text) {
    throw new Error(`Gemini APIから有効な応答がありませんでした: ${JSON.stringify(responseParts).slice(0, 500)}`);
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
- 日本語テキストのトークン間にスペースを入れないこと（自然な日本語表記にする）
- 出力は文字起こしテキストのみ（説明や前置きは不要）`,
    },
  ];

  const text = await callGemini(apiKey, parts);
  return removeJapaneseSpaces(text);
}

/**
 * 日本語文字同士の間の不要なスペースを除去する
 */
function removeJapaneseSpaces(text: string): string {
  const jp = '[\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF\\uFF00-\\uFFEF]';
  const regex = new RegExp(`(${jp})\\s+(${jp})`, 'g');
  let result = text;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(regex, '$1$2');
  }
  return result;
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
