import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { importer, Settings } from '@coderline/alphatab';

test('local HTTP API uploads, queues, transcribes, and reports errors', { timeout: 60_000 }, async t => {
  const server = spawn(process.execPath, ['src/server.mjs'], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(server, 'exit');
  t.after(async () => {
    server.kill();
    await exited;
  });

  const lines = createInterface({ input: server.stdout });
  const address = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(10_000) }).then(([line]) => line.split(' ').at(-1)),
    exited.then(([code]) => { throw new Error('API exited before starting: ' + code); }),
  ]);

  function upload(name, content) {
    const body = new FormData();
    body.append('audio', new Blob([content], { type: 'audio/mpeg' }), name);
    return fetch(address + '/api/audio/upload', { method: 'POST', body });
  }

  function submit(uploadId) {
    return fetch(address + '/api/audio/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
  }

  async function waitForTask(id) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const response = await fetch(address + '/api/tasks/' + id);
      assert.equal(response.status, 200);
      const task = await response.json();
      if (task.status === 'completed' || task.status === 'failed') return task;
      await delay(100);
    }
    assert.fail('Analysis did not reach a terminal state.');
  }

  const audio = execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=329.63:duration=2', '-f', 'mp3', 'pipe:1',
  ]);
  assert.equal((await upload('recording.wav', audio)).status, 415);
  assert.equal((await upload('empty.mp3', '')).status, 400);
  assert.equal((await submit('missing')).status, 404);
  assert.equal((await fetch(address + '/api/tasks/missing')).status, 404);

  const uploaded = await upload('吉他 E4.MP3', audio);
  assert.equal(uploaded.status, 201);
  const { uploadId } = await uploaded.json();
  const accepted = await submit(uploadId);
  assert.equal(accepted.status, 202);
  const { taskId, status } = await accepted.json();
  assert.equal(status, 'queued');
  assert.equal(accepted.headers.get('location'), '/api/tasks/' + taskId);
  assert.equal((await submit(uploadId)).status, 404);

  const corrupt = await upload('broken.mp3', 'not audio');
  assert.equal(corrupt.status, 201);
  const corruptAccepted = await submit((await corrupt.json()).uploadId);
  assert.equal(corruptAccepted.status, 202);
  const corruptId = (await corruptAccepted.json()).taskId;

  const completed = await waitForTask(taskId);
  assert.equal(completed.status, 'completed', JSON.stringify(completed.error));
  assert.deepEqual(completed.progress, { stage: 'arranging', fraction: 1 });
  assert(completed.result.notes.some(note => note.pitch === 64));
  const parser = new importer.AlphaTexImporter();
  parser.initFromString(completed.result.alphaTex, new Settings());
  assert.equal(parser.readScore().title, '吉他 E4');

  const failed = await waitForTask(corruptId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'failed');
  assert.equal(failed.result, undefined);
});
