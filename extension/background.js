// Service worker da extensão: sessão, gravação no Firestore, fila offline e menu de contexto.
import { APP_ID, APP_URL, emailDe, firebaseConfig } from './lib/config.js';
import { cliente, login } from './lib/firestore-rest.js';
import { normalizarUrl, plataformaDe, tipoDe } from './lib/link.js';

const local = chrome.storage.local;
let api = null;
let mapa = { t: 0, urls: new Map() };

async function obterApi() {
  if (api) return api;
  const { sessao } = await local.get('sessao');
  if (!sessao?.refreshToken) return null;
  api = cliente({
    apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao,
    aoRenovar: (s) => local.set({ sessao: { uid: s.uid, email: s.email, nome: s.nome, refreshToken: s.refreshToken } }),
  });
  return api;
}

async function urlsSalvas(forcar = false) {
  const a = await obterApi();
  if (!a) return new Map();
  if (forcar || Date.now() - mapa.t > 60000) {
    const itens = await a.listar('saves', ['url']);
    mapa = { t: Date.now(), urls: new Map(itens.map((s) => [s.url, s.id])) };
  }
  return mapa.urls;
}

function montarSalvo(dados) {
  const url = normalizarUrl(dados.url);
  const agora = Date.now();
  return {
    url, plataforma: plataformaDe(url), tipo: tipoDe(url), titulo: '',
    tituloOriginal: (dados.titulo || '').slice(0, 300), legenda: (dados.legenda || '').slice(0, 4000),
    autor: (dados.autor || '').slice(0, 100), capa: /^https:\/\//.test(dados.capa || '') ? dados.capa.slice(0, 1500) : '',
    pastas: [], verDepois: false, visto: false, nota: '', status: 'pendente', origem: 'extensao', criadoEm: agora, atualizadoEm: agora,
  };
}

async function guardar(dados) {
  const a = await obterApi();
  if (!a) return { ok: false, erro: 'login' };
  const salvo = montarSalvo(dados);
  try {
    const urls = await urlsSalvas();
    if (urls.has(salvo.url)) return { ok: true, id: urls.get(salvo.url), jaExistia: true };
    const novo = await a.criar('saves', salvo);
    mapa.urls.set(salvo.url, novo.id);
    return { ok: true, id: novo.id };
  } catch (e) {
    // Sem conexão: guarda na fila e manda depois.
    if (e instanceof TypeError) {
      const { fila = [] } = await local.get('fila');
      fila.push(salvo);
      await local.set({ fila });
      return { ok: true, pendente: true };
    }
    return { ok: false, erro: e.message };
  }
}

async function enviarFila() {
  const a = await obterApi();
  const { fila = [] } = await local.get('fila');
  if (!a || !fila.length) return;
  const resto = [];
  for (const s of fila) {
    try {
      const novo = await a.criar('saves', s);
      mapa.urls.set(s.url, novo.id);
    } catch {
      resto.push(s);
    }
  }
  await local.set({ fila: resto });
}

async function remover(url) {
  const a = await obterApi();
  const urls = await urlsSalvas();
  const id = urls.get(normalizarUrl(url));
  if (!a || !id) return { ok: false };
  await a.apagar('saves', id);
  urls.delete(normalizarUrl(url));
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  const tratar = {
    guardar: () => guardar(msg.dados),
    remover: () => remover(msg.url),
    status: async () => {
      if (!(await obterApi())) return { logado: false };
      try {
        const urls = await urlsSalvas();
        return { logado: true, salvos: msg.urls.map((u) => { try { return urls.has(normalizarUrl(u)); } catch { return false; } }) };
      } catch {
        return { logado: true, salvos: msg.urls.map(() => false) };
      }
    },
    login: async () => {
      try {
        const s = await login(firebaseConfig.apiKey, emailDe(msg.usuario), msg.senha);
        await local.set({ sessao: { uid: s.uid, email: s.email, nome: s.nome, refreshToken: s.refreshToken } });
        api = null;
        mapa = { t: 0, urls: new Map() };
        return { ok: true };
      } catch (e) {
        return { ok: false, erro: /INVALID|NOT_FOUND|PASSWORD/.test(e.message) ? 'Usuário ou senha incorretos.' : e.message };
      }
    },
    sair: async () => {
      await local.remove(['sessao', 'fila']);
      api = null;
      mapa = { t: 0, urls: new Map() };
      return { ok: true };
    },
    sessao: async () => {
      const { sessao, fila = [] } = await local.get(['sessao', 'fila']);
      return { sessao: sessao ? { email: sessao.email, nome: sessao.nome } : null, fila: fila.length, appUrl: APP_URL };
    },
  }[msg.tipo];
  if (!tratar) return false;
  tratar().then(responder, (e) => responder({ ok: false, erro: e.message }));
  return true;
});

async function guardarAba(tab, url = tab?.url) {
  if (!url || !/^https?:/.test(url)) return;
  const r = await guardar({ url, titulo: url === tab?.url ? tab.title : '' });
  chrome.action.setBadgeBackgroundColor({ color: r.ok ? '#1d7a4f' : '#c2321b' });
  chrome.action.setBadgeText({ text: r.ok ? '✓' : '!', tabId: tab?.id });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab?.id }), 2500);
  if (r.erro === 'login') chrome.action.openPopup?.();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'guardar-pagina', title: 'Guardar esta página no Guardei', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'guardar-link', title: 'Guardar este link no Guardei', contexts: ['link'] });
  chrome.alarms.create('fila', { periodInMinutes: 1 });
});

chrome.contextMenus.onClicked.addListener((info, tab) => guardarAba(tab, info.menuItemId === 'guardar-link' ? info.linkUrl : info.pageUrl));
chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === 'guardar-aba') guardarAba(tab); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'fila') enviarFila(); });
