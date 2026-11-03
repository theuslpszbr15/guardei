// Leitura de um salvo: metadados públicos -> IA (se houver chave) -> pronto.
import { LENDO_MAX_MS, atualizarSalvo, reservarProcessamento } from './cloud.js';
import { enriquecer } from './gemini.js';
import { buscarMetadados } from './link.js';
import { normalizar } from './search.js';

// Sem IA: categoria por palavras-chave, para o filtro já funcionar.
const PISTAS = [
  ['Receita', 'receita ingrediente forno bolo massa molho cozinha frango doce sobremesa air fryer'],
  ['Restaurante', 'restaurante cafe cafeteria bar pizzaria hamburguer comer brunch'],
  ['Lugar', 'viagem roteiro praia cidade hotel trilha turismo dias em'],
  ['Treino', 'treino exercicio academia musculacao alongamento corrida yoga'],
  ['Filmes e séries', 'filme serie netflix temporada cinema'],
  ['Tecnologia', 'iphone android app ia codigo programacao software computador'],
  ['Finanças', 'dinheiro investimento renda financas economizar cartao'],
  ['Música', 'musica clipe album cantor show official video'],
  ['Carreira e estudos', 'carreira estudo curso portfolio entrevista linkedin trabalho'],
  ['Livro', 'livro leitura autor'],
  ['Humor', 'meme engracado humor piada'],
];

export function categoriaPorPalavras(texto) {
  const t = normalizar(texto);
  let melhor = ['Outro', 0];
  for (const [cat, pistas] of PISTAS) {
    const n = pistas.split(' ').filter((p) => new RegExp(`(^|\\W)${p}`).test(t)).length;
    if (n > melhor[1]) melhor = [cat, n];
  }
  return melhor[0];
}

export async function processar(uid, salvo, ia) {
  const reserva = await reservarProcessamento(uid, salvo.id);
  if (reserva !== 'ok') return reserva;
  try {
    const meta = await buscarMetadados(salvo.url);
    const base = {
      plataforma: meta.plataforma,
      tipo: meta.tipo,
      tituloOriginal: salvo.tituloOriginal || meta.titulo,
      autor: salvo.autor || meta.autor,
      capa: salvo.capa || meta.capa,
      legenda: salvo.legenda || meta.descricao,
    };
    let extra = {};
    if (ia?.chave) {
      try {
        extra = await enriquecer(ia, { ...salvo, ...base });
      } catch (e) {
        extra = { avisoIa: String(e.message || e).slice(0, 200) };
      }
    }
    const legenda = extra.legenda || base.legenda || '';
    const titulo = extra.titulo || base.tituloOriginal || legenda.slice(0, 80) || new URL(salvo.url).hostname;
    await atualizarSalvo(uid, salvo.id, {
      ...base,
      ...extra,
      legenda,
      titulo,
      resumo: extra.resumo || base.legenda?.slice(0, 400) || '',
      categoria: salvo.categoriaManual ? salvo.categoria : extra.categoria || categoriaPorPalavras(`${titulo} ${legenda}`),
      status: 'pronto',
      erro: '',
    });
  } catch (e) {
    await atualizarSalvo(uid, salvo.id, { status: 'erro', erro: String(e.message || e).slice(0, 200) });
  }
}

// Fila simples: um salvo por vez, para não estourar a cota grátis da IA.
export function criarFila(uid, obterIa) {
  const vistos = new Set();
  let rodando = false;
  let ultimos = [];
  const fila = [];
  async function andar() {
    if (rodando) return;
    rodando = true;
    while (fila.length) {
      const s = fila.shift();
      const chave = `${s.id}:${s.atualizadoEm}`;
      try {
        // Salvo recém-criado ainda sem confirmação do servidor: tenta de novo em instantes.
        if ((await processar(uid, s, obterIa())) === 'sumiu') {
          vistos.delete(chave);
          setTimeout(() => entrada(ultimos), 3000);
        }
      } catch {
        // Sem internet: a reserva falha; tenta de novo daqui a pouco.
        vistos.delete(chave);
        setTimeout(() => entrada(ultimos), 30000);
      }
    }
    rodando = false;
  }
  const entrada = (salvos) => {
    ultimos = salvos;
    for (const s of salvos) {
      const travado = s.status === 'lendo' && Date.now() - (s.lendoDesde || 0) > LENDO_MAX_MS;
      const chave = `${s.id}:${s.atualizadoEm}${travado ? ':travado' : ''}`;
      if ((s.status === 'pendente' || travado) && !vistos.has(chave)) {
        vistos.add(chave);
        fila.push(s);
      }
    }
    andar();
  };
  // App fechado no meio da leitura deixa o salvo "lendo"; a cada minuto procura os travados.
  setInterval(() => entrada(ultimos), 60000);
  return entrada;
}
