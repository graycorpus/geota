import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { importer, Settings } from '@coderline/alphatab';

const directory = mkdtempSync(path.join(tmpdir(), 'tabello-local-'));
after(() => rmSync(directory, { recursive: true, force: true }));

function analyze(input) {
  return spawnSync(process.execPath, ['node_modules/vite-node/dist/cli.mjs', '--script', 'src/cli.ts', input], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}

test('transcribes an MP3 and returns a score alphaTab can parse', () => {
  const input = path.join(directory, 'E4 recording.MP3');
  execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=329.63:duration=2', '-f', 'mp3', input,
  ]);

  const result = analyze(input);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const { notes, durationSeconds, alphaTex, startTime, barTimes, droppedNotes } = JSON.parse(result.stdout);
  assert(notes.some(note => note.pitch === 64 && note.duration > 0));
  assert(Math.abs(durationSeconds - 2) < 0.1);
  assert.equal(barTimes[0], startTime);
  assert(barTimes.at(-1) > startTime);
  assert.equal(droppedNotes, 0);

  const scoreImporter = new importer.AlphaTexImporter();
  scoreImporter.initFromString(alphaTex, new Settings());
  const score = scoreImporter.readScore();
  assert.equal(score.tracks.length, 1);
  assert.equal(score.tracks[0].staves[0].stringTuning.tunings.length, 6);

  const progress = result.stderr.trim().split('\n').map(line => JSON.parse(line));
  for (const stage of ['extracting', 'transcribing', 'arranging']) {
    assert(progress.some(event => event.type === 'progress' && event.stage === stage));
  }
  assert.deepEqual(progress.at(-1), { type: 'progress', stage: 'arranging', fraction: 1 });
});

test('returns a structured error for a missing file', () => {
  const result = analyze(path.join(directory, 'missing.mp3'));
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr.trim()).code, 'not-found');
});

test('returns an error for an unreadable MP3', () => {
  const input = path.join(directory, 'broken.mp3');
  writeFileSync(input, 'invalid audio');
  const result = analyze(input);
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr.trim().split('\n').at(-1)).type, 'error');
});
