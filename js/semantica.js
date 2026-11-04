// Busca pelo assunto: cada salvo vira alguns vetores (resumo + trechos da transcrição) no Gemini Embedding
// e a pergunta é comparada com eles no próprio aparelho. Acha o vídeo mesmo sem lembrar nenhuma palavra exata.
import { normalizar, termos } from './search.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELOS = ['gemini-embedding-2', 'gemini-embedding-001'];
const DIM = 256;
const TRECHO = 1800;
const PASSO = 1500;
const MAX_TRECHOS = 16;
export const VERSAO_INDICE = 1;

let modeloAtivo = '';

async function postar(caminho, chave, corpo) {
  const r = await fetch(`${BASE}/${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error?.message || `Gemini respondeu ${r.status}`);
    e.status = r.status;
    e.indisponivel = r.status === 404 || /not found|not supported|no longer available/i.test(e.message);
    throw e;
  }
  return d;
}

// O modelo 2 recebe a tarefa no próprio texto; o 001 usa taskType.
const preparar = (modelo, texto, consulta, titulo) => {
  if (modelo === 'gemini-embedding-001') return { texto, taskType: consulta ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' };
  return { texto: consulta ? `task: search result | query: ${texto}` : `title: ${titulo || 'none'} | text: ${texto}` };
};

async function embutir(chave, modelo, itens, consulta) {
  const requests = itens.map(({ texto, titulo }) => {
    const p = preparar(modelo, texto, consulta, titulo);
    return { model: `models/${modelo}`, content: { parts: [{ text: p.texto }] }, outputDimensionality: DIM, ...(p.taskType ? { taskType: p.taskType } : {}) };
  });
  const d = await postar(`models/${modelo}:batchEmbedContents`, chave, { requests });
  return (d.embeddings || []).map((e) => e.values || []);
}

async function comFallback(chave, fazer, preferido) {
  const ordem = [...new Set([preferido || modeloAtivo, ...MODELOS].filter(Boolean))];
  let erro;
  for (const m of ordem) {
    try {
      const r = await fazer(m);
      modeloAtivo = m;
      return { modelo: m, r };
    } catch (e) {
      erro = e;
      if (!e.indisponivel) throw e;
    }
  }
  throw erro;
}

// Partes do salvo que viram vetores. "campo:ini:fim" permite mostrar depois o trecho que bateu.
export function partesDo(s) {
  const partes = [];
  const cabeca = [s.categoria, (s.tags || []).join(', '), s.resumo, s.nota, s.autor && `Autor: ${s.autor}`].filter(Boolean).join('. ');
  partes.push({ ref: 'resumo:0:0', texto: cabeca || s.titulo || s.url });
  for (const campo of ['transcricao', 'legenda', 'textoNaTela']) {
    const t = s[campo] || '';
    for (let ini = 0; ini < t.length && partes.length < MAX_TRECHOS; ini += PASSO) {
      const fim = Math.min(t.length, ini + TRECHO);
      if (t.slice(ini, fim).trim().length > 40) partes.push({ ref: `${campo}:${ini}:${fim}`, texto: t.slice(ini, fim) });
      if (fim === t.length) break;
    }
  }
  return partes;
}

function assinatura(s, partes) {
  let h = 5381;
  const txt = `${s.titulo}|${partes.map((p) => p.texto).join('|')}`;
  for (let i = 0; i < txt.length; i += 1) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Recalcula a assinatura só quando o salvo muda (transcrições podem ser longas).
const assinaturas = new Map();
function assinaturaAtual(s) {
  const c = assinaturas.get(s.id);
  if (c && c.em === s.atualizadoEm) return c.h;
  const h = assinatura(s, partesDo(s));
  assinaturas.set(s.id, { em: s.atualizadoEm, h });
  return h;
}

export const precisaIndice = (s) => s.status === 'pronto' && (!s.indice || s.indice.v !== VERSAO_INDICE || s.indice.h !== assinaturaAtual(s));

// Vetor em 1 byte por número (o cosseno não muda com a escala) para ocupar pouco no Firestore.
function compactar(vet) {
  const max = Math.max(...vet.map(Math.abs)) || 1;
  const bytes = new Int8Array(vet.map((x) => Math.round((x / max) * 127)));
  let bin = '';
  for (const b of new Uint8Array(bytes.buffer)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function abrir(b64) {
  const bin = atob(b64);
  const v = new Float32Array(bin.length);
  let n = 0;
  for (let i = 0; i < bin.length; i += 1) {
    const x = (bin.charCodeAt(i) << 24) >> 24;
    v[i] = x;
    n += x * x;
  }
  const norma = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] /= norma;
  return v;
}

export async function indexar(chave, s) {
  const partes = partesDo(s);
  const { modelo, r } = await comFallback(chave, (m) => embutir(chave, m, partes.map((p) => ({ texto: p.texto, titulo: s.titulo })), false), s.indice?.modelo);
  return { v: VERSAO_INDICE, h: assinatura(s, partes), modelo, partes: partes.map((p) => p.ref), vetores: r.map(compactar) };
}

const consultas = new Map();
export async function vetorDaConsulta(chave, q, modelo) {
  const k = `${modelo}|${q}`;
  if (!consultas.has(k)) {
    consultas.set(k, comFallback(chave, (m) => embutir(chave, m, [{ texto: q }], true), modelo).then(({ r }) => {
      const v = Float32Array.from(r[0] || []);
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    }).catch((e) => { consultas.delete(k); throw e; }));
  }
  return consultas.get(k);
}

const abertos = new Map();
function vetoresDo(s) {
  const c = abertos.get(s.id);
  if (c && c.h === s.indice.h && c.modelo === s.indice.modelo) return c.vets;
  const vets = s.indice.vetores.map(abrir);
  abertos.set(s.id, { h: s.indice.h, modelo: s.indice.modelo, vets });
  return vets;
}

// Modelo usado pela maioria dos salvos (a pergunta precisa usar o mesmo).
export function modeloDosIndices(salvos) {
  const conta = {};
  for (const s of salvos) if (s.indice?.modelo) conta[s.indice.modelo] = (conta[s.indice.modelo] || 0) + 1;
  return Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// Melhores salvos pelo sentido; corta os que ficam bem abaixo do primeiro.
export function rankear(salvos, qv, modelo, { max = 8, piso = 0.3, janela = 0.1 } = {}) {
  const res = [];
  for (const s of salvos) {
    if (s.indice?.modelo !== modelo || !s.indice.vetores?.length) continue;
    let melhor = -1;
    let parte = 0;
    vetoresDo(s).forEach((v, i) => {
      let d = 0;
      for (let k = 0; k < v.length && k < qv.length; k += 1) d += v[k] * qv[k];
      if (d > melhor) { melhor = d; parte = i; }
    });
    res.push({ s, sim: melhor, ref: s.indice.partes[parte] });
  }
  res.sort((a, b) => b.sim - a.sim);
  const topo = res[0]?.sim ?? 0;
  return res.filter((x) => x.sim >= piso && x.sim >= topo - janela).slice(0, max);
}

const NOMES = { transcricao: 'Na transcrição', legenda: 'Na legenda', textoNaTela: 'No texto do vídeo' };
const finos = new Map();

// Trecho para mostrar no cartão: o pedaço refinado pela IA, ou perto da primeira palavra da busca.
export function trechoDe(s, ref, q) {
  const [campo, ini, fim] = String(ref || '').split(':');
  if (!NOMES[campo]) return null;
  const fino = finos.get(`${s.id}|${ref}|${q}`);
  if (fino) return { onde: NOMES[campo], texto: fino };
  const texto = (s[campo] || '').slice(Number(ini), Number(fim));
  const norm = normalizar(texto);
  const pos = termos(q).map((t) => norm.indexOf(t.slice(0, Math.max(4, t.length - 2)))).filter((p) => p >= 0).sort((a, b) => a - b)[0];
  if (pos === undefined) return null;
  const de = Math.max(0, pos - 60);
  const corte = texto.slice(de, de + 170).replace(/\s+/g, ' ').trim();
  return corte ? { onde: NOMES[campo], texto: `${de > 0 ? '…' : ''}${corte}…` } : null;
}

// Janelas curtas do trecho que bateu, para achar a frase exata do assunto.
function janelas(texto) {
  const out = [];
  for (let i = 0; i < texto.length; i += 150) {
    out.push([i, texto.slice(i, i + 220)]);
    if (i + 220 >= texto.length) break;
  }
  return out;
}

// Uma chamada só para os primeiros resultados: compara a pergunta com pedaços de ~220 letras.
export async function refinarTrechos(chave, modelo, qv, q, itens) {
  const pendentes = itens.filter((x) => NOMES[String(x.ref).split(':')[0]] && !finos.has(`${x.s.id}|${x.ref}|${q}`)).slice(0, 6);
  if (!pendentes.length) return false;
  const pedacos = [];
  for (const x of pendentes) {
    const [campo, ini, fim] = x.ref.split(':');
    const texto = (x.s[campo] || '').slice(Number(ini), Number(fim));
    for (const [i, t] of janelas(texto).slice(0, 16)) pedacos.push({ x, texto: t, i, inteiro: texto });
  }
  const vets = await embutir(chave, modelo, pedacos.map((p) => ({ texto: p.texto, titulo: p.x.s.titulo })), false);
  const melhor = new Map();
  pedacos.forEach((p, k) => {
    const v = vets[k] || [];
    const n = Math.hypot(...v) || 1;
    let d = 0;
    for (let j = 0; j < v.length && j < qv.length; j += 1) d += (v[j] / n) * qv[j];
    if (!melhor.has(p.x) || d > melhor.get(p.x).d) melhor.set(p.x, { d, p });
  });
  for (const [x, { p }] of melhor) {
    const meio = p.i > 0;
    const corta = p.i + 220 < p.inteiro.length;
    let c = p.inteiro.slice(p.i, p.i + 220);
    if (meio) c = c.slice(c.indexOf(' ') + 1);
    if (corta && c.lastIndexOf(' ') > 0) c = c.slice(0, c.lastIndexOf(' '));
    finos.set(`${x.s.id}|${x.ref}|${q}`, `${meio ? '…' : ''}${c.replace(/\s+/g, ' ').trim()}${corta ? '…' : ''}`);
  }
  return true;
}

// Indexa em segundo plano, um salvo por vez, sem atrapalhar a leitura dos novos.
export function criarIndexador(obterChave, guardar, aoMudar) {
  let rodando = false;
  let pausaAte = 0;
  let ultimos = [];
  const falhas = new Map();
  async function andar() {
    if (rodando) return;
    rodando = true;
    try {
      for (;;) {
        const chave = obterChave();
        if (!chave || Date.now() < pausaAte) break;
        const s = ultimos.find((x) => precisaIndice(x) && (falhas.get(x.id) || 0) < 3);
        if (!s) break;
        try {
          const indice = await indexar(chave, s);
          s.indice = indice;
          guardar(s.id, indice);
        } catch (e) {
          falhas.set(s.id, (falhas.get(s.id) || 0) + 1);
          // Cota estourada ou sem rede: espera um minuto antes de continuar.
          if (e.status === 429 || !e.status) { pausaAte = Date.now() + 60000; setTimeout(andar, 61000); break; }
        }
        aoMudar?.();
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      rodando = false;
    }
  }
  return {
    entrada(salvos) { ultimos = salvos; andar(); },
    faltam: () => ultimos.filter((s) => precisaIndice(s) && (falhas.get(s.id) || 0) < 3).length,
  };
}
