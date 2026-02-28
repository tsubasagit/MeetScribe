import { transcribeAudio, summarizeTranscript, getSettings } from './gemini-api';
import { canSendInline } from './audio-manager';
import type { MeetingResult, MeetingSummary } from './types';

const loadingEl = document.getElementById('loading') as HTMLDivElement;
const loadingTextEl = document.getElementById('loading-text') as HTMLParagraphElement;
const contentEl = document.getElementById('content') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const metaEl = document.getElementById('meeting-meta') as HTMLParagraphElement;

// 要約要素
const summaryOverview = document.getElementById('summary-overview') as HTMLDivElement;
const summaryDiscussion = document.getElementById('summary-discussion') as HTMLUListElement;
const summaryDecisions = document.getElementById('summary-decisions') as HTMLUListElement;
const summaryActions = document.getElementById('summary-actions') as HTMLDivElement;
const transcriptEl = document.getElementById('transcript') as HTMLPreElement;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}分${sec}秒`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function showError(message: string): void {
  loadingEl.classList.add('hidden');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function renderSummary(summary: MeetingSummary): void {
  summaryOverview.textContent = summary.overview;

  summaryDiscussion.innerHTML = '';
  for (const point of summary.discussionPoints) {
    const li = document.createElement('li');
    li.textContent = point;
    summaryDiscussion.appendChild(li);
  }

  summaryDecisions.innerHTML = '';
  for (const decision of summary.decisions) {
    const li = document.createElement('li');
    li.textContent = decision;
    summaryDecisions.appendChild(li);
  }

  summaryActions.innerHTML = '';
  for (const item of summary.actionItems) {
    const div = document.createElement('div');
    div.className = 'action-item';

    const taskSpan = document.createElement('span');
    taskSpan.textContent = item.task;
    div.appendChild(taskSpan);

    if (item.assignee) {
      const assigneeSpan = document.createElement('span');
      assigneeSpan.className = 'assignee';
      assigneeSpan.textContent = `@${item.assignee}`;
      div.appendChild(assigneeSpan);
    }

    if (item.deadline) {
      const deadlineSpan = document.createElement('span');
      deadlineSpan.className = 'deadline';
      deadlineSpan.textContent = item.deadline;
      div.appendChild(deadlineSpan);
    }

    summaryActions.appendChild(div);
  }
}

// コピーボタン
document.querySelectorAll('.btn-copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = (btn as HTMLButtonElement).dataset.target!;
    const el = document.getElementById(target);
    if (!el) return;

    let text: string;
    if (target === 'summary') {
      // 要約をMarkdown形式でコピー
      text = buildSummaryMarkdown();
    } else {
      text = el.textContent || '';
    }

    await navigator.clipboard.writeText(text);
    btn.textContent = 'コピー済み';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'コピー';
      btn.classList.remove('copied');
    }, 2000);
  });
});

function buildSummaryMarkdown(): string {
  const lines: string[] = [];
  lines.push(`## 概要`);
  lines.push(summaryOverview.textContent || '');
  lines.push('');

  lines.push(`## 議論ポイント`);
  summaryDiscussion.querySelectorAll('li').forEach((li) => {
    lines.push(`- ${li.textContent}`);
  });
  lines.push('');

  lines.push(`## 決定事項`);
  summaryDecisions.querySelectorAll('li').forEach((li) => {
    lines.push(`- ${li.textContent}`);
  });
  lines.push('');

  lines.push(`## アクションアイテム`);
  summaryActions.querySelectorAll('.action-item').forEach((item) => {
    const parts = Array.from(item.children).map((el) => el.textContent);
    lines.push(`- ${parts.join(' ')}`);
  });

  return lines.join('\n');
}

// メイン処理
async function processAudio(): Promise<void> {
  try {
    const settings = await getSettings();

    // pendingAudio を取得
    const storageResult = await chrome.storage.local.get('pendingAudio');
    const pendingAudio = storageResult.pendingAudio as {
      id: string;
      audioBase64: string;
      mimeType: string;
      duration: number;
      timestamp: number;
    } | undefined;
    if (!pendingAudio) {
      showError('処理する音声データが見つかりません');
      return;
    }

    const { id, audioBase64, mimeType, duration, timestamp } = pendingAudio;

    // メタ情報表示
    metaEl.textContent = `${formatDate(timestamp)} | 録音時間: ${formatDuration(duration)}`;

    // サイズチェック
    if (!canSendInline(audioBase64)) {
      showError('音声ファイルが20MBを超えています。短い区間に分けて録音してください。');
      return;
    }

    // Phase1: 文字起こし
    loadingTextEl.textContent = '音声を文字起こし中...（1/2）';
    const transcript = await transcribeAudio(
      settings.geminiApiKey,
      audioBase64,
      mimeType,
      settings.language || 'ja'
    );

    // Phase2: 要約
    loadingTextEl.textContent = '要約を生成中...（2/2）';
    const summary = await summarizeTranscript(
      settings.geminiApiKey,
      transcript,
      settings.language || 'ja'
    );

    // 結果を保存
    const result: MeetingResult = {
      id,
      timestamp,
      duration,
      transcript,
      summary,
    };
    await chrome.storage.local.set({
      [`result_${id}`]: result,
      lastResultId: id,
    });

    // pendingAudio をクリア（音声データは大きいので）
    await chrome.storage.local.remove('pendingAudio');

    // 表示
    transcriptEl.textContent = transcript;
    renderSummary(summary);

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    showError(String(err));
  }
}

processAudio();
