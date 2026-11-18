import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importer, Settings } from '@coderline/alphatab';
import { openProject, saveProject } from '../web/project.js';

const parser = new importer.AlphaTexImporter();
parser.initFromString(String.raw`\title "本地练习" . \staff {tabs} \tuning E4 B3 G3 D3 A2 E2 :1 7.1 |`, new Settings());
const score = parser.readScore();

test('a project preserves editable score data, original audio and bar timing', async () => {
  const original = new File([new Uint8Array([0, 23, 255])], '练习.mp3', { type: 'audio/mpeg' });
  const timing = { startTime: 0.5, barTimes: [0.5, 2.5] };
  const restored = await openProject(saveProject(score, original, timing));
  assert.equal(restored.score.title, '本地练习');
  assert.equal(restored.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret, 7);
  assert.equal(restored.audio.name, original.name);
  assert.deepEqual(await restored.audio.bytes(), await original.bytes());
  assert.deepEqual(restored.timing, timing);
});

test('score-only projects reopen and invalid files are rejected', async () => {
  const restored = await openProject(saveProject(score));
  assert.equal(restored.audio, undefined);
  await assert.rejects(openProject(new Blob(['invalid'])), /无法打开此项目/);
});
