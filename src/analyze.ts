import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { decodeAudio, detectNotes, PipelineError, SAMPLE_RATE } from './main/transcription/pipeline';
import { arrange, detectCapo, detectTuning } from './renderer/src/lib/music/arrange';
import { toAlphaTex } from './renderer/src/lib/music/export';
import { clickBarPhase, clickGrid, detectTempoChanges } from './renderer/src/lib/music/tempo';
import { detectKey, detectMeter, estimateTempo } from './renderer/src/lib/music/theory';
import { INSTRUMENTS, MAX_CAPO } from './shared/instruments';
import type { ClickTrack, Sensitivity } from './shared/ipc';
import type { MeterId } from './shared/meters';

const require = createRequire(import.meta.url);
const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};

export interface AnalyzeOptions {
  ffmpegPath?: string;
  title?: string;
  sensitivity?: Sensitivity;
  onProgress?: (stage: 'extracting' | 'transcribing' | 'arranging', fraction: number) => void;
}

export async function analyzeMp3(inputPath: string, options: AnalyzeOptions = {}) {
  if (path.extname(inputPath).toLowerCase() !== '.mp3') {
    throw new PipelineError('invalid', 'Choose an MP3 file.');
  }

  const file = await stat(inputPath).catch(() => null);
  if (!file?.isFile()) {
    throw new PipelineError('not-found', 'The input MP3 file was not found.');
  }

  const instrument = INSTRUMENTS.guitar;
  const { onProgress } = options;
  onProgress?.('extracting', 0);
  const audio = await decodeAudio(options.ffmpegPath ?? 'ffmpeg', path.resolve(inputPath), {
    inputFormat: 'mp3',
    onProgress: (fraction) => onProgress?.('extracting', fraction),
  });

  let metronome: ClickTrack | undefined;
  onProgress?.('transcribing', 0);
  const notes = await detectNotes(audio, {
    assets,
    minHz: instrument.minHz,
    maxHz: instrument.maxHz,
    sensitivity: options.sensitivity,
    onProgress: (fraction) => onProgress?.('transcribing', fraction),
    onMetronome: (track) => { metronome = track; },
  });

  onProgress?.('arranging', 0);
  const clicks = metronome ? clickGrid(metronome) : undefined;
  const tempo = clicks ? { bpm: clicks.bpm, offset: clicks.beats[0] } : estimateTempo(notes);
  const steadyMeter = detectMeter(notes, tempo);
  const tempoChanges = !clicks && notes.length ? detectTempoChanges(notes, tempo.bpm) : undefined;
  const beats = clicks?.beats ?? (tempoChanges?.variable ? tempoChanges.beats : undefined);
  const detectedMeter = beats ? detectMeter(notes, tempo, beats) : steadyMeter;
  let { meter, barPhase } = detectedMeter;
  if (clicks && notes.length && (clicks.beatsPerBar === 3 || clicks.beatsPerBar === 4)) {
    const phase = clickBarPhase(clicks, notes[0].start);
    if (phase !== null) {
      const suffix = meter.endsWith('-triplets') ? '-triplets' : '';
      meter = `${clicks.beatsPerBar}/4${suffix}` as MeterId;
      barPhase = phase;
    }
  }

  const timing = { bpm: tempo.bpm, offset: steadyMeter.offset, beats, meter, barPhase };
  const tuning = detectTuning(notes, instrument.tunings, { frets: instrument.frets, ...timing });
  const fingering = { tuning: tuning.strings, frets: instrument.frets, ...timing };
  const capo = detectCapo(notes, fingering, MAX_CAPO);
  const arrangement = arrange(notes, { ...fingering, capo });
  const { startTime, barTimes, droppedNotes } = arrangement;
  const alphaTex = toAlphaTex(arrangement, {
    title: (options.title ?? path.basename(inputPath, path.extname(inputPath))).replace(/[\x00-\x1f]/g, ' '),
    bpm: tempo.bpm,
    key: detectKey(notes),
    instrument,
    tuning: tuning.strings,
    capo,
  });
  onProgress?.('arranging', 1);

  return { notes, durationSeconds: audio.length / SAMPLE_RATE, alphaTex, startTime, barTimes, droppedNotes, metronome };
}
