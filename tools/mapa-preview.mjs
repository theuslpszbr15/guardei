// Capturas do mapa com dados falsos (claro/escuro, desktop/celular, destaque). Uso: node tools/mapa-preview.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromePath, puppeteerPath } from './browser.mjs';

const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const PORTA = 5183;
mkdirSync('tools/out', { recursive: true });
const servidor = spawn(process.execPath, ['tools/serve.mjs', String(PORTA)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const erros = [];
const casos = [
  ['mapa-demo-claro', 1280, 800, ''],
  ['mapa-demo-escuro', 1280, 800, 'tema=escuro&tags'],
  ['mapa-demo-destaque', 1280, 800, 'q=receita'],
  ['mapa-demo-poucos', 1280, 800, 'n=6'],
  ['mapa-demo-celular', 390, 700, 'n=25'],
];
try {
  for (const [nome, w, h, qs] of casos) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    p.on('pageerror', (e) => erros.push(`${nome}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') erros.push(`${nome}: ${m.text()}`); });
    await p.goto(`http://localhost:${PORTA}/tools/mapa-demo.html?${qs}`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 9000));
    await p.screenshot({ path: `tools/out/${nome}.png` });
    await p.close();
  }
} finally {
  await browser.close();
  servidor.kill();
}
console.log(erros.length ? `Erros:\n${erros.join('\n')}` : 'Capturas prontas em tools/out/mapa-demo-*.png');
