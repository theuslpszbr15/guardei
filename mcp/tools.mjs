// Ferramentas do MCP (independentes do protocolo, para poder testar direto).
import { normalizarUrl, extrairUrl, plataformaDe, tipoDe } from '../js/link.js';
import { buscar, normalizar } from '../js/search.js';

const resumoCurto = (s) => ({
  id: s.id,
  titulo: s.titulo || s.tituloOriginal || s.url,
  categoria: s.categoria || '',
  plataforma: s.plataforma,
  autor: s.autor || '',
  url: s.url,
  resumo: s.resumo || '',
  verDepois: !!s.verDepois,
  guardadoEm: s.criadoEm ? new Date(s.criadoEm).toISOString().slice(0, 10) : '',
  status: s.status,
});

const completo = (s, pastas) => ({
  ...resumoCurto(s),
  legenda: s.legenda || '',
  transcricao: s.transcricao || '',
  textoNaTela: s.textoNaTela || '',
  nota: s.nota || '',
  tags: s.tags || [],
  pastas: pastas.filter((p) => s.pastas?.includes(p.id)).map((p) => p.nome),
});

export function criarFerramentas(api) {
  let cache = null;
  async function dados(forcar = false) {
    if (!cache || forcar || Date.now() - cache.t > 30000) {
      const [salvos, pastas] = await Promise.all([api.listar('saves'), api.listar('folders')]);
      salvos.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      cache = { salvos, pastas, t: Date.now() };
    }
    return cache;
  }
  const acharPasta = (pastas, nome) => {
    const n = normalizar(nome).trim();
    return pastas.find((p) => p.id === nome) || pastas.find((p) => normalizar(p.nome) === n) || pastas.find((p) => normalizar(p.nome).includes(n));
  };

  return {
    async search_saves({ query = '', category, limit = 10 }) {
      const { salvos } = await dados();
      let lista = category ? salvos.filter((s) => normalizar(s.categoria) === normalizar(category)) : salvos;
      lista = buscar(lista, query, Math.min(limit, 50));
      return { total: lista.length, resultados: lista.map(resumoCurto) };
    },
    async recent_saves({ limit = 10 }) {
      const { salvos } = await dados();
      return salvos.slice(0, Math.min(limit, 50)).map(resumoCurto);
    },
    async get_save({ id }) {
      const { salvos, pastas } = await dados();
      const s = salvos.find((x) => x.id === id) || (await api.ler('saves', id));
      if (!s) throw new Error(`Salvo ${id} não encontrado`);
      return completo(s, pastas);
    },
    async list_folders() {
      const { salvos, pastas } = await dados();
      return pastas.map((p) => ({ id: p.id, nome: p.nome, itens: salvos.filter((s) => s.pastas?.includes(p.id)).length }));
    },
    async get_folder({ name }) {
      const { salvos, pastas } = await dados();
      const p = acharPasta(pastas, name);
      if (!p) throw new Error(`Pasta "${name}" não existe. Pastas: ${pastas.map((x) => x.nome).join(', ') || '(nenhuma)'}`);
      const itens = salvos.filter((s) => s.pastas?.includes(p.id)).map((s) => completo(s, pastas));
      return { pasta: p.nome, itens };
    },
    async save_link({ url, folder }) {
      const u = extrairUrl(url);
      if (!u) throw new Error('Link inválido (precisa começar com http:// ou https://)');
      const limpo = normalizarUrl(u.href);
      const { salvos, pastas } = await dados(true);
      const ja = salvos.find((s) => s.url === limpo);
      let pastaIds = [];
      if (folder) {
        let p = acharPasta(pastas, folder);
        if (!p) p = await api.criar('folders', { nome: folder.slice(0, 60), criadoEm: Date.now() });
        pastaIds = [p.id];
      }
      if (ja) {
        if (pastaIds.length && !ja.pastas?.includes(pastaIds[0])) await api.atualizar('saves', ja.id, { pastas: [...(ja.pastas || []), pastaIds[0]] });
        cache = null;
        return { id: ja.id, jaExistia: true };
      }
      const agora = Date.now();
      const novo = await api.criar('saves', {
        url: limpo, plataforma: plataformaDe(limpo), tipo: tipoDe(limpo), titulo: '', pastas: pastaIds, verDepois: false, visto: false, nota: '',
        status: 'pendente', origem: 'mcp', criadoEm: agora, atualizadoEm: agora,
      });
      cache = null;
      return { id: novo.id, aviso: 'Guardado. O resumo e a transcrição aparecem quando o app Guardei abrir e ler o link.' };
    },
    async create_folder({ name }) {
      const { pastas } = await dados(true);
      const ja = acharPasta(pastas, name);
      if (ja && normalizar(ja.nome) === normalizar(name)) return { id: ja.id, nome: ja.nome, jaExistia: true };
      const p = await api.criar('folders', { nome: name.trim().slice(0, 60), criadoEm: Date.now() });
      cache = null;
      return { id: p.id, nome: p.nome };
    },
    async add_to_folder({ save_ids, folder }) {
      const { salvos, pastas } = await dados(true);
      let p = acharPasta(pastas, folder);
      if (!p) p = await api.criar('folders', { nome: folder.trim().slice(0, 60), criadoEm: Date.now() });
      let n = 0;
      for (const id of save_ids) {
        const s = salvos.find((x) => x.id === id);
        if (!s || s.pastas?.includes(p.id)) continue;
        await api.atualizar('saves', id, { pastas: [...(s.pastas || []), p.id], atualizadoEm: Date.now() });
        n += 1;
      }
      cache = null;
      return { pasta: p.nome, adicionados: n };
    },
  };
}
