// IA do app via Gemini (chave do próprio usuário). Lê o link, resume, classifica e responde no chat.
import { CATEGORIAS, GEMINI_MODELOS } from './config.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Modelos 1.x/2.x não aceitam mais contas novas; nesses casos usamos os atuais.
export const modeloObsoleto = (m) => !m || /^(models\/)?gemini-[12]\./.test(m);
const indisponivel = (status, msg) => status === 404 || /no longer available|not found|not supported|deprecated|is not available/i.test(msg);
let modeloEmUso = '';
export const ultimoModelo = () => modeloEmUso;

async function postar(url, chave, corpo, extra = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave, ...extra },
    body: JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(dados.error?.message || `Gemini respondeu ${r.status}`);
    e.indisponivel = indisponivel(r.status, e.message);
    throw e;
  }
  return dados;
}

async function viaGenerateContent(modelo, { chave, partes, ferramentas, sistema, temperatura }) {
  const corpo = { contents: [{ role: 'user', parts: partes }], generationConfig: { temperature: temperatura } };
  if (sistema) corpo.systemInstruction = { parts: [{ text: sistema }] };
  if (ferramentas) corpo.tools = ferramentas;
  const d = await postar(`${BASE}/models/${encodeURIComponent(modelo)}:generateContent`, chave, corpo);
  return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// API nova (Interactions), usada se o generateContent não aceitar nenhum modelo.
async function viaInteractions(modelo, { chave, partes, sistema }) {
  const texto = [sistema, ...partes.map((p) => p.text || (p.fileData ? `Vídeo: ${p.fileData.fileUri}` : ''))].filter(Boolean).join('\n\n');
  const d = await postar(`${BASE}/interactions`, chave, { model: modelo, input: texto, store: false }, { 'Api-Revision': '2026-05-20' });
  return (d.output_text || (d.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || [])
    .filter((c) => c.type === 'text').map((c) => c.text).join('')).trim();
}

async function gerar({ chave, modelo, partes, ferramentas, sistema, temperatura = 0.3 }) {
  const args = { chave, partes, ferramentas, sistema, temperatura };
  const modelos = [...new Set([modeloObsoleto(modelo) ? '' : modelo, ...GEMINI_MODELOS].filter(Boolean))];
  let erro;
  for (const m of modelos) {
    try {
      const r = await viaGenerateContent(m, args);
      modeloEmUso = m;
      return r;
    } catch (e) {
      erro = e;
      if (!e.indisponivel) throw e;
    }
  }
  try {
    const r = await viaInteractions(modelos[0], args);
    modeloEmUso = modelos[0];
    return r;
  } catch {
    throw erro;
  }
}

export function lerJson(texto) {
  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (ini < 0 || fim < ini) throw new Error('A IA não devolveu JSON');
  return JSON.parse(texto.slice(ini, fim + 1));
}

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const listaTags = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').slice(0, 8).map((t) => t.toLowerCase().slice(0, 30)) : []);
const PEDIDO_TRANSCRICAO = 'transcrição da fala, no idioma falado, com a minutagem [m:ss] no começo de cada frase ou trecho (ex.: \\"[0:00] Oi gente... [0:12] Agora...\\")';
const PEDIDO_VISUAL = 'o que aparece visualmente: lugar, cores, pessoas, objetos, comida, roupas (1 a 3 frases)';

// Vídeo do YouTube vai direto como vídeo (o Gemini assiste e transcreve); o resto é lido pela ferramenta url_context.
export async function enriquecer({ chave, modelo }, salvo) {
  const youtube = salvo.plataforma === 'youtube';
  const pedido = `Você organiza conteúdos salvos por uma pessoa brasileira.
Link: ${salvo.url}
Plataforma: ${salvo.plataforma} (${salvo.tipo})
Título original: ${salvo.tituloOriginal || '(desconhecido)'}
Autor: ${salvo.autor || '(desconhecido)'}
Legenda/descrição conhecida: ${(salvo.legenda || '').slice(0, 3000) || '(nenhuma)'}
${salvo.capa ? `Imagem de capa: ${salvo.capa}` : ''}

${youtube ? 'Assista ao vídeo anexado.' : 'Abra o link (e a imagem de capa) para ler o conteúdo, se conseguir.'}
Responda SOMENTE um JSON com:
{"titulo": "título curto e descritivo em português, até 70 caracteres, do que a pessoa vai querer lembrar (ex.: \\"Espaguete ao limão siciliano\\")",
 "resumo": "2 a 4 frases em português dizendo o que é e o que tem de útil (ingredientes, lugares, passos, nomes)",
 "categoria": "uma de: ${CATEGORIAS.join(', ')}",
 "legenda": "texto/legenda original do post, se encontrar (pode ficar vazio)",
 "transcricao": "${youtube ? PEDIDO_TRANSCRICAO : `${PEDIDO_TRANSCRICAO}, se houver vídeo acessível; senão vazio`}",
 "textoNaTela": "textos que aparecem escritos nas imagens/vídeo, se houver",
 "visual": "${PEDIDO_VISUAL}; vazio se não der para ver",
 "tags": ["3 a 6 palavras-chave em português, minúsculas"]}
Se não conseguir abrir o link, use só as informações acima e não invente detalhes.`;

  const partes = youtube
    ? [{ fileData: { fileUri: salvo.url, mimeType: 'video/*' } }, { text: pedido }]
    : [{ text: pedido }];
  let bruto;
  try {
    bruto = await gerar({ chave, modelo, partes, ferramentas: youtube ? undefined : [{ url_context: {} }] });
  } catch {
    // Vídeo longo/privado ou ferramenta indisponível: tenta de novo só com o texto.
    bruto = await gerar({ chave, modelo, partes: [{ text: pedido }] });
  }
  const j = lerJson(bruto);
  return {
    titulo: texto(j.titulo, 120),
    resumo: texto(j.resumo, 1200),
    categoria: CATEGORIAS.includes(j.categoria) ? j.categoria : 'Outro',
    legenda: texto(j.legenda, 6000),
    transcricao: texto(j.transcricao, 40000),
    textoNaTela: texto(j.textoNaTela, 6000),
    visual: texto(j.visual, 800),
    tags: listaTags(j.tags),
  };
}

// Vídeo enviado do aparelho (Reels/TikTok baixados): o Gemini ouve, lê a tela e descreve o que aparece.
export async function transcreverVideo({ chave, modelo }, salvo, { base64, mime }) {
  const pedido = `Este é o vídeo de um post salvo: "${salvo.titulo || salvo.url}".
Responda SOMENTE um JSON com:
{"transcricao": "${PEDIDO_TRANSCRICAO}; vazio se não houver fala",
 "textoNaTela": "textos escritos que aparecem no vídeo",
 "visual": "${PEDIDO_VISUAL}",
 "resumo": "2 a 4 frases em português dizendo o que é e o que tem de útil",
 "tags": ["3 a 6 palavras-chave em português, minúsculas"]}`;
  const bruto = await gerar({ chave, modelo, partes: [{ inlineData: { mimeType: mime || 'video/mp4', data: base64 } }, { text: pedido }] });
  const j = lerJson(bruto);
  return { transcricao: texto(j.transcricao, 40000), textoNaTela: texto(j.textoNaTela, 6000), visual: texto(j.visual, 800), resumo: texto(j.resumo, 1200), tags: listaTags(j.tags) };
}

// Confere os candidatos da busca por assunto: só fica o que realmente fala do que a pessoa procurou.
export async function conferirBusca({ chave, modelo }, consulta, candidatos) {
  const lista = candidatos.map((c, i) => `[${i + 1}] ${c.s.titulo || c.s.url} — ${c.s.categoria || ''} — ${c.s.autor || ''}
Resumo: ${(c.s.resumo || c.s.legenda || '').slice(0, 400)}
${c.s.visual ? `Visual: ${c.s.visual.slice(0, 300)}\n` : ''}${c.texto ? `Trecho (${c.onde}): ${c.texto.slice(0, 1400)}` : ''}`).join('\n\n');
  const pedido = `A pessoa procurou nos salvos dela: "${consulta}"

Candidatos:
${lista}

Responda SOMENTE um JSON {"itens": [{"n": número, "motivo": "frase curta em português dizendo por que tem a ver", "trecho": "citação exata e curta (até 160 caracteres) do trecho onde fala disso, ou vazio"}]}
com SOMENTE os candidatos que realmente têm a ver com a busca, do mais ao menos relevante. Se nenhum tiver, responda {"itens": []}.`;
  const j = lerJson(await gerar({ chave, modelo, partes: [{ text: pedido }], temperatura: 0 }));
  return (Array.isArray(j.itens) ? j.itens : [])
    .filter((x) => Number.isInteger(x?.n) && candidatos[x.n - 1])
    .map((x) => ({ ...candidatos[x.n - 1], motivo: texto(x.motivo, 200), citacao: texto(x.trecho, 240) }));
}

// Chat: manda os salvos mais parecidos com a pergunta como contexto numerado [1], [2]...
export async function conversar({ chave, modelo }, historico, contexto) {
  const fontes = contexto.map((s, i) => `[${i + 1}] ${s.titulo} — ${s.categoria || ''} — ${s.autor || ''} (${s.url})
Resumo: ${s.resumo || s.legenda || ''}
${s.transcricao ? `Transcrição: ${s.transcricao.slice(0, 2500)}` : ''}
${s.textoNaTela ? `Texto na tela: ${s.textoNaTela.slice(0, 800)}` : ''}${s.nota ? `\nNota da pessoa: ${s.nota}` : ''}`).join('\n\n');
  const conversa = historico.map((m) => `${m.de === 'eu' ? 'Pessoa' : 'Assistente'}: ${m.texto}`).join('\n');
  const sistema = `Você é o assistente do Guardei, um app onde a pessoa guarda posts, vídeos e links.
Responda em português do Brasil, direto e útil, usando SOMENTE os salvos abaixo. Cite as fontes com [n].
Se nada nos salvos responde, diga isso com honestidade. Pode montar listas, tabelas em texto, roteiros e listas de compras.

SALVOS:
${fontes || '(nenhum salvo relacionado)'}`;
  return gerar({ chave, modelo, sistema, partes: [{ text: conversa }], temperatura: 0.5 });
}
