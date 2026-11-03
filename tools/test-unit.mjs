// Testes rápidos sem navegador: links, busca, conversão do Firestore e ferramentas do MCP (com API falsa).
import assert from 'node:assert/strict';
import { deValor, paraValor } from '../js/firestore-rest.js';
import { extrairUrl, normalizarUrl, plataformaDe, tipoDe } from '../js/link.js';
import { buscar, termos } from '../js/search.js';
import { criarFerramentas } from '../mcp/tools.mjs';

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
