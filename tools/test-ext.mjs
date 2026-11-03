// Testa o content script da extensão em páginas falsas do X, LinkedIn e YouTube (DOM simplificado) e o MCP via stdio.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromePath, puppeteerPath } from './browser.mjs';

const puppeteer = createRequire(import.meta.url)(puppeteerPath);
const content = readFileSync('extension/content.js', 'utf8');
const css = readFileSync('extension/content.css', 'utf8');

const PAGINAS = {
  'https://x.com/home': `<article data-testid="tweet"><div data-testid="User-Name">Ana Lima @analima · 2h</div>
    <a href="/analima/status/123"><time>2h</time></a><div data-testid="tweetText">Thread: 10 cafés em São Paulo</div>
    <div role="group"><button>Responder</button><button>Curtir</button></div></article>
    <article data-testid="tweet"><div data-testid="User-Name">Bia @bia</div><a href="/bia/status/456"><time>1h</time></a>
    <div data-testid="tweetText">Outro post</div><div role="group"><button>Responder</button></div></article>`,
  'https://www.linkedin.com/feed/': `<div data-urn="urn:li:activity:999"><span class="update-components-actor__title"><span aria-hidden="true">Rafael Lima</span></span>
    <div class="update-components-text">Como organizei meu portfólio de design em 30 dias</div>
    <div class="feed-shared-social-action-bar"><button>Gostei</button><button>Enviar</button></div></div>`,
  'https://www.youtube.com/watch?v=abc123': `<ytd-watch-metadata><h1>Linguine com limão</h1><div id="channel-name"><a>Cozinha da Bia</a></div>
    <div id="top-level-buttons-computed"><button>Gostei</button><button>Compartilhar</button></div></ytd-watch-metadata>`,
};
const ESPERADO = {
  'https://x.com/home': { botoes: 2, url: 'https://x.com/analima/status/123', legenda: 'Thread: 10 cafés em São Paulo', autor: '@analima' },
  'https://www.linkedin.com/feed/': { botoes: 1, url: 'https://www.linkedin.com/feed/update/urn:li:activity:999/', legenda: 'Como organizei meu portfólio de design em 30 dias', autor: 'Rafael Lima' },
  'https://www.youtube.com/watch?v=abc123': { botoes: 1, url: 'https://www.youtube.com/watch?v=abc123', titulo: 'Linguine com limão', autor: 'Cozinha da Bia' },
};

let falhas = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok ' : 'ERRO'} ${msg}`); if (!cond) falhas += 1; };

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
for (const [url, html] of Object.entries(PAGINAS)) {
  const p = await browser.newPage();
  await p.setRequestInterception(true);
  p.on('request', (r) => (r.url() === url ? r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><body>${html}</body>` }) : r.abort()));
  await p.evaluateOnNewDocument(() => {
    window.__msgs = [];
    window.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { window.__msgs.push(m); cb(m.tipo === 'status' ? { logado: true, salvos: m.urls.map((u) => u.includes('/456')) } : { ok: true, id: 'x1' }); } } };
  });
  await p.goto(url);
  await p.addStyleTag({ content: css });
  await p.addScriptTag({ content });
  await p.waitForSelector('.guardei-btn');
  await new Promise((r) => setTimeout(r, 200));
  const e = ESPERADO[url];
  const host = new URL(url).hostname;
  ok((await p.$$('.guardei-btn')).length === e.botoes, `${host}: ${e.botoes} botão(ões) ao lado do compartilhar`);
  if (host === 'x.com') ok(await p.$$eval('.guardei-btn', (b) => b[1].getAttribute('aria-pressed') === 'true'), 'x.com: post já guardado aparece marcado');
  await p.click('.guardei-btn');
  await p.waitForSelector('.guardei-toast');
  const msg = await p.evaluate(() => window.__msgs.find((m) => m.tipo === 'guardar'));
  ok(msg?.dados.url === e.url, `${host}: link do post (${msg?.dados.url})`);
  if (e.legenda) ok(msg?.dados.legenda === e.legenda, `${host}: texto do post`);
  if (e.titulo) ok(msg?.dados.titulo === e.titulo, `${host}: título`);
  ok(msg?.dados.autor === e.autor, `${host}: autor (${msg?.dados.autor})`);
  ok(await p.$eval('.guardei-btn', (b) => b.getAttribute('aria-pressed') === 'true'), `${host}: botão vira check`);
  await p.close();
}
await browser.close();

// MCP: sobe o servidor por stdio e lista as ferramentas.
const mcp = spawn(process.execPath, ['mcp/server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
const respostas = [];
let buffer = '';
mcp.stdout.on('data', (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    respostas.push(JSON.parse(buffer.slice(0, i)));
    buffer = buffer.slice(i + 1);
  }
});
const mandar = (m) => mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
mandar({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } });
mandar({ method: 'notifications/initialized' });
mandar({ id: 2, method: 'tools/list' });
await new Promise((r) => setTimeout(r, 1500));
mcp.kill();
const nomes = respostas.find((r) => r.id === 2)?.result?.tools?.map((t) => t.name) || [];
ok(nomes.length === 8 && nomes.includes('get_folder') && nomes.includes('search_saves'), `MCP stdio lista ${nomes.length} ferramentas: ${nomes.join(', ')}`);

if (falhas) process.exitCode = 1;
console.log(falhas ? `\n${falhas} falha(s)` : '\nExtensão e MCP OK');
