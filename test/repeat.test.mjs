import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRepeatPlayback, validRepeat } from '../web/repeat.js';

test('finite repeat returns to the beginning once on two plays, then continues', () => {
  const player = createRepeatPlayback();
  const section = { start: 5, end: 10, plays: 2 };
  player.advance(9.5, section);
  assert.equal(player.advance(10, section), 5);
  player.seek(5, true);
  assert.equal(player.advance(10, section), undefined);
  player.seek(5);
  assert.equal(player.advance(10, section), 5);
});

test('seeking beyond the ending does not trigger a repeat', () => {
  const player = createRepeatPlayback();
  const section = { start: 5, end: 10, plays: 2 };
  player.advance(9, section);
  player.seek(11);
  assert.equal(player.advance(11.1, section), undefined);
  assert.equal(validRepeat({ startBar: 1, endBar: 1, plays: 2 }, 3), true);
  assert.equal(validRepeat({ startBar: 2, endBar: 1, plays: 2 }, 3), false);
});
