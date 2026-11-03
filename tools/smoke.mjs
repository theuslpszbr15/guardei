// Teste ponta a ponta no Chrome headless: conta temporária no Firebase real, IA e metadados simulados.
// Uso: node tools/smoke.mjs   (gera capturas em tools/out/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { APP_ID, emailDe, firebaseConfig } from '../js/config.js';
import { apagarConta, cliente, login } from '../js/firestore-rest.js';
import { criarFerramentas } from '../mcp/tools.mjs';
import { chromePath, puppeteerPath } from './browser.mjs';

const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const PORTA = 5181;
const BASE = `http://localhost:${PORTA}/`;
const USUARIO = `smoke${Date.now().toString(36)}`;
const SENHA = 'teste-123456';
mkdirSync('tools/out', { recursive: true });

const servidor = spawn(process.execPath, ['tools/serve.mjs', String(PORTA)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

// ---------- Respostas simuladas ----------
const CONTEUDO = {
  receita1: { titulo: 'Espaguete ao limão siciliano', resumo: 'Massa cremosa com limão siciliano, manteiga e parmesão, pronta em 15 minutos. Leva 500 g de espaguete, 2 limões e 100 g de parmesão.', categoria: 'Receita', legenda: 'Espaguete ao limão em 15 minutos 🍋', transcricao: 'Hoje eu vou fazer um espaguete ao limão siciliano. Enquanto a massa cozinha, raspo a casca de dois limões...', textoNaTela: 'ESPAGUETE AO LIMÃO · 15 MIN', tags: ['massa', 'limão', 'jantar rápido'] },
  ABCreel: { titulo: 'Linguine com limão e parmesão', resumo: 'Linguine com creme de leite, limão e parmesão. Ingredientes: 250 g de linguine, 200 ml de creme de leite, 1 limão.', categoria: 'Receita', legenda: 'Receita fácil de linguine', transcricao: '', textoNaTela: 'LINGUINE CREMOSO', tags: ['massa', 'limão'] },
  lisboa: { titulo: 'Lisboa em 3 dias: o roteiro completo', resumo: 'Roteiro de 3 dias por Lisboa: Alfama e Castelo no dia 1, Belém no dia 2 e LX Factory no dia 3.', categoria: 'Lugar', legenda: '', transcricao: '', textoNaTela: '', tags: ['viagem', 'portugal'] },
};
const capaSvg = (cor, texto) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${cor}"/><stop offset="1" stop-color="#222"/></linearGradient></defs><rect width="640" height="800" fill="url(#g)"/><circle cx="320" cy="360" r="190" fill="#f4efe6"/><circle cx="320" cy="360" r="140" fill="#f1c84b"/><text x="40" y="740" font-family="Segoe UI" font-size="44" font-weight="700" fill="#fff">${texto}</text></svg>`;

function responder(req) {
  const url = req.url();
  const json = (obj, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });
  if (url.includes('generativelanguage.googleapis.com')) {
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' } });
    const corpo = req.postData() || '';
    let texto;
    if (corpo.includes('Responda SOMENTE um JSON')) {
      const chave = Object.keys(CONTEUDO).find((k) => corpo.includes(k));
      texto = `\`\`\`json\n${JSON.stringify(CONTEUDO[chave] || { titulo: 'Outro', resumo: '', categoria: 'Outro' })}\n\`\`\``;
    } else if (corpo.includes('Responda só: ok')) texto = 'ok';
    else texto = 'Lista de compras para as 2 receitas:\n- **500 g** de espaguete [1]\n- 250 g de linguine [2]\n- 3 limões sicilianos [1] [2]\n- 200 ml de creme de leite [2]\n- 100 g de parmesão [1]';
    return json({ candidates: [{ content: { parts: [{ text: texto }] } }] });
  }
  if (url.startsWith('https://www.youtube.com/oembed')) {
    return json({ title: 'Spaghetti al limone (15 min)', author_name: 'Cozinha da Bia', author_url: 'https://www.youtube.com/@cozinhadabia', thumbnail_url: 'https://i.ytimg.com/vi/receita1/hqdefault.jpg' });
  }
  if (url.startsWith('https://api.microlink.io')) {
    if (url.includes('instagram')) return json({ status: 'fail', code: 'EPROXYNEEDED' }, 400);
    return json({ status: 'success', data: { title: 'Lisboa em 3 dias', description: 'Lisboa cabe em três dias se você souber por onde começar.', publisher: 'viagem.blog', image: { url: 'https://viagem.blog/capa.jpg' } } });
  }
  if (url.startsWith('https://i.ytimg.com/')) return req.respond({ status: 200, contentType: 'image/svg+xml', body: capaSvg('#d98a2b', 'al limone') });
  if (url.startsWith('https://viagem.blog/')) return req.respond({ status: 200, contentType: 'image/svg+xml', body: capaSvg('#2b78d9', 'Lisboa') });
  return req.continue();
}

// ---------- Navegador ----------
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
const erros = [];
let passos = 0;
const passo = (t) => console.log(`  ok  ${++passos}. ${t}`);

async function novaPagina(largura, altura, mobile = false) {
  const p = await browser.newPage();
  await p.setViewport({ width: largura, height: altura, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.setRequestInterception(true);
  p.on('request', responder);
  p.on('pageerror', (e) => erros.push(e.message));
  p.on('requestfailed', (r) => { if (r.url().includes('googleapis')) console.log(`  (rede) ${r.method()} ${r.url().slice(0, 90)} -> ${r.failure()?.errorText}`); });
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) erros.push(m.text()); });
  return p;
}

const esperarTexto = (p, texto, timeout = 20000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, texto);
const clicarTexto = async (p, seletor, texto) => {
  await p.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim().includes(t) && !e.disabled), { timeout: 15000 }, seletor, texto);
  await p.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t) && !e.disabled).click(), seletor, texto);
};
const foto = async (p, nome) => {
  const largura = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  if (largura[0] > largura[1]) erros.push(`${nome}: página mais larga que a tela (${largura[0]} > ${largura[1]})`);
  await p.screenshot({ path: `tools/out/${nome}.png` });
};

let sessao;
try {
  const p = await novaPagina(1280, 860);
  await p.goto(BASE, { waitUntil: 'networkidle0' });

  // 1. Login / cadastro
  await p.waitForSelector('.login-form');
  await foto(p, '01-login');
  await clicarTexto(p, 'button', 'Criar conta');
  await p.type('input[name=nome]', 'Smoke Teste');
  await p.type('input[name=usuario]', USUARIO);
  await p.type('input[name=senha]', SENHA);
  await p.click('.login-form button[type=submit]');
  await esperarTexto(p, 'Nada guardado ainda');
  passo('cria conta e entra');

  // 2. Chave do Gemini
  await p.goto(`${BASE}#/ajustes`);
  await p.waitForSelector('input[aria-label="Chave do Gemini"]');
  await p.type('input[aria-label="Chave do Gemini"]', 'AIza-chave-de-teste');
  await clicarTexto(p, '#aj-gemini button', 'Salvar');
  await esperarTexto(p, 'Salvo. Vale para todos');
  await clicarTexto(p, '#aj-gemini button', 'Testar');
  await esperarTexto(p, 'Funcionou com');
  await esperarTexto(p, 'Sincronizado com a nuvem');
  await clicarTexto(p, '#aj-onde button', 'QR code');
  await p.waitForSelector('.folha .qr svg path');
  await foto(p, '01b-qr-instalar');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.folha-fundo'));
  passo('salva e testa a chave da IA, mostra sincronia e QR code');

  // 3. Adicionar links
  await p.goto(`${BASE}#/salvos`);
  for (const link of ['https://www.youtube.com/watch?v=receita1&si=rastreio', 'Olha https://www.instagram.com/reel/ABCreel/?igsh=abc']) {
    await clicarTexto(p, '.topo button', 'Adicionar link');
    await p.waitForSelector('.folha input');
    await p.type('.folha input', link);
    await p.click('.folha button[type=submit]');
    await p.waitForFunction(() => !document.querySelector('.folha-fundo'));
  }
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 2 && !document.body.innerText.includes('Lendo este'), { timeout: 40000 });
  passo('adiciona link pelo botão');

  // 4. Link compartilhado (share target do Android)
  await p.goto(`${BASE}?share_title=Lisboa&share_text=${encodeURIComponent('Lisboa em 3 dias')}&share_url=${encodeURIComponent('https://viagem.blog/lisboa?utm_source=x')}#/salvos`);
  await p.waitForFunction(() => !location.search && document.querySelectorAll('.card').length === 3, { timeout: 20000 });
  passo('recebe link do menu Compartilhar e limpa a URL');

  // 5. Processamento pela IA
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 3 && !document.body.innerText.includes('Lendo este'), { timeout: 40000 });
  await esperarTexto(p, 'Espaguete ao limão siciliano');
  await esperarTexto(p, 'Linguine com limão e parmesão');
  await esperarTexto(p, 'Lisboa em 3 dias: o roteiro completo');
  await foto(p, '02-salvos');
  passo('lê, resume e classifica os 3 salvos');

  // 6. Duplicado
  await clicarTexto(p, '.topo button', 'Adicionar link');
  await p.type('.folha input', 'https://youtu.be/receita1');
  await p.click('.folha button[type=submit]');
  await esperarTexto(p, 'Você já tinha guardado isso');
  assert(await p.$$eval('.card', (c) => c.length) === 3, 'não deveria duplicar');
  passo('não guarda o mesmo link duas vezes');

  // 7. Busca e filtros
  await p.type('.busca input', 'aquela massa com limão');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  await foto(p, '03-busca');
  await p.$eval('.busca input', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await p.select('select[aria-label=Categoria]', 'Lugar');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  await p.select('select[aria-label=Categoria]', '');
  passo('busca do jeito que lembra e filtra por categoria');

  // 8. Detalhe
  await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('Espaguete')).querySelector('a').click());
  await p.waitForSelector('.detalhe-titulo');
  await esperarTexto(p, 'pronta em 15 minutos');
  assert(await p.$eval('select[aria-label=Categoria]', (s) => s.value) === 'Receita');
  await clicarTexto(p, '.abas-seg button', 'Transcrição');
  await esperarTexto(p, 'Enquanto a massa cozinha');
  await clicarTexto(p, '.nota-btn', 'Adicionar uma nota');
  await p.type('textarea.nota', 'Fazer no domingo');
  await p.click('.detalhe-titulo');
  await p.waitForFunction(() => document.querySelector('textarea.nota')?.value === 'Fazer no domingo');
  await clicarTexto(p, '.abas-seg button', 'Resumo');
  await foto(p, '04-detalhe');
  passo('detalhe com resumo, transcrição, categoria e nota');

  // 9. Pasta a partir do detalhe
  await clicarTexto(p, 'button', 'Adicionar à pasta');
  await clicarTexto(p, '.folha button', 'Nova pasta');
  await p.waitForFunction(() => document.querySelectorAll('.folha').length === 2);
  const nomeIn = await (await p.$$('.folha-fundo')).at(-1).$('input');
  await nomeIn.type('Receitas');
  await nomeIn.press('Enter');
  await p.waitForFunction(() => !document.querySelector('.folha-fundo'));
  await p.waitForFunction(() => [...document.querySelectorAll('.detalhe a.chip')].some((a) => a.textContent.includes('Receitas')));
  passo('cria pasta e adiciona pelo detalhe');

  // 10. Seleção múltipla para a pasta
  await p.goto(`${BASE}#/salvos`);
  await clicarTexto(p, '.filtros button', 'Selecionar');
  await p.waitForSelector('.card button.card-link');
  await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('Linguine')).querySelector('button.card-link').click());
  await clicarTexto(p, '.barra-sel button', 'Adicionar à pasta');
  await clicarTexto(p, '.folha .pasta-mini', 'Receitas');
  await p.waitForFunction(() => !document.querySelector('.folha-fundo'), { timeout: 3000 });
  await p.goto(`${BASE}#/pastas`);
  await esperarTexto(p, '2 itens');
  await foto(p, '05-pastas');
  passo('seleciona vários e põe na pasta');

  // 11. Chat
  await p.goto(`${BASE}#/chat`);
  await clicarTexto(p, '.sugestoes button', 'lista de compras');
  await p.waitForSelector('.msg.ia a.cita');
  await foto(p, '06-chat');
  passo('chat responde citando os salvos');

  // 12. MCP com a mesma conta
  sessao = await login(firebaseConfig.apiKey, emailDe(USUARIO), SENHA);
  const api = cliente({ apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao });
  const mcp = criarFerramentas(api);
  const pasta = await mcp.get_folder({ name: 'Receitas' });
  assert(pasta.itens.length === 2 && pasta.itens.some((i) => i.transcricao.includes('espaguete')), 'get_folder deveria trazer 2 receitas com transcrição');
  assert((await mcp.search_saves({ query: 'roteiro lisboa' })).resultados[0].titulo.includes('Lisboa'));
  const novo = await mcp.save_link({ url: 'https://viagem.blog/porto', folder: 'Viagens' });
  await p.goto(`${BASE}#/salvos`);
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 4, { timeout: 20000 });
  passo(`MCP lê pasta, busca e guarda link (${novo.id.slice(0, 6)}…) que aparece no app`);

  // 13. Excluir e desfazer
  await p.waitForFunction(() => !document.body.innerText.includes('Lendo este'), { timeout: 30000 });
  await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('Lisboa em 3')).querySelector('.card-menu').click());
  await clicarTexto(p, '.menu button', 'Excluir');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 3);
  await clicarTexto(p, '.toast button', 'Desfazer');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  passo('exclui e desfaz');

  // 14. Celular
  const m = await novaPagina(390, 844, true);
  await m.goto(`${BASE}#/salvos`, { waitUntil: 'networkidle0' });
  await m.waitForFunction(() => document.querySelectorAll('.card').length === 4 && !document.body.innerText.includes('Lendo este'), { timeout: 20000 });
  await foto(m, '07-celular-salvos');
  await m.click('button[aria-label="Filtros"]');
  await clicarTexto(m, '.filtros button', 'Selecionar');
  for (const t of ['Espaguete', 'Linguine']) await m.evaluate((t) => [...document.querySelectorAll('.card')].find((c) => c.innerText.includes(t)).querySelector('button.card-link').click(), t);
  await clicarTexto(m, '.barra-sel button', 'Adicionar à pasta');
  await m.waitForSelector('.folha .pasta-mini');
  await new Promise((r) => setTimeout(r, 400));
  await foto(m, '07b-celular-folha-pasta');
  await m.keyboard.press('Escape');
  await m.goto(`${BASE}#/buscar`);
  await m.waitForSelector('.busca input');
  await m.type('.busca input', 'aquela massa com limão');
  await m.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  await foto(m, '07c-celular-busca');
  await m.$eval('.busca input', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await m.goto(`${BASE}#/salvos`);
  await m.waitForFunction(() => document.querySelectorAll('.card a').length === 4);
  await m.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('Espaguete')).querySelector('a').click());
  await m.waitForSelector('.detalhe-titulo');
  await foto(m, '08-celular-detalhe');
  await m.goto(`${BASE}#/pastas`);
  await esperarTexto(m, 'Receitas');
  await foto(m, '09-celular-pastas');
  await m.goto(`${BASE}#/chat`);
  await m.waitForSelector('.msg.ia');
  await foto(m, '10-celular-chat');
  // Tema escuro
  await m.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await m.goto(`${BASE}#/salvos`);
  await m.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  await foto(m, '11-celular-escuro');
  passo('layout de celular e tema escuro');

  if (erros.length) throw new Error(`Erros no console:\n${erros.join('\n')}`);
  console.log(`\nSmoke OK (${passos} passos). Capturas em tools/out/`);
} catch (e) {
  console.error('\nFALHOU:', e.message);
  const [pg] = (await browser.pages()).slice(-1);
  await pg?.screenshot({ path: 'tools/out/falha.png' }).catch(() => {});
  if (erros.length) console.error(erros.join('\n'));
  process.exitCode = 1;
} finally {
  // Limpa a conta temporária na nuvem.
  try {
    sessao ||= await login(firebaseConfig.apiKey, emailDe(USUARIO), SENHA);
    const api = cliente({ apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao });
    for (const c of ['saves', 'folders']) for (const d of await api.listar(c)) await api.apagar(c, d.id);
    const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${sessao.uid}/apps/${APP_ID}`;
    await fetch(base, { method: 'DELETE', headers: { Authorization: `Bearer ${sessao.idToken}` } });
    await apagarConta(firebaseConfig.apiKey, sessao.idToken);
    console.log(`Conta temporária ${USUARIO} apagada.`);
  } catch (e) {
    console.error(`Não consegui apagar a conta temporária ${USUARIO}: ${e.message}`);
  }
  await browser.close();
  servidor.kill();
}

function assert(cond, msg = 'falhou') {
  if (!cond) throw new Error(msg);
}
