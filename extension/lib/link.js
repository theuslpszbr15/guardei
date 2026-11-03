// Reconhece links das redes e busca metadados públicos (título, autor, capa) sem servidor próprio.

const PLATAFORMAS = [
  { id: 'instagram', nome: 'Instagram', hosts: ['instagram.com'] },
  { id: 'tiktok', nome: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'youtube', nome: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'x', nome: 'X', hosts: ['x.com', 'twitter.com'] },
  { id: 'linkedin', nome: 'LinkedIn', hosts: ['linkedin.com', 'lnkd.in'] },
];

export const nomePlataforma = (id) => PLATAFORMAS.find((p) => p.id === id)?.nome || 'Site';

// Textos compartilhados pelo celular vêm como "Olha isso https://..." — pega o primeiro link http(s).
export function extrairUrl(texto = '') {
  const m = String(texto).match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[),.;!?]+$/, ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function plataformaDe(url) {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
  return PLATAFORMAS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)))?.id || 'web';
}

export function tipoDe(url) {
  const { pathname, hostname } = new URL(url);
  const p = plataformaDe(url);
  if (p === 'instagram') return pathname.startsWith('/reel') ? 'Reel' : 'Post';
  if (p === 'tiktok') return 'Vídeo';
  if (p === 'youtube') return pathname.startsWith('/shorts') ? 'Short' : 'Vídeo';
  if (p === 'x') return 'Post';
  if (p === 'linkedin') return 'Post';
  return hostname.includes('blog') || /\/(blog|artigo|article|news|noticia)/i.test(pathname) ? 'Artigo' : 'Página';
}

// Remove rastreadores para o mesmo post não ser salvo duas vezes.
export function normalizarUrl(url) {
  const u = new URL(url);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|igsh|igshid|si$|feature$|trk|rcm|fbclid|gclid|s$|t$|ref$|ref_src|_r$|is_from_webapp|sender_device)/i.test(k)) u.searchParams.delete(k);
  }
  if (u.hostname === 'youtu.be') return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
  return u.toString().replace(/\/$/, '');
}

async function json(url, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const arroba = (urlAutor = '') => {
  const m = urlAutor.match(/\/(@[^/?#]+)/);
  return m ? m[1] : '';
};

export async function buscarMetadados(url) {
  const plataforma = plataformaDe(url);
  const meta = { plataforma, tipo: tipoDe(url), titulo: '', autor: '', capa: '', descricao: '' };
  const enc = encodeURIComponent(url);

  if (plataforma === 'youtube') {
    const o = await json(`https://www.youtube.com/oembed?format=json&url=${enc}`);
    if (o) Object.assign(meta, { titulo: o.title, autor: arroba(o.author_url) || o.author_name, capa: o.thumbnail_url?.replace('hqdefault', 'maxresdefault') || '' });
    const id = new URL(url).searchParams.get('v') || new URL(url).pathname.split('/').pop();
    if (!meta.capa && id) meta.capa = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } else if (plataforma === 'tiktok') {
    const o = await json(`https://www.tiktok.com/oembed?url=${enc}`);
    if (o) Object.assign(meta, { titulo: o.title, descricao: o.title, autor: o.author_unique_id ? `@${o.author_unique_id}` : o.author_name, capa: o.thumbnail_url || '' });
  }

  if (!meta.titulo || !meta.capa) {
    const m = await json(`https://api.microlink.io/?url=${enc}`, 10000);
    const d = m?.status === 'success' ? m.data : null;
    if (d) {
      meta.titulo ||= d.title || '';
      meta.descricao ||= d.description || '';
      meta.autor ||= d.author || d.publisher || '';
      meta.capa ||= d.image?.url || d.logo?.url || '';
    }
  }
  if (!meta.autor && plataforma === 'web') meta.autor = new URL(url).hostname.replace(/^www\./, '');
  return meta;
}
