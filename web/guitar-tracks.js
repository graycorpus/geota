import { midi, model } from '@coderline/alphatab';
import { melodyNotes } from '../src/renderer/src/lib/music/parts.ts';

export function guitarTracks(score, trackIndex, repeat) {
  if (repeat) {
    const { scoreToJsObject, jsObjectToScore } = model.JsonConverter;
    score = jsObjectToScore(scoreToJsObject(score));
    score.masterBars[repeat.startBar - 1].isRepeatStart = true;
    score.masterBars[repeat.endBar - 1].repeatCount = repeat.plays;
    score.rebuildRepeatGroups();
  }
  const notes = [];
  const bends = new Map();
  const tempos = new Map([[0, score.tempo]]);
  let lastTick = 0;
  const noop = () => {};
  const handler = {
    addNote(track, tick, length, pitch, velocity, channel) {
      if (track === trackIndex && length > 0) notes.push({ tick, length, pitch, channel, velocity: velocity / 127 });
    },
    addTempo(tick, bpm) { tempos.set(tick, bpm); },
    finishTrack(_, tick) { lastTick = Math.max(lastTick, tick); },
    addTickShift: noop,
    addTimeSignature: noop,
    addRest: noop,
    addControlChange: noop,
    addProgramChange: noop,
    addBend: noop,
    addNoteBend(track, tick, channel, pitch, value) {
      if (track !== trackIndex) return;
      const key = channel * 128 + pitch;
      if (!bends.has(key)) bends.set(key, []);
      bends.get(key).push({ tick, value });
    },
  };
  new midi.MidiFileGenerator(score, null, handler).generate();

  const division = new midi.MidiFile().division;
  const changes = [...tempos.entries()].sort(([first], [second]) => first - second);
  let seconds = 0;
  const timeline = changes.map(([tick, bpm], index) => {
    if (index) {
      const [previous, previousBpm] = changes[index - 1];
      seconds += (tick - previous) * 60 / (division * previousBpm);
    }
    return { tick, seconds, secondsPerTick: 60 / (division * bpm) };
  });

  function toSeconds(tick) {
    let low = 0;
    let high = timeline.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (timeline[middle].tick <= tick) low = middle;
      else high = middle;
    }
    const mark = timeline[low];
    return mark.seconds + (tick - mark.tick) * mark.secondsPerTick;
  }

  for (const points of bends.values()) points.sort((a, b) => a.tick - b.tick);
  const events = notes.sort((a, b) => a.tick - b.tick).map(({ tick, length, pitch, velocity, channel }) => {
    const start = toSeconds(tick);
    const points = bends.get(channel * 128 + pitch) ?? [];
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (points[middle].tick < tick) low = middle + 1;
      else high = middle;
    }
    const pitchChanges = [];
    let lastValue;
    for (let i = low; i < points.length && points[i].tick < tick + length; i++) {
      const point = points[i];
      if (point.value === lastValue) continue;
      // alphaTab encodes per-note bends on a 14-bit wheel with a ±16-semitone range.
      const cents = (point.value - 8192) * 1600 / 8192;
      pitchChanges.push({ offset: toSeconds(point.tick) - start, cents });
      lastValue = point.value;
    }
    return { start, duration: toSeconds(tick + length) - start, pitch, velocity, pitchChanges };
  });
  const parts = melodyNotes(events);
  return {
    events: events.map((event, index) => ({ ...event, track: parts[index] ? 'melody' : 'backing' })),
    duration: toSeconds(lastTick),
  };
}
