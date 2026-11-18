import { model } from '@coderline/alphatab';

export function getBeat(score, { track, bar, voice, beat }) {
  return score.tracks[track]?.staves[0]?.bars[bar]?.voices[voice]?.beats[beat];
}

export function editNote(score, location, action, target) {
  const beat = getBeat(score, location);
  const source = beat?.notes.find(note => note.string === location.string);
  if (!beat || (action !== 'add' && !source)) throw new Error('请先选择要修改的音符。');

  if (action !== 'delete') {
    const { tuning, capo } = beat.voice.bar.staff;
    if (!Number.isInteger(target.string) || target.string < 1 || target.string > tuning.length ||
        !Number.isInteger(target.fret) || target.fret < 0 || target.fret > 22 - capo) {
      throw new Error(`请输入 0 到 ${22 - capo} 之间的品位，并选择有效的弦。`);
    }
  }

  // Keep a note and its continuation on the same string and fret across beats.
  let first = source;
  while (first?.tieOrigin) first = first.tieOrigin;
  const chain = [];
  for (let note = first; note; note = note.tieDestination) chain.push(note);
  const destinations = action === 'add' ? [beat] : chain.map(note => note.beat);
  if (action !== 'delete' && destinations.some(destination =>
    destination.notes.some(note => note.string === target.string && (action === 'add' || !chain.includes(note))))) {
    throw new Error('这拍的目标弦已有音符，请选择另一根弦。');
  }

  if (action === 'add') {
    const note = new model.Note();
    note.string = target.string;
    note.fret = target.fret;
    beat.isEmpty = false;
    beat.addNote(note);
  } else {
    for (const note of chain) {
      const destination = note.beat;
      destination.removeNote(note);
      if (action === 'change') {
        note.string = target.string;
        note.fret = target.fret;
        destination.addNote(note);
      }
    }
  }
}
