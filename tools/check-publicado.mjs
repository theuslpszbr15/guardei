// Confere o site publicado: abre, registra o service worker e verifica se o Chrome considera instalável.
import { createRequire } from 'node:module';
import { chromePath, puppeteerPath } from './browser.mjs';

const URL_APP = process.argv[2] || 'https://theuslpszbr15.github.io/guardei/';
const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
const p = await browser.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await p.goto(URL_APP, { waitUntil: 'networkidle0' });
await p.waitForSelector('.login-form', { timeout: 15000 });
const sw = await p.evaluate(async () => (await navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)));
const cdp = await p.createCDPSession();
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
const { url, errors } = await cdp.send('Page.getAppManifest');
console.log('login na tela: ok');
console.log('service worker ativo:', sw);
console.log('manifesto:', url, errors.length ? errors : 'sem erros');
console.log('instalável:', installabilityErrors.length ? installabilityErrors : 'sim');
console.log('erros no console:', erros.length ? erros : 'nenhum');
await p.screenshot({ path: 'tools/out/publicado-login.png' });
await browser.close();
if (erros.length || installabilityErrors.length) process.exitCode = 1;
