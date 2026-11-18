import { ScrollMode, synth } from '@coderline/alphatab';
import { createRepeatPlayback } from './repeat.js';

export function connectPlayback(api, audio, startTime, getLoop, getRepeat, onError) {
  let frame = 0;
  let output;
  let returnTarget;
  const repeats = createRepeatPlayback();
  const scoreTime = seconds => Math.max(0, (seconds - startTime) * 1000 / audio.playbackRate);
  const sync = () => {
    if (!audio.paused && !audio.seeking) {
      const loop = getLoop();
      const position = audio.currentTime;
      const repeatStart = repeats.advance(position, loop ? undefined : getRepeat());
      if (loop && (position < loop.start || position >= loop.end)) audio.currentTime = loop.start;
      else if (repeatStart !== undefined) {
        returnTarget = repeatStart;
        audio.currentTime = repeatStart;
      }
    }
    output?.updatePosition(scoreTime(audio.currentTime));
  };
  const tick = () => {
    sync();
    frame = requestAnimationFrame(tick);
  };
  const onPlay = () => {
    api.settings.player.scrollMode = ScrollMode.Continuous;
    cancelAnimationFrame(frame);
    if (output && api.playerState !== synth.PlayerState.Playing) api.play();
    frame = requestAnimationFrame(tick);
  };
  const onPause = () => {
    cancelAnimationFrame(frame);
    if (output && api.playerState === synth.PlayerState.Playing) api.pause();
    sync();
  };
  const onEnded = () => {
    const loop = getLoop();
    const restart = loop?.start ?? repeats.advance(audio.currentTime, getRepeat());
    if (restart !== undefined) {
      returnTarget = loop ? undefined : restart;
      audio.currentTime = restart;
      void audio.play().catch(onError);
    } else {
      onPause();
    }
  };
  const onReady = () => {
    output = api.player.output;
    output.handler = {
      get backingTrackDuration() {
        return Number.isFinite(audio.duration) ? scoreTime(audio.duration) : 0;
      },
      get playbackRate() { return audio.playbackRate; },
      set playbackRate(rate) { audio.playbackRate = rate; },
      get masterVolume() { return audio.volume; },
      set masterVolume(value) { audio.volume = Math.min(1, Math.max(0, value)); },
      seekTo(milliseconds) {
        audio.currentTime = Math.max(0, startTime + milliseconds * audio.playbackRate / 1000);
      },
      play() { void audio.play().catch(onError); },
      pause() { audio.pause(); },
    };
    if (!audio.paused) onPlay();
    else sync();
  };
  const onRate = () => {
    if (output) api.playbackSpeed = audio.playbackRate;
    sync();
  };
  const onSeeked = () => {
    repeats.seek(audio.currentTime, returnTarget !== undefined && Math.abs(audio.currentTime - returnTarget) < 0.01);
    returnTarget = undefined;
    sync();
  };
  const events = { play: onPlay, pause: onPause, ended: onEnded, seeked: onSeeked,
    loadedmetadata: sync, ratechange: onRate };
  for (const [event, handler] of Object.entries(events)) audio.addEventListener(event, handler);
  api.playerReady.on(onReady);

  return () => {
    cancelAnimationFrame(frame);
    for (const [event, handler] of Object.entries(events)) audio.removeEventListener(event, handler);
    api.playerReady.off(onReady);
    if (output) output.handler = undefined;
    audio.pause();
  };
}
