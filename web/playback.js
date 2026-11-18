import { ScrollMode, synth } from '@coderline/alphatab';

export function connectPlayback(api, audio, startTime, getLoop, onError) {
  let frame = 0;
  let output;
  const scoreTime = seconds => Math.max(0, (seconds - startTime) * 1000 / audio.playbackRate);
  const sync = () => {
    const loop = getLoop();
    if (loop && !audio.paused && !audio.seeking &&
      (audio.currentTime < loop.start || audio.currentTime >= loop.end)) {
      audio.currentTime = loop.start;
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
    if (loop) {
      audio.currentTime = loop.start;
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
  const events = { play: onPlay, pause: onPause, ended: onEnded, seeked: sync,
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
