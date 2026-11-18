import { AlphaTabApi, model } from '@coderline/alphatab';
import { jsPDF } from 'jspdf';

const printWidth = 1500;
const margin = 10;

async function renderSystems(source) {
  const { scoreToJsObject, jsObjectToScore, settingsToJsObject, jsObjectToSettings } = model.JsonConverter;
  const score = jsObjectToScore(scoreToJsObject(source.score));
  const settings = jsObjectToSettings(settingsToJsObject(source.settings));
  settings.core.engine = 'html5';
  settings.core.useWorkers = false;
  settings.core.enableLazyLoading = false;
  settings.player.playerMode = 0;
  settings.player.enableCursor = false;
  settings.display.scale = 2;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: printWidth + 'px' });
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  let api;
  let timeout;
  try {
    api = new AlphaTabApi(host, settings);
    return await new Promise((resolve, reject) => {
      const systems = new Map();
      timeout = setTimeout(() => reject(new Error('Score rendering timed out')), 20000);
      api.error.on(reject);
      api.renderer.partialRenderFinished.on(part => {
        if (part.renderResult instanceof HTMLCanvasElement) systems.set(part.id, part);
      });
      api.postRenderFinished.on(() => {
        if (systems.size) resolve([...systems.values()].sort((a, b) => a.y - b.y || a.x - b.x));
      });
      api.renderScore(score, source.tracks.map(track => track.index));
    });
  } finally {
    clearTimeout(timeout);
    api?.destroy();
    host.remove();
  }
}

export async function downloadScorePdf(api, filename) {
  const systems = await renderSystems(api);
  const pdf = new jsPDF({ format: 'a4', unit: 'mm', compress: true });
  pdf.setProperties({ title: filename });
  const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageEnd = pdf.internal.pageSize.getHeight() - margin;
  const usableHeight = pageEnd - margin;
  const scale = usableWidth / printWidth;
  let y = margin;

  for (const { renderResult: canvas, x, width, height } of systems) {
    if (!canvas.width || !canvas.height) continue;
    const factor = Math.min(scale, usableHeight / height);
    const heightMm = height * factor;
    if (y > margin && y + heightMm > pageEnd) {
      pdf.addPage();
      y = margin;
    }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + x * factor, y, width * factor, heightMm, undefined, 'FAST');
    y += heightMm;
  }
  pdf.save(filename + '.pdf');
}
