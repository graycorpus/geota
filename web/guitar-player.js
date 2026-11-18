import { guitarTracks } from './guitar-tracks.js';

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
  let wave;
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
    for (const oscillator of active) {
      oscillator.disconnect();
      oscillator.stop();
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
    const harmonics = Float32Array.from([0, 1, 0.38, 0.26, 0.17, 0.12, 0.09, 0.06]);
    wave = context.createPeriodicWave(new Float32Array(harmonics.length), harmonics);
    const mixer = context.createDynamicsCompressor();
    mixer.connect(context.destination);
    for (const channel of Object.values(channels)) {
      channel.gain = context.createGain();
      channel.gain.gain.value = 0;
      channel.gain.connect(mixer);
      updateGain(channel);
    }
  }

  function pluck(note) {
    const at = Math.max(context.currentTime, startedAt + note.start);
    const length = Math.min(4, note.duration);
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.setPeriodicWave(wave);
    oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
    const level = (0.035 + Math.min(1, Math.max(0, note.velocity)) * 0.07);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.08);
    oscillator.connect(gain).connect(channels[note.track].gain);
    oscillator.onended = () => { active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    active.add(oscillator);
    oscillator.start(at);
    oscillator.stop(at + length + 0.09);
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
      await context.resume();
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
    load(score, track) {
      stop();
      cached = guitarTracks(score, track);
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
