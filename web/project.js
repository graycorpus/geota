import { model } from '@coderline/alphatab';

const magic = 'GEOTA1\n';
const maxMetadata = 32 * 1024 * 1024;
const maxAudio = 25 * 1024 * 1024;
const invalid = () => new Error('无法打开此项目。请选择完整的 .geota 文件。');

export function saveProject(score, audio, timing) {
  const metadata = new Blob([JSON.stringify({
    score: model.JsonConverter.scoreToJson(score),
    audioName: audio?.name,
    startTime: timing?.startTime,
    barTimes: timing?.barTimes,
    mode: timing?.mode,
    showNumbered: timing?.showNumbered,
  })]);
  if (metadata.size > maxMetadata || (audio?.size ?? 0) > maxAudio) {
    throw new Error('项目超过可保存的大小。');
  }
  return new Blob([magic, String(metadata.size).padStart(8, '0'), '\n', metadata, ...(audio ? [audio] : [])]);
}

export async function openProject(file) {
  const headerLength = magic.length + 9;
  const header = await file.slice(0, headerLength).text();
  const length = Number(header.slice(magic.length, -1));
  if (!header.startsWith(magic) || !/^\d{8}\n$/.test(header.slice(magic.length)) ||
      !Number.isInteger(length) || length < 1 || length > maxMetadata) throw invalid();

  const audioOffset = headerLength + length;
  const audioLength = file.size - audioOffset;
  if (audioLength < 0 || audioLength > maxAudio) throw invalid();
  try {
    const { score: scoreJson, audioName, startTime, barTimes, mode, showNumbered } =
      JSON.parse(await file.slice(headerLength, audioOffset).text());
    const score = model.JsonConverter.jsonToScore(scoreJson);
    if (!score.tracks.length) throw invalid();
    const preferences = {
      ...(mode === 'accompaniment' ? { mode } : {}),
      ...(typeof showNumbered === 'boolean' ? { showNumbered } : {}),
    };
    if (audioLength === 0) return { score, timing: preferences };
    if (typeof audioName !== 'string' || !Number.isFinite(startTime) ||
        !Array.isArray(barTimes) || barTimes.length !== score.masterBars.length + 1 ||
        barTimes.some((time, index) => !Number.isFinite(time) || (index && time <= barTimes[index - 1]))) {
      throw invalid();
    }
    const audio = new File([file.slice(audioOffset)], audioName, { type: 'audio/mpeg' });
    return { score, audio, timing: { startTime, barTimes, ...preferences } };
  } catch {
    throw invalid();
  }
}
