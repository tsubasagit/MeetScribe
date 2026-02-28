# CLAUDE.md — MeetScribe

## Overview
AI議事録 Chrome拡張。タブ音声キャプチャ → Gemini APIで文字起こし+要約。

## Tech Stack
- TypeScript + Webpack
- Chrome Extension Manifest V3
- Gemini 2.0 Flash API

## Commands
```bash
npm run build   # プロダクションビルド → dist/
npm run dev     # 開発モード（watch）
```

## Architecture
- `background.ts` — Service Worker: tabCapture制御、Offscreen管理
- `offscreen.ts` — MediaRecorder処理、音声パススルー
- `popup.ts` — ポップアップUI: 開始/停止、設定
- `gemini-api.ts` — Gemini API連携（2フェーズ: 文字起こし→要約）
- `results.ts` — 結果表示ページ
- `audio-manager.ts` — 音声データサイズ管理

## Testing
1. `npm run build`
2. Chrome `chrome://extensions/` → 開発者モード → `dist` フォルダを読み込み
3. 会議タブで拡張アイコンクリック → 録音開始/停止
