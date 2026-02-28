/**
 * 音声データの管理
 * 20MB以下: インラインBase64
 * 20MB超: Gemini File Upload API（将来対応）
 */

const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB

export interface AudioData {
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Base64文字列のバイトサイズを概算
 */
export function estimateBase64Size(base64: string): number {
  return Math.ceil(base64.length * 3 / 4);
}

/**
 * 音声データがインラインで送信可能かチェック
 */
export function canSendInline(base64: string): boolean {
  return estimateBase64Size(base64) <= MAX_INLINE_SIZE;
}

/**
 * 20MB超の場合のFile Upload API（将来実装）
 * 現時点ではエラーを返す
 */
export async function uploadLargeAudio(
  _apiKey: string,
  _base64: string,
  _mimeType: string
): Promise<string> {
  throw new Error(
    '20MBを超える音声ファイルは現在サポートされていません。' +
    '会議を短い区間に分けて録音してください。'
  );
}
