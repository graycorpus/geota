import { exporter, model, Settings } from '@coderline/alphatab';

export function exportGuitarPro(score, repeat) {
  if (repeat) {
    const { scoreToJsObject, jsObjectToScore } = model.JsonConverter;
    score = jsObjectToScore(scoreToJsObject(score));
    score.masterBars[repeat.startBar - 1].isRepeatStart = true;
    score.masterBars[repeat.endBar - 1].repeatCount = repeat.plays;
    score.rebuildRepeatGroups();
  }
  return new exporter.Gp7Exporter().export(score, new Settings());
}

export function scoreFileName(score) {
  return score.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[.\s]+$/g, '').trim() || '吉他谱';
}

export function downloadGuitarPro(score, repeat) {
  const data = exportGuitarPro(score, repeat);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = scoreFileName(score) + '.gp';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
