// Gera os PNGs do app e da extensão a partir de icons/icon.svg usando o Chrome headless.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromePath, puppeteerPath } from './browser.mjs';

const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const svg = readFileSync('icons/icon.svg', 'utf8');
// Versão simplificada (sem a foto no cartão) para tamanhos pequenos.
const svgPequeno = readFileSync('icons/marca.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage();

async function png(tamanho, saida, { margem = 0, fundo = 'transparent', cantos = true } = {}) {
  await page.setViewport({ width: tamanho, height: tamanho });
  const base = tamanho <= 48 ? svgPequeno : svg;
  const interno = cantos ? base : base.replace('rx="116"', 'rx="0"');
  await page.setContent(`<body style="margin:0;background:${fundo}"><div style="width:${tamanho}px;height:${tamanho}px;display:grid;place-items:center">
    <div style="width:${tamanho - margem * 2}px;height:${tamanho - margem * 2}px">${interno.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body>`);
  writeFileSync(saida, await page.screenshot({ omitBackground: fundo === 'transparent' }));
  console.log(saida);
}

await png(192, 'icons/icon-192.png');
await png(512, 'icons/icon-512.png');
await png(512, 'icons/icon-maskable-512.png', { cantos: false });
for (const t of [16, 32, 48, 128]) await png(t, `extension/icons/icon-${t}.png`);
await browser.close();
