// Embedding falso para testes: vetor por "assuntos" (sinônimos caem no mesmo eixo), sem chamar o Google.
import { normalizar } from '../js/search.js';

const ASSUNTOS = [
  ['espaguete', 'macarrao', 'massa', 'linguine', 'limao', 'citrico', 'parmesao', 'cozinha', 'receita'],
  ['lisboa', 'portugal', 'roteiro', 'viagem', 'belem', 'alfama', 'europa'],
  ['treino', 'academia', 'exercicio', 'musculacao'],
];

export function vetorFalso(texto) {
  const v = new Array(256).fill(0);
  v[255] = 0.05;
  for (const p of normalizar(texto).split(/[^a-z0-9]+/)) {
    ASSUNTOS.forEach((lista, i) => { if (lista.some((a) => p.startsWith(a))) v[i] += 1; });
  }
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

export const respostaEmbed = (corpo) => ({ embeddings: (corpo.requests || []).map((r) => ({ values: vetorFalso(r.content.parts.map((p) => p.text).join(' ')) })) });
