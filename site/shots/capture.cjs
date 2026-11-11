/**
 * Roda DENTRO do Electron do projeto (`electron site/shots/capture.cjs spec.json`): abre cada URL numa
 * janela invisível, espera, tira a captura e grava PNG + WebP (1440 e 720 px). Sem ferramenta nova:
 * o Chromium do Electron já está no repositório e codifica WebP pelo canvas.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const spec = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

function press(win, key) {
  const wc = win.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: key });
  wc.sendInputEvent({ type: 'char', keyCode: key });
  wc.sendInputEvent({ type: 'keyUp', keyCode: key });
}

/** Reduz o PNG para `width` px e devolve WebP, usando o canvas da própria página já aberta. */
function toWebp(win, pngBase64, width) {
  return win.webContents
    .executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${pngBase64}';
    await img.decode();
    const w = Math.min(${width}, img.naturalWidth);
    const h = Math.round(img.naturalHeight * w / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/webp', 0.84).split(',')[1];
  })()`)
    .then((b64) => Buffer.from(b64, 'base64'));
}

let win = null;
async function shoot(shot) {
  if (!win)
    win = new BrowserWindow({
      width: shot.width,
      height: shot.height,
      useContentSize: true,
      show: false,
      frame: false,
      backgroundColor: '#05080c',
      webPreferences: { backgroundThrottling: false, offscreen: true },
    });
  win.webContents.setFrameRate(30); // janela invisível comum entrega quadros atrasados; offscreen não
  try {
    await win.loadURL(shot.url);
    await sleep(shot.waitMs ?? 3000);
    for (const step of shot.steps ?? []) {
      if (step.key) press(win, step.key);
      if (step.js) await win.webContents.executeJavaScript(step.js);
      await sleep(step.waitMs ?? 600);
    }
    const png = (await win.webContents.capturePage()).toPNG();
    const b64 = png.toString('base64');
    const webp = {};
    for (const w of [1440, 720]) webp[w] = await toWebp(win, b64, w);
    return { png, webp };
  } finally {
    // a janela é reaproveitada: criar uma segunda janela invisível falha no Electron 45
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(spec.outDir, { recursive: true });
  let failed = false;
  for (const shot of spec.shots) {
    try {
      const { png, webp } = await shoot(shot);
      fs.writeFileSync(path.join(spec.outDir, `${shot.name}.png`), png);
      for (const w of [1440, 720]) {
        fs.writeFileSync(path.join(spec.outDir, `${shot.name}-${w}.webp`), webp[w]);
      }
      console.log(`ok ${shot.name}`);
    } catch (e) {
      failed = true;
      console.error(`falhou ${shot.name}: ${e.message}`);
    }
  }
  win?.destroy();
  app.exit(failed ? 1 : 0);
});
