// Testes rápidos sem navegador: links, busca, conversão do Firestore e ferramentas do MCP (com API falsa).
import assert from 'node:assert/strict';
import { deValor, paraValor } from '../js/firestore-rest.js';
import { conferirBusca, conversar, modeloObsoleto, ultimoModelo } from '../js/gemini.js';
import { extrairUrl, normalizarUrl, plataformaDe, tipoDe } from '../js/link.js';
import { buscar, termos } from '../js/search.js';
import { indexar, modeloDosIndices, partesDo, precisaIndice, rankear, semMarcas, textoDaParte, trechoDaCitacao, trechoDe, vetorDaConsulta } from '../js/semantica.js';
import { criarFerramentas } from '../mcp/tools.mjs';
import { respostaEmbed } from './embed-falso.mjs';

let n = 0;
const ok = (nome, fn) => Promise.resolve(fn()).then(() => { n += 1; console.log(`  ok  ${nome}`); });

await ok('extrai link de texto compartilhado', () => {
  assert.equal(extrairUrl('Olha esse reel https://www.instagram.com/reel/ABC123/?igsh=xyz. top').href, 'https://www.instagram.com/reel/ABC123/?igsh=xyz');
  assert.equal(extrairUrl('sem link'), null);
  assert.equal(extrairUrl('javascript:alert(1)'), null);
});

await ok('normaliza e reconhece plataformas', () => {
  assert.equal(normalizarUrl('https://www.instagram.com/reel/ABC123/?igsh=xyz&utm_source=ig'), 'https://www.instagram.com/reel/ABC123');
  assert.equal(normalizarUrl('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(normalizarUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(plataformaDe('https://vm.tiktok.com/xyz'), 'tiktok');
  assert.equal(plataformaDe('https://twitter.com/a/status/1'), 'x');
  assert.equal(plataformaDe('https://viagem.blog/lisboa'), 'web');
  assert.equal(tipoDe('https://www.instagram.com/reel/x'), 'Reel');
  assert.equal(tipoDe('https://www.youtube.com/shorts/x'), 'Short');
});

const salvos = [
  { id: '1', titulo: 'Espaguete ao limão siciliano', categoria: 'Receita', resumo: 'Massa cremosa com limão e parmesão', criadoEm: 3 },
  { id: '2', titulo: 'Lisboa em 3 dias: o roteiro completo', categoria: 'Lugar', resumo: 'Alfama, Belém e pastéis', criadoEm: 2 },
  { id: '3', titulo: 'Linguine com limão e parmesão', categoria: 'Receita', transcricao: 'hoje vou fazer uma massa rapidinha', criadoEm: 1 },
  { id: '4', titulo: 'Como organizei meu portfólio de design', categoria: 'Carreira e estudos', criadoEm: 4 },
];

await ok('busca como a pessoa lembra (sem acento, palavras vazias, pela metade)', () => {
  assert.deepEqual(termos('aquela massa com limão'), ['massa', 'limao']);
  assert.deepEqual(buscar(salvos, 'aquela massa com limão').map((s) => s.id), ['1', '3']);
  assert.deepEqual(buscar(salvos, 'lisb').map((s) => s.id), ['2']);
  assert.deepEqual(buscar(salvos, 'receitas').map((s) => s.id), ['1', '3']);
  assert.equal(buscar(salvos, '').length, 4);
  assert.equal(buscar(salvos, 'xyz inexistente').length, 0);
});

await ok('converte valores do Firestore nos dois sentidos', () => {
  const dados = { a: 'x', b: 3, c: 1.5, d: true, e: null, f: ['p', 2], g: { h: 'i' } };
  const volta = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, deValor(paraValor(v))]));
  assert.deepEqual(volta, dados);
});

await ok('Gemini: troca sozinho de modelo quando o Google desativa o antigo', async () => {
  const pedidos = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    const resp = (status, corpo) => ({ ok: status === 200, status, json: async () => corpo });
    if (String(url).includes('gemini-2.5')) return resp(404, { error: { message: 'This model models/gemini-2.5-flash-lite is no longer available to new users.' } });
    if (String(url).includes('gemini-3.5-flash-lite')) return resp(400, { error: { message: 'This model is no longer available to new users.' } });
    return resp(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  };
  try {
    assert.equal(modeloObsoleto('gemini-2.5-flash-lite'), true);
    assert.equal(modeloObsoleto('gemini-3.6-flash'), false);
    assert.equal(await conversar({ chave: 'x', modelo: 'gemini-2.5-flash-lite' }, [{ de: 'eu', texto: 'oi' }], []), 'ok');
    assert.equal(ultimoModelo(), 'gemini-3.6-flash');
    assert.ok(!pedidos.some((u) => u.includes('gemini-2.5')), 'não deveria nem tentar o 2.5');
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid.' } }) });
    await assert.rejects(conversar({ chave: 'x' }, [{ de: 'eu', texto: 'oi' }], []), /API key not valid/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await ok('busca por assunto: acha pela transcrição sem as mesmas palavras', async () => {
  const fetchOriginal = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, op) => {
    pedidos.push(String(url));
    if (String(url).includes('gemini-embedding-2')) return { ok: false, status: 404, json: async () => ({ error: { message: 'models/gemini-embedding-2 is not found' } }) };
    if (String(url).includes(':generateContent')) {
      const itens = JSON.parse(op.body).contents[0].parts[0].text.includes('[1] Vídeo da Bia') ? [{ n: 1, motivo: 'Fala de espaguete com limão', trecho: 'raspe a casca do limão siciliano' }] : [];
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ itens }) }] } }] }) };
    }
    return { ok: true, status: 200, json: async () => respostaEmbed(JSON.parse(op.body)) };
  };
  try {
    const longa = `${'[0:00] Bom dia, pessoal. '.repeat(100)}[3:10] Agora o segredo: raspe a casca do limão siciliano por cima do espaguete. ${'[4:00] Valeu! '.repeat(60)}`;
    const docs = [
      { id: 'a', status: 'pronto', titulo: 'Vídeo da Bia', resumo: 'Bate-papo da semana', transcricao: longa, atualizadoEm: 1 },
      { id: 'b', status: 'pronto', titulo: 'Fim de semana', resumo: 'Roteiro por Lisboa e Belém', atualizadoEm: 1 },
      { id: 'c', status: 'pendente', titulo: 'Lendo', atualizadoEm: 1 },
    ];
    assert.ok(partesDo(docs[0]).length > 2, 'transcrição longa vira vários trechos');
    assert.equal(precisaIndice(docs[0]), true);
    assert.equal(precisaIndice(docs[2]), false);
    for (const d of docs.slice(0, 2)) d.indice = await indexar('x', d);
    assert.equal(docs[0].indice.modelo, 'gemini-embedding-001', 'cai para o modelo antigo se o novo não existir');
    assert.equal(precisaIndice(docs[0]), false);
    assert.equal(modeloDosIndices(docs), 'gemini-embedding-001');
    assert.equal(buscar(docs, 'macarrão cítrico').length, 0, 'por palavra não acha');
    const qv = await vetorDaConsulta('x', 'macarrão cítrico', 'gemini-embedding-001');
    const r = rankear(docs, qv, 'gemini-embedding-001');
    assert.deepEqual(r.map((x) => x.s.id), ['a']);
    const t0 = trechoDe(docs[0], r[0].ref, 'macarrão cítrico');
    assert.equal(t0, null, 'sem palavra igual não inventa trecho');
    const candidatos = rankear(docs, qv, 'gemini-embedding-001', { piso: 0.15, janela: 0.35 }).map((x) => ({ ...x, ...textoDaParte(x.s, x.ref) }));
    const conferidos = await conferirBusca({ chave: 'x', modelo: 'gemini-3.6-flash' }, 'macarrão cítrico', candidatos);
    assert.deepEqual(conferidos.map((x) => x.s.id), ['a']);
    const t = trechoDaCitacao(docs[0], conferidos[0].citacao);
    assert.equal(t.onde, 'Na transcrição');
    assert.equal(t.minuto.rotulo, '3:10');
    assert.equal(t.minuto.seg, 190);
    assert.match(t.texto, /limão siciliano/);
    assert.equal(semMarcas('[0:01] oi [1:02:03] tchau'), 'oi tchau');
    docs[0].resumo = 'mudou';
    docs[0].atualizadoEm = 2;
    assert.equal(precisaIndice(docs[0]), true, 'texto mudou: refaz o índice');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await ok('ferramentas do MCP: busca, pasta, guardar e adicionar', async () => {
  const banco = { saves: salvos.map((s) => ({ ...s, url: `https://x.com/a/status/${s.id}`, pastas: s.categoria === 'Receita' ? ['p1'] : [] })), folders: [{ id: 'p1', nome: 'Receitas' }] };
  let seq = 0;
  const api = {
    listar: async (c) => banco[c].map((x) => ({ ...x })),
    ler: async (c, id) => banco[c].find((x) => x.id === id) || null,
    criar: async (c, d) => { const x = { id: `novo${++seq}`, ...d }; banco[c].push(x); return x; },
    atualizar: async (c, id, d) => Object.assign(banco[c].find((x) => x.id === id), d),
  };
  const t = criarFerramentas(api);
  assert.deepEqual((await t.search_saves({ query: 'massa limão' })).resultados.map((r) => r.id), ['1', '3']);
  const pasta = await t.get_folder({ name: 'receitas' });
  assert.equal(pasta.pasta, 'Receitas');
  assert.equal(pasta.itens.length, 2);
  assert.equal(pasta.itens[1].transcricao, 'hoje vou fazer uma massa rapidinha');
  const novo = await t.save_link({ url: 'https://www.youtube.com/watch?v=abc&si=1', folder: 'Vídeos' });
  assert.ok(novo.id);
  assert.equal(banco.saves.at(-1).url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(banco.saves.at(-1).status, 'pendente');
  assert.equal(banco.folders.at(-1).nome, 'Vídeos');
  assert.equal((await t.save_link({ url: 'https://www.youtube.com/watch?v=abc' })).jaExistia, true);
  assert.equal((await t.add_to_folder({ save_ids: ['2', '4'], folder: 'Receitas' })).adicionados, 2);
  assert.equal((await t.list_folders()).find((p) => p.nome === 'Receitas').itens, 4);
  await assert.rejects(t.get_folder({ name: 'nada' }), /não existe/);
});

console.log(`\n${n} testes passaram`);
