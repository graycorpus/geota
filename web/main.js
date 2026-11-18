import { AlphaTabApi, FontFileFormat, Settings, StaveProfile, importer } from '@coderline/alphatab';
import bravura from '@coderline/alphatab/font/Bravura.woff2?url';
import './style.css';

const $ = id => document.getElementById(id);
const form = $('upload-form');
const input = $('audio-file');
const drop = input.parentElement;
const generate = $('generate');
const demo = $('load-demo');
const status = $('status');
const progress = $('progress');
const errorBox = $('error');
const scoreElement = $('score');
const empty = $('empty-state');
const tracks = $('track-select');
const audio = $('original-audio');
const audioSection = $('audio-section');

const sample = String.raw`\title "双吉他示例"
\tempo 100
.
\track "主奏吉他"
\tuning E4 B3 G3 D3 A2 E2
:4 0.1 1.1 3.1 1.1 | 0.1 0.2 1.2 3.2 |
\track "节奏吉他"
\tuning E4 B3 G3 D3 A2 E2
:2 (0.1 1.2 0.3 2.4 3.5) (1.1 1.2 2.3 3.4) | (0.1 0.2 0.3 2.4 2.5 0.6) (3.1 0.2 0.3 0.4 2.5 3.6) |`;

const stages = {
  starting: '正在启动识别',
  extracting: '正在解码音频',
  transcribing: '正在识别音符',
  arranging: '正在编排六线谱',
};

const errors = {
  'unsupported-format': '请选择 MP3 文件。',
  'missing-audio': '这段录音是空文件，请重新选择。',
  'file-too-large': '文件超过 25 MiB，请截取一段较短的录音。',
  'too-long': '这段录音超过 15 分钟，请截取后重试。',
  'no-audio': '未从文件中找到可用音频。',
  'upload-not-found': '上传已过期，请再次生成。',
  'task-not-found': '识别任务已过期，请再次生成。',
  busy: '当前任务较多，请稍后重试。',
  timeout: '识别超时，请使用较短的录音重试。',
  failed: '无法识别这段录音。请检查文件能否播放，并确认后端已安装 FFmpeg。',
};

let selectedFile;
let busy = false;
let api;
let score;
let audioUrl;

function reportError(message) {
  status.textContent = '';
  progress.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function updateStatus(message, fraction) {
  errorBox.hidden = true;
  status.textContent = message;
  progress.hidden = fraction === undefined;
  if (fraction !== undefined) progress.value = fraction;
}

function selectFile(file) {
  if (busy || !file) return;
  if (!/\.mp3$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) {
    selectedFile = undefined;
    input.value = '';
    $('file-label').textContent = '选择 MP3 或拖到这里';
    generate.disabled = true;
    reportError(!/\.mp3$/i.test(file.name) ? errors['unsupported-format']
      : !file.size ? errors['missing-audio'] : errors['file-too-large']);
    return;
  }
  selectedFile = file;
  $('file-label').textContent = file.name;
  generate.disabled = false;
  updateStatus('');
}

function showAudio(file) {
  audio.pause();
  audio.removeAttribute('src');
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = file ? URL.createObjectURL(file) : undefined;
  if (audioUrl) audio.src = audioUrl;
  audio.load();
  audioSection.hidden = !file;
}

function showScore(tex) {
  const parser = new importer.AlphaTexImporter();
  parser.initFromString(tex, new Settings());
  const nextScore = parser.readScore();
  if (!nextScore.tracks.length) throw new Error('曲谱没有可显示的音轨。');

  empty.hidden = true;
  scoreElement.hidden = false;
  if (!api) {
    api = new AlphaTabApi(scoreElement, {
      core: {
        useWorkers: false,
        smuflFontSources: new Map([[FontFileFormat.Woff2, bravura]]),
      },
      display: { staveProfile: StaveProfile.Tab },
    });
    api.error.on(() => reportError('六线谱渲染失败，请重新生成。'));
  }
  score = nextScore;
  tracks.replaceChildren(...score.tracks.map((track, index) =>
    new Option(track.name || `音轨 ${index + 1}`, String(index))));
  tracks.selectedIndex = 0;
  tracks.disabled = score.tracks.length < 2;
  tracks.parentElement.hidden = false;
  api.renderScore(score, [0]);
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('无法连接本地识别服务，请确认服务已启动。');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new Error(errors[body?.error?.code] ?? '本地识别服务暂时不可用，请重试。');
  }
  return body;
}

async function generateScore(file) {
  updateStatus('正在上传 MP3');
  const body = new FormData();
  body.append('audio', file);
  const { uploadId } = await request('/api/audio/upload', { method: 'POST', body });
  const { taskId } = await request('/api/audio/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  for (;;) {
    const { status: state, progress: current, result, error } = await request('/api/tasks/' + encodeURIComponent(taskId));
    if (state === 'completed') return result;
    if (state === 'failed') throw new Error(errors[error?.code] ?? '识别失败，请重试。');
    updateStatus(state === 'queued' ? '等待空闲识别进程' : (stages[current?.stage] ?? '正在识别'), current?.fraction);
    await new Promise(resolve => setTimeout(resolve, 600));
  }
}

input.addEventListener('change', () => selectFile(input.files[0]));
drop.addEventListener('dragover', event => {
  event.preventDefault();
  if (!busy) drop.classList.add('dragging');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', event => {
  event.preventDefault();
  drop.classList.remove('dragging');
  selectFile(event.dataTransfer.files[0]);
});

tracks.addEventListener('change', () => api.renderTracks([score.tracks[Number(tracks.value)]]));
demo.addEventListener('click', () => {
  try {
    showScore(sample);
    showAudio();
    updateStatus('');
  } catch {
    reportError('示例曲谱加载失败，请刷新后重试。');
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedFile || busy) return;
  const file = selectedFile;
  busy = input.disabled = generate.disabled = demo.disabled = true;
  try {
    const result = await generateScore(file);
    showScore(result.alphaTex);
    showAudio(file);
    updateStatus(result.notes.length ? `识别完成 · ${result.notes.length} 个音符` : '识别完成，未检测到吉他音符。');
  } catch (error) {
    reportError(error.message);
  } finally {
    busy = input.disabled = generate.disabled = demo.disabled = false;
  }
});
