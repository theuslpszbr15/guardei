// Busca "como você lembra": ignora acentos, palavras vazias e aceita palavras pela metade.

const VAZIAS = new Set(('a o as os um uma uns umas de da do das dos e em no na nos nas com por para pra pro que se ' +
  'aquela aquele aquilo esse essa isso este esta isto eu me meu minha voce você tinha tem foi era ser sobre como ' +
  'mais muito ja já the of and to in on for with is that this video vídeo post').split(' '));

export const normalizar = (t = '') => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function termos(consulta) {
  return normalizar(consulta).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !VAZIAS.has(t));
}

const PESOS = [
  ['titulo', 6], ['categoria', 4], ['resumo', 3], ['nota', 3], ['autor', 3], ['legenda', 2], ['textoNaTela', 1.5], ['visual', 1.5], ['transcricao', 1],
];

// Plural/singular simples: "receitas" acha "receita" e vice-versa.
const raiz = (t) => (t.length > 4 ? t.replace(/(oes|aes|ns|es|s)$/, '') : t);

export function pontuar(salvo, lista) {
  let total = 0;
  let achados = 0;
  for (const t of lista) {
    const r = raiz(t);
    let melhor = 0;
    for (const [campo, peso] of PESOS) {
      const txt = normalizar(salvo[campo]);
      if (!txt) continue;
      const palavra = new RegExp(`(^|[^a-z0-9])${r}`);
      if (palavra.test(txt)) melhor = Math.max(melhor, peso * (txt.includes(t) ? 1 : 0.8));
    }
    if (melhor) achados += 1;
    total += melhor;
  }
  if (!achados) return 0;
  return total * (achados / lista.length) ** 2;
}

export function buscar(salvos, consulta, limite = Infinity) {
  const lista = termos(consulta);
  if (!lista.length) return salvos.slice(0, limite);
  return salvos
    .map((s) => ({ s, p: pontuar(s, lista) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || (b.s.criadoEm || 0) - (a.s.criadoEm || 0))
    .slice(0, limite)
    .map((x) => x.s);
}
