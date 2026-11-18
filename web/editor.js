import { model } from '@coderline/alphatab';
import { editNote, getBeat } from './score-edit.js';

const { scoreToJsObject, jsObjectToScore } = model.JsonConverter;
const options = (select, entries, value) => {
  select.replaceChildren(...entries.map(([index, label]) => new Option(label, String(index))));
  if ([...select.options].some(option => option.value === String(value))) select.value = String(value);
};
const enumerate = list => list.map((_, index) => [index, String(index + 1)]);

export function createEditor(render) {
  const el = id => document.getElementById(id);
  const panel = el('score-editor');
  const toggle = el('edit-score');
  const bar = el('edit-bar');
  const voice = el('edit-voice');
  const beat = el('edit-beat');
  const source = el('edit-note');
  const string = el('edit-string');
  const fret = el('edit-fret');
  const apply = el('edit-apply');
  const remove = el('edit-delete');
  const undo = el('edit-undo');
  const redo = el('edit-redo');
  const message = el('edit-message');
  let history = [];
  let index = 0;
  let track = 0;
  let score;
  const location = () => ({
    track, bar: Number(bar.value), voice: Number(voice.value), beat: Number(beat.value), string: Number(source.value),
  });
  const current = () => getBeat(score, location());
  const currentStaff = () => score.tracks[track].staves[0];
  const conventionalString = internal => currentStaff().tuning.length + 1 - internal;

  function setTargets() {
    const note = current()?.notes.find(item => item.string === Number(source.value));
    if (note) {
      string.value = String(note.string);
      fret.value = String(note.fret);
    }
    apply.textContent = note ? '应用修改' : '添加音符';
    remove.disabled = !note;
  }

  function refresh(preferred = {}) {
    const previous = { ...location(), ...preferred };
    const staff = currentStaff();
    options(bar, enumerate(staff.bars), previous.bar);
    const barModel = staff.bars[Number(bar.value)];
    options(voice, enumerate(barModel?.voices ?? []), previous.voice);
    options(beat, enumerate(barModel?.voices[Number(voice.value)]?.beats ?? []), previous.beat);
    const notes = (current()?.notes ?? []).filter(note => note.isStringed);
    options(source, [...notes.map(note => [
      note.string, `第 ${conventionalString(note.string)} 弦 · ${note.fret} 品`,
    ]), [0, '＋ 添加新音符']], preferred.string ?? notes[0]?.string ?? 0);
    options(string, staff.tuning.map((_, i) => [staff.tuning.length - i, `第 ${i + 1} 弦`]), string.value);
    fret.max = String(22 - staff.capo);
    undo.disabled = index === 0;
    redo.disabled = index + 1 === history.length;
    apply.disabled = !current();
    setTargets();
  }

  function activate(snapshot) {
    score = jsObjectToScore(snapshot);
    render(jsObjectToScore(snapshot), track);
  }

  function change(action) {
    try {
      if (action !== 'delete' && fret.value === '') throw new Error('请输入品位。');
      const loc = location();
      const target = { string: Number(string.value), fret: Number(fret.value) };
      const draft = jsObjectToScore(history[index]);
      editNote(draft, loc, action, target);
      const snapshot = scoreToJsObject(draft);
      activate(snapshot);
      history.splice(index + 1, Infinity, snapshot);
      if (history.length > 21) history.shift();
      index = history.length - 1;
      refresh({ ...loc, string: action === 'delete' ? undefined : target.string });
      message.textContent = '修改已应用';
    } catch (error) {
      message.textContent = error.message;
    }
  }

  for (const field of [bar, voice, beat]) field.addEventListener('change', () => {
    message.textContent = '';
    refresh(field === bar ? { voice: 0, beat: 0 } : field === voice ? { beat: 0 } : {});
  });
  source.addEventListener('change', setTargets);
  apply.addEventListener('click', () => change(Number(source.value) ? 'change' : 'add'));
  remove.addEventListener('click', () => change('delete'));
  const travel = delta => {
    const next = index + delta;
    activate(history[next]);
    index = next;
    refresh();
    message.textContent = delta < 0 ? '已撤销' : '已重做';
  };
  undo.addEventListener('click', () => travel(-1));
  redo.addEventListener('click', () => travel(1));
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) refresh();
  });

  return {
    currentScore() { return score; },
    load(rawScore) {
      history = [scoreToJsObject(rawScore)];
      score = jsObjectToScore(history[0]);
      index = track = 0;
      panel.hidden = true;
      toggle.hidden = false;
      toggle.setAttribute('aria-expanded', 'false');
      message.textContent = '';
    },
    setTrack(value) {
      track = value;
      if (!panel.hidden) refresh({ bar: 0, voice: 0, beat: 0 });
    },
    select(modelBeat, note) {
      if (panel.hidden || modelBeat.voice.bar.staff.index !== 0) return;
      const v = modelBeat.voice;
      refresh({ bar: v.bar.index, voice: v.index, beat: modelBeat.index, string: note?.string });
    },
  };
}
