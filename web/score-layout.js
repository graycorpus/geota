import { model } from '@coderline/alphatab';

export function applyGuitarLayout(score, settings) {
  score.stylesheet.globalDisplayChordDiagramsOnTop = false;
  score.stylesheet.globalDisplayChordDiagramsInScore = true;

  for (const track of score.tracks) {
    const guitar = track.staves[0];
    if (!guitar?.isStringed) continue;
    guitar.showStandardNotation = false;
    guitar.showTablature = true;

    // A separate staff places the simplified line below TAB while alphaTab aligns the beats.
    const numbered = new model.Staff();
    numbered.showStandardNotation = false;
    numbered.showTablature = false;
    numbered.showNumbered = true;
    track.addStaff(numbered);

    let previousNote;
    for (const guitarBar of guitar.bars) {
      const bar = new model.Bar();
      const voice = new model.Voice();
      numbered.addBar(bar);
      bar.addVoice(voice);

      for (const source of guitarBar.voices[0].beats) {
        const beat = new model.Beat();
        beat.duration = source.duration;
        beat.dots = source.dots;
        beat.tupletNumerator = source.tupletNumerator;
        beat.tupletDenominator = source.tupletDenominator;
        beat.isEmpty = source.isEmpty;
        voice.addBeat(beat);

        // The upper sounding pitch is a guide to following the guitar part.
        const lead = source.notes.reduce((highest, note) =>
          !note.isDead && (!highest || note.realValue > highest.realValue) ? note : highest, undefined);
        if (lead) {
          const note = new model.Note();
          note.octave = Math.floor(lead.realValue / 12);
          note.tone = lead.realValue % 12;
          note.isTieDestination = Boolean(previousNote && lead.tieOrigin === previousNote);
          beat.addNote(note);
        }
        previousNote = lead;
      }
    }
    numbered.finish(settings, new Map());
  }
}
