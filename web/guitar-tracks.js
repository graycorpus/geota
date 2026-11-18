import { midi } from '@coderline/alphatab';
import { melodyNotes } from '../src/renderer/src/lib/music/parts.ts';

export function guitarTracks(score, trackIndex) {
  const notes = [];
  const tempos = new Map([[0, score.tempo]]);
  let lastTick = 0;
  const noop = () => {};
  const handler = {
    addNote(track, tick, length, pitch, velocity) {
      if (track === trackIndex && length > 0) notes.push({ tick, length, pitch, velocity: velocity / 127 });
    },
    addTempo(tick, bpm) { tempos.set(tick, bpm); },
    finishTrack(_, tick) { lastTick = Math.max(lastTick, tick); },
    addTickShift: noop,
    addTimeSignature: noop,
    addRest: noop,
    addControlChange: noop,
    addProgramChange: noop,
    addBend: noop,
    addNoteBend: noop,
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

  const events = notes.sort((a, b) => a.tick - b.tick).map(({ tick, length, pitch, velocity }) => ({
    start: toSeconds(tick),
    duration: toSeconds(tick + length) - toSeconds(tick),
    pitch,
    velocity,
  }));
  const parts = melodyNotes(events);
  return {
    events: events.map((event, index) => ({ ...event, track: parts[index] ? 'melody' : 'backing' })),
    duration: toSeconds(lastTick),
  };
}
