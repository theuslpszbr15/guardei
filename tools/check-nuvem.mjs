// Prova que o site publicado grava na nuvem: cria conta temporária, guarda um link pelo app
// e lê de volta direto do Firestore (outro cliente, sem o navegador). Depois apaga tudo.
import { createRequire } from 'node:module';
import { APP_ID, emailDe, firebaseConfig } from '../js/config.js';
import { apagarConta, cliente, login } from '../js/firestore-rest.js';
import { chromePath, puppeteerPath } from './browser.mjs';

const URL_APP = process.argv[2] || 'https://theuslpszbr15.github.io/guardei/';
const USUARIO = `nuvem${Date.now().toString(36)}`;
const SENHA = 'teste-123456';
const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
let sessao;
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.goto(URL_APP, { waitUntil: 'networkidle0' });
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Criar conta').click());
  await p.type('input[name=email]', emailDe(USUARIO));
  await p.type('input[name=senha]', SENHA);
  await p.click('.login-form button[type=submit]');
  await p.waitForFunction(() => document.body.innerText.includes('Nada guardado ainda'), { timeout: 20000 });
  await p.evaluate(() => [...document.querySelectorAll('.topo button')].find((b) => b.textContent.includes('Adicionar link')).click());
  await p.type('.folha input', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await p.click('.folha button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 1 && !document.body.innerText.includes('Lendo este'), { timeout: 40000 });
  console.log('app: link guardado e lido');
  await browser.close();

  sessao = await login(firebaseConfig.apiKey, emailDe(USUARIO), SENHA);
  const api = cliente({ apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao });
  const salvos = await api.listar('saves');
  console.log(`Firestore (lido de fora do navegador): ${salvos.length} salvo(s)`);
  for (const s of salvos) console.log(`  - ${s.titulo} | ${s.autor} | status=${s.status} | users/${sessao.uid.slice(0, 6)}…/apps/guardei/saves/${s.id}`);
  if (salvos.length !== 1) process.exitCode = 1;
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
  await browser.close().catch(() => {});
} finally {
  sessao ||= await login(firebaseConfig.apiKey, emailDe(USUARIO), SENHA).catch(() => null);
  if (sessao) {
    const api = cliente({ apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao });
    for (const c of ['saves', 'folders']) for (const d of await api.listar(c)) await api.apagar(c, d.id);
    await apagarConta(firebaseConfig.apiKey, sessao.idToken);
    console.log(`conta temporária ${USUARIO} apagada`);
  }
}
