import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importer, Settings } from '@coderline/alphatab';
import { guitarTracks } from '../web/guitar-tracks.js';

test('score playback splits guitar notes and follows the written tempo changes', () => {
  const parser = new importer.AlphaTexImporter();
  parser.initFromString(String.raw`\tempo 120 . \track "Guitar" \staff {tabs}
\tuning E4 B3 G3 D3 A2 E2
:4 (0.1 0.6) (1.1 0.6) (3.1 0.6) (1.1 0.6) |
\tempo 60 :4 (0.1 0.6) (1.1 0.6) (3.1 0.6) (1.1 0.6) |`, new Settings());
  const { events, duration } = guitarTracks(parser.readScore(), 0);
  assert.equal(duration, 6);
  assert.equal(events.length, 16);
  assert(events.some(note => note.start === 0.5 && note.pitch >= 64 && note.track === 'melody'));
  assert(events.some(note => note.start === 3 && note.pitch === 40 && note.track === 'backing'));
});

test('guitar playback applies marked repeats and preserves pitch changes', () => {
  const parser = new importer.AlphaTexImporter();
  parser.initFromString(String.raw`\tempo 120 . \track "Guitar" \staff {tabs}
\tuning E4 B3 G3 D3 A2 E2
:4 5.1{b (0 4)} 3.1 2.1 0.1 | :4 1.1 2.1 3.1 4.1 |`, new Settings());
  const score = parser.readScore();
  const plain = guitarTracks(score, 0);
  const repeated = guitarTracks(score, 0, { startBar: 1, endBar: 1, plays: 2 });
  assert.equal(plain.duration, 4);
  assert.equal(repeated.duration, 6);
  assert.equal(repeated.events[0].pitch, 69);
  assert.equal(repeated.events[4].pitch, 69);
  assert.equal(repeated.events[4].start, 2);
  assert(repeated.events[0].pitchChanges.some(point => point.cents > 100));
  assert.equal(score.masterBars[0].repeatCount, 0);
});
