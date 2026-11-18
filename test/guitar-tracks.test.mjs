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
