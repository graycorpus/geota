import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importer, model, Settings } from '@coderline/alphatab';
import { editNote, getBeat } from '../web/score-edit.js';

const first = { track: 0, bar: 0, voice: 0, beat: 0, string: 6 };
const second = { ...first, beat: 1 };
function tiedScore() {
  const parser = new importer.AlphaTexImporter();
  parser.initFromString(String.raw`\staff {tabs} \tuning E4 B3 G3 D3 A2 E2
    :4 3.1 (-.1 2.2) r r |`, new Settings());
  return parser.readScore();
}

test('moves a tied note as a unit and preserves beat timing', () => {
  const score = tiedScore();
  assert.equal(getBeat(score, second).notes[0].tieOrigin, getBeat(score, first).notes[0]);
  const durations = score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.playbackDuration);
  editNote(score, second, 'change', { string: 4, fret: 2 });

  const updated = model.JsonConverter.jsObjectToScore(model.JsonConverter.scoreToJsObject(score));
  const note = getBeat(updated, second).notes.find(note => note.string === 4);
  assert.equal(note.fret, 2);
  assert.equal(note.tieOrigin, getBeat(updated, first).notes[0]);
  assert.deepEqual(updated.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.playbackDuration), durations);
});

test('checks the full chain for collisions and deletes it without leaving a dangling tie', () => {
  const score = tiedScore();
  assert.throws(() => editNote(score, first, 'change', { string: 5, fret: 4 }), /目标弦已有音符/);
  assert.equal(getBeat(score, first).notes[0].string, 6);
  assert.throws(() => editNote(score, second, 'add', { string: 5, fret: 3 }), /目标弦已有音符/);
  editNote(score, second, 'delete');
  const updated = model.JsonConverter.jsObjectToScore(model.JsonConverter.scoreToJsObject(score));
  assert.equal(getBeat(updated, first).notes.length, 0);
  assert.deepEqual(getBeat(updated, second).notes.map(note => note.string), [5]);
});
