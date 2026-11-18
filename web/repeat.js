export function validRepeat(repeat, bars) {
  return repeat && Number.isInteger(repeat.startBar) && Number.isInteger(repeat.endBar) &&
    repeat.startBar >= 1 && repeat.startBar <= repeat.endBar && repeat.endBar <= bars &&
    Number.isInteger(repeat.plays) && repeat.plays >= 2 && repeat.plays <= 8;
}

// An original recording is linear. Repeat a finite span on its own timeline.
export function createRepeatPlayback() {
  let range;
  let previous = 0;
  let remaining = 0;
  return {
    seek(time, automaticReturn = false) {
      previous = time;
      if (range && !automaticReturn && time <= range.start) remaining = range.plays - 1;
    },
    advance(time, current) {
      if (range?.start !== current?.start || range?.end !== current?.end || range?.plays !== current?.plays) {
        range = current;
        remaining = current ? current.plays - 1 : 0;
      }
      if (range && remaining > 0 && previous >= range.start - 0.02 && previous < range.end && time >= range.end) {
        remaining--;
        previous = range.start;
        return range.start;
      }
      previous = time;
    },
  };
}
