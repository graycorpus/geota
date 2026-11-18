import { guitarTracks } from './guitar-tracks.js';
import samplesUrl from './assets/guitar-samples.wav?url';

export function createGuitarPlayer(original) {
  const panel = document.getElementById('guitar-player');
  const play = document.getElementById('guitar-play');
  const seek = document.getElementById('guitar-seek');
  const positionLabel = document.getElementById('guitar-position');
  const status = document.getElementById('guitar-status');
  const channels = Object.fromEntries(['melody', 'backing'].map(name => [name, {
    enabled: document.getElementById(name + '-enabled'),
    volume: document.getElementById(name + '-volume'),
  }]));
  let context;
  let samples;
  let sampleRequest;
  let cached;
  let duration = 0;
  let position = 0;
  let startedAt = 0;
  let timer;
  let playing = false;
  let sequence = 0;
  let nextNote = 0;
  const active = new Set();

  function positionText(time) {
    const whole = Math.floor(time);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  function updatePosition(time) {
    seek.value = String(time);
    positionLabel.textContent = positionText(time) + ' / ' + positionText(duration);
  }

  function stop() {
    sequence++;
    if (playing) position = Math.min(duration, Math.max(0, context.currentTime - startedAt));
    playing = false;
    clearInterval(timer);
    for (const source of active) {
      source.disconnect();
      source.stop();
    }
    active.clear();
    play.textContent = '播放吉他谱';
    updatePosition(position);
  }

  function updateGain(channel) {
    if (!channel.gain) return;
    const value = channel.enabled.checked ? Number(channel.volume.value) / 100 : 0;
    channel.gain.gain.setTargetAtTime(value, context.currentTime, 0.008);
  }

  function prepareAudio() {
    context = new AudioContext();
    const mixer = context.createDynamicsCompressor();
    mixer.connect(context.destination);
    for (const channel of Object.values(channels)) {
      channel.gain = context.createGain();
      channel.gain.gain.value = 0;
      channel.gain.connect(mixer);
      updateGain(channel);
    }
  }

  async function loadSamples() {
    if (samples) return;
    sampleRequest ??= (async () => {
      const response = await fetch(samplesUrl);
      if (!response.ok) throw new Error('Missing guitar samples');
      const bank = await context.decodeAudioData(await response.arrayBuffer());
      const frameCount = bank.sampleRate * 2;
      const data = bank.getChannelData(0);
      samples = Array.from({ length: 13 }, (_, index) => {
        const sample = context.createBuffer(1, frameCount, bank.sampleRate);
        sample.copyToChannel(data.subarray(index * frameCount, (index + 1) * frameCount), 0);
        return sample;
      });
    })().finally(() => { sampleRequest = undefined; });
    await sampleRequest;
  }

  function pluck(note) {
    const at = Math.max(context.currentTime, startedAt + note.start);
    const length = Math.min(4, note.duration);
    const index = Math.max(0, Math.min(samples.length - 1, Math.round((note.pitch - 40) / 4)));
    const rate = 2 ** ((note.pitch - (40 + index * 4)) / 12);
    const source = context.createBufferSource();
    source.buffer = samples[index];
    source.playbackRate.value = rate;
    source.detune.setValueAtTime(note.pitchChanges[0]?.offset === 0 ? note.pitchChanges[0].cents : 0, at);
    for (const point of note.pitchChanges) {
      if (point.offset > 0 && point.offset < length) source.detune.linearRampToValueAtTime(point.cents, at + point.offset);
    }
    const gain = context.createGain();
    const level = 0.08 + Math.min(1, Math.max(0, note.velocity)) * 0.62;
    gain.gain.setValueAtTime(level, at);
    gain.gain.setValueAtTime(level, at + length);
    gain.gain.linearRampToValueAtTime(0, at + length + 0.04);
    source.connect(gain).connect(channels[note.track].gain);
    source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); };
    active.add(source);
    source.start(at);
    source.stop(at + length + 0.05);
  }

  function tick() {
    const time = Math.max(0, context.currentTime - startedAt);
    if (time >= duration + 0.1) {
      stop();
      position = 0;
      updatePosition(0);
      return;
    }
    const notes = cached.events;
    while (nextNote < notes.length && notes[nextNote].start <= time + 0.12) {
      const note = notes[nextNote++];
      if (note.start >= time - 0.12) pluck(note);
    }
    updatePosition(Math.min(duration, time));
  }

  async function start() {
    const attempt = ++sequence;
    try {
      status.textContent = '';
      if (!cached.events.length) {
        status.textContent = '这条谱轨没有可播放的音符。';
        return;
      }
      if (!context) prepareAudio();
      original.pause();
      await Promise.all([context.resume(), loadSamples()]);
      if (attempt !== sequence) return;
      if (position >= duration) position = 0;
      nextNote = cached.events.findIndex(note => note.start >= position - 0.001);
      if (nextNote < 0) nextNote = cached.events.length;
      startedAt = context.currentTime + 0.02 - position;
      playing = true;
      play.textContent = '暂停吉他谱';
      tick();
      timer = setInterval(tick, 30);
    } catch {
      if (attempt !== sequence) return;
      stop();
      status.textContent = '无法播放吉他谱，请重试。';
    }
  }

  for (const channel of Object.values(channels)) {
    channel.enabled.addEventListener('change', () => updateGain(channel));
    channel.volume.addEventListener('input', () => updateGain(channel));
  }
  original.addEventListener('play', stop);
  play.addEventListener('click', () => { if (playing) stop(); else void start(); });
  seek.addEventListener('change', () => {
    const target = Number(seek.value);
    const resume = playing;
    stop();
    position = target;
    updatePosition(position);
    if (resume) void start();
  });

  return {
    load(score, track, repeat) {
      stop();
      cached = guitarTracks(score, track, repeat);
      duration = cached.duration;
      position = 0;
      seek.max = String(duration);
      play.disabled = seek.disabled = !cached.events.length;
      panel.hidden = false;
      const hasMelody = cached.events.some(note => note.track === 'melody');
      const hasBacking = cached.events.some(note => note.track === 'backing');
      channels.melody.enabled.disabled = channels.melody.volume.disabled = !hasMelody;
      channels.backing.enabled.disabled = channels.backing.volume.disabled = !hasBacking;
      status.textContent = !cached.events.length ? '这条谱轨没有可播放的音符。'
        : !hasBacking ? '这条谱轨只有旋律，没有独立伴奏音符。'
        : !hasMelody ? '这条谱轨未识别到独立旋律。' : '';
      updatePosition(0);
    },
  };
}
