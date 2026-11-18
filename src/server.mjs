import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'tabello-api-'));
const retentionMs = 30 * 60 * 1000;
const maxRecords = 16;
const uploads = new Map();
const tasks = new Map();
const queue = [];
let receiving = 0;
let active;
let stopping = false;
const shutdown = new AbortController();

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}

function removeAudio(file) {
  return rm(file, { force: true }).catch(error => console.error('Audio cleanup failed:', error.code));
}

const upload = multer({
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: directory,
    filename: (_req, _file, done) => done(null, randomUUID() + '.mp3'),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
  fileFilter: (_req, file, done) => {
    if (path.extname(file.originalname).toLowerCase() !== '.mp3') {
      return done(new RequestError(415, 'unsupported-format', 'Choose an MP3 file.'));
    }
    done(null, true);
  },
}).single('audio');

function runAnalysis(input, task) {
  return new Promise(resolve => {
    const worker = execFile(process.execPath, [
      'node_modules/vite-node/dist/cli.mjs', '--script', 'src/cli.ts', input.path,
    ], {
      cwd: root,
      env: { ...process.env, TABELLO_AUDIO_TITLE: input.title },
      timeout: 5 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      signal: shutdown.signal,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        task.status = 'failed';
        task.error = error.killed && error.signal === 'SIGTERM' && !error.code && !stopping
          ? { code: 'timeout', message: 'Audio analysis timed out.' }
          : failure ?? { code: 'failed', message: 'The analysis process failed.' };
      } else {
        try {
          task.result = JSON.parse(stdout);
          task.status = 'completed';
        } catch {
          task.status = 'failed';
          task.error = { code: 'failed', message: 'The analysis process returned an invalid result.' };
        }
      }
      resolve();
    });

    let failure;
    let pending = '';
    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', chunk => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'progress') task.progress = { stage: event.stage, fraction: event.fraction };
        if (event.type === 'error') {
          const messages = {
            'no-audio': 'The file contains no audio.',
            'too-long': 'The MP3 exceeds the 15-minute duration limit.',
            failed: 'Could not decode or analyze the MP3. Check the file and FFmpeg installation.',
          };
          failure = { code: event.code, message: messages[event.code] ?? 'Audio analysis failed.' };
        }
      }
    });
  });
}

function drainQueue() {
  if (active || stopping || queue.length === 0) return;
  const { input, task } = queue.shift();
  task.status = 'running';
  task.progress = { stage: 'starting', fraction: 0 };
  active = runAnalysis(input, task).finally(async () => {
    task.expiresAt = Date.now() + retentionMs;
    await removeAudio(input.path);
    active = undefined;
    drainQueue();
  });
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, input] of uploads) {
    if (input.expiresAt <= now) {
      uploads.delete(id);
      void removeAudio(input.path);
    }
  }
  for (const [id, task] of tasks) {
    if (task.expiresAt <= now) tasks.delete(id);
  }
}, 30_000).unref();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

app.post('/api/audio/upload', (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    return next(new RequestError(415, 'invalid-content-type', 'Send a multipart form containing an audio file.'));
  }
  if (uploads.size + receiving >= maxRecords) {
    return next(new RequestError(429, 'busy', 'The upload limit has been reached.'));
  }
  receiving++;
  upload(req, res, error => {
    receiving--;
    if (error) return next(error);
    if (!req.file || req.file.size === 0) {
      if (req.file) void removeAudio(req.file.path);
      return next(new RequestError(400, 'missing-audio', 'Attach an MP3 using the audio field.'));
    }

    const id = path.parse(req.file.filename).name;
    const title = path.parse(req.file.originalname).name;
    uploads.set(id, { path: req.file.path, title, expiresAt: Date.now() + retentionMs });
    res.status(201).json({ uploadId: id });
  });
});

app.post('/api/audio/analyze', (req, res, next) => {
  const { uploadId } = req.body ?? {};
  if (typeof uploadId !== 'string' || !uploadId) {
    return next(new RequestError(400, 'invalid-upload-id', 'Provide an uploadId.'));
  }
  const input = uploads.get(uploadId);
  if (!input || input.expiresAt <= Date.now()) {
    return next(new RequestError(404, 'upload-not-found', 'The upload has expired, been submitted, or does not exist.'));
  }
  if (tasks.size >= maxRecords) {
    return next(new RequestError(429, 'busy', 'The task limit has been reached.'));
  }

  const id = randomUUID();
  const task = { id, status: 'queued' };
  uploads.delete(uploadId);
  tasks.set(id, task);
  queue.push({ input, task });
  res.status(202).location('/api/tasks/' + id).json({ taskId: id, status: task.status });
  drainQueue();
});

app.get('/api/tasks/:id', (req, res, next) => {
  const task = tasks.get(req.params.id);
  if (!task || task.expiresAt <= Date.now()) {
    return next(new RequestError(404, 'task-not-found', 'The task does not exist or has expired.'));
  }
  const { expiresAt, ...response } = task;
  res.set('Cache-Control', 'no-store').json(response);
});

app.use(express.static(path.join(root, 'web', 'dist')));

app.use((_req, _res, next) => next(new RequestError(404, 'not-found', 'Endpoint not found.')));
app.use((error, _req, res, _next) => {
  if (error instanceof RequestError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { code: 'file-too-large', message: 'The upload limit is 25 MiB.' } });
    }
    return res.status(400).json({ error: { code: 'invalid-upload', message: 'Send one MP3 in the audio field.' } });
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large' || error.message === 'Unexpected end of form' || error.message === 'Multipart: Boundary not found') {
    return res.status(error.status === 413 ? 413 : 400).json({ error: { code: 'invalid-request', message: 'The request body could not be read.' } });
  }
  console.error('Request failed:', error.code ?? error.name);
  res.status(500).json({ error: { code: 'failed', message: 'The server could not complete the request.' } });
});

const server = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('TaBello API listening on http://127.0.0.1:' + server.address().port);
});

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  shutdown.abort();
  await Promise.all([active, new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  })]);
  await rm(directory, { recursive: true, force: true });
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.once('error', async error => {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
});
