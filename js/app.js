// Guardei: guarda posts, vídeos e links de qualquer lugar, organiza com IA e acha do jeito que você lembra.
import * as nuvem from './cloud.js';
import { CATEGORIAS, GEMINI_MODELOS, GEMINI_MODELO_PADRAO, usuarioDe } from './config.js';
import { conversar, modeloObsoleto, ultimoModelo } from './gemini.js';
import { iconeCategoria } from './icons.js';
import { extrairUrl, nomePlataforma, normalizarUrl, plataformaDe, tipoDe } from './link.js';
import { criarFila } from './pipeline.js';
import { qrSvg } from './qr.js';
import { buscar, normalizar, termos } from './search.js';
import { criarIndexador, modeloDosIndices, rankear, refinarTrechos, trechoDe, vetorDaConsulta } from './semantica.js';
import { botao, confirmar, copiar, dia, folha, h, ic, menu, toast } from './ui.js';

const raiz = document.getElementById('app');
const est = {
  user: null,
  salvos: [],
  pastas: [],
  ajustes: {},
  q: '',
  verDepois: false,
  categoria: '',
  filtros: false,
  selecao: null,
  carregado: false,
  vista: null,
  chat: [],
  sync: { pendentes: 0, doCache: true },
};
const ia = () => (est.ajustes.geminiKey ? { chave: est.ajustes.geminiKey, modelo: est.ajustes.modelo || GEMINI_MODELO_PADRAO } : null);

// ---------- Tema ----------
function aplicarTema(t = localStorage.getItem('guardei:tema') || 'sistema') {
  if (t === 'sistema') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = t;
  const escuro = t === 'escuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#000000' : '#f2f2f2');
}
aplicarTema();

// ---------- Link compartilhado (menu Compartilhar do Android, favorito ou extensão) ----------
const params = new URLSearchParams(location.search);
const compartilhado = ['share_url', 'share_text', 'share_title'].map((k) => params.get(k) || '').join(' ').trim();
if (compartilhado) {
  sessionStorage.setItem('guardei:compartilhado', JSON.stringify({ texto: compartilhado, legenda: params.get('share_text') || '' }));
  history.replaceState(null, '', location.pathname + location.hash);
}

const marca = () => h('img', { class: 'marca-logo', src: 'icons/marca.svg', alt: '', width: 30, height: 30 });

// ---------- Login ----------
function telaLogin() {
  let criando = false;
  const erro = h('p', { class: 'erro', role: 'alert' });
  const nome = h('input', { name: 'nome', autocomplete: 'name', placeholder: 'Seu nome', 'aria-label': 'Nome' });
  const linhaNome = h('label', { class: 'grupo-linha', hidden: true }, nome);
  const email = h('input', { name: 'email', type: 'email', inputmode: 'email', autocomplete: 'email', required: true, placeholder: 'E-mail', 'aria-label': 'E-mail', autocapitalize: 'none', spellcheck: 'false' });
  const senha = h('input', { name: 'senha', type: 'password', autocomplete: 'current-password', required: true, minlength: 6, placeholder: 'Senha', 'aria-label': 'Senha' });
  const enviar = h('button', { type: 'submit', class: 'btn btn-pri btn-largo' }, 'Entrar');
  const alternar = h('button', { type: 'button', class: 'btn-link' }, 'Criar conta');
  const dica = h('span', {}, 'Ainda não tem conta? ');
  const modo = (criar) => {
    criando = criar;
    linhaNome.hidden = !criar;
    enviar.textContent = criar ? 'Criar conta' : 'Entrar';
    alternar.textContent = criar ? 'Entrar' : 'Criar conta';
    dica.textContent = criar ? 'Já tem conta? ' : 'Ainda não tem conta? ';
    senha.autocomplete = criar ? 'new-password' : 'current-password';
  };
  alternar.onclick = () => {
    erro.textContent = '';
    modo(!criando);
  };
  const form = h('form', { class: 'login-form', novalidate: true },
    h('div', { class: 'grupo' }, linhaNome, h('label', { class: 'grupo-linha' }, email), h('label', { class: 'grupo-linha' }, senha)),
    erro, enviar,
    h('p', { class: 'mudo pequeno centro' }, dica, alternar));
  form.onsubmit = async (e) => {
    e.preventDefault();
    erro.textContent = '';
    const valor = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor)) {
      erro.textContent = 'Digite o e-mail completo da sua conta (ex.: voce@gmail.com).';
      email.focus();
      return;
    }
    if (senha.value.length < 6) {
      erro.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
      return;
    }
    enviar.disabled = true;
    try {
      const user = criando ? await nuvem.cadastrar(valor, senha.value, nome.value.trim()) : await nuvem.entrar(valor, senha.value);
      iniciar(user);
    } catch (err) {
      const c = err.code || '';
      if (c.includes('email-already')) {
        modo(false);
        erro.textContent = `Já existe uma conta com ${valor}. Digite a senha dela para entrar.`;
      } else if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) {
        erro.textContent = `Não achamos uma conta com ${valor} e essa senha. Confira o e-mail e a senha, ou toque em Criar conta.`;
      } else {
        erro.textContent = c.includes('invalid-email') ? 'Esse e-mail não é válido.'
          : c.includes('weak-password') ? 'Senha fraca: use pelo menos 6 caracteres.'
            : c.includes('too-many-requests') ? 'Muitas tentativas. Espere um pouco e tente de novo.'
              : c.includes('network') ? 'Sem conexão com a internet.' : 'Não deu para entrar agora. Tente de novo.';
      }
    } finally {
      enviar.disabled = false;
    }
  };
  raiz.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-caixa' },
      h('div', { class: 'login-marca' }, marca(), h('span', {}, 'Guardei')),
      h('h1', {}, 'Pare de perder o que você salva.'),
      h('p', { class: 'mudo' }, 'Cada Reel, TikTok, post e página que você compartilha fica guardado e fácil de achar.'),
      form)));
}

// ---------- Casca do app ----------
const NAV = [
  { rota: 'salvos', rotulo: 'Início', icone: 'inicio' },
  { rota: 'pastas', rotulo: 'Pastas', icone: 'pastas' },
  { rota: 'mapa', rotulo: 'Mapa', icone: 'mapa' },
  { rota: 'buscar', rotulo: 'Buscar', icone: 'buscar' },
  { rota: 'chat', rotulo: 'Conversa', icone: 'chat' },
];
let principal;

function montarCasca() {
  const nome = est.user.displayName || usuarioDe(est.user.email);
  const navLink = (n, classe = 'nav-item') => h('a', { href: `#/${n.rota}`, class: classe, dataset: { rota: n.rota }, 'aria-label': n.rotulo }, ic(n.icone), h('span', {}, n.rotulo));
  principal = h('main', { id: 'principal', tabindex: '-1' });
  raiz.replaceChildren(h('div', { class: 'casca' },
    h('aside', { class: 'lateral' },
      h('a', { href: '#/salvos', class: 'lateral-marca' }, marca(), h('span', {}, 'Guardei')),
      h('nav', { class: 'nav', 'aria-label': 'Principal' }, NAV.map((n) => navLink(n))),
      h('div', { class: 'lateral-pe' },
        h('a', { href: '#/ajustes/ia', class: 'nav-item' }, ic('tomada'), h('span', {}, 'Conectar sua IA')),
        h('button', { type: 'button', class: 'nav-item', onclick: folhaInstalar }, ic('baixar'), h('span', {}, 'Instalar no celular')),
        h('a', { href: '#/ajustes', class: 'nav-item conta', dataset: { rota: 'ajustes' } },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, nome.slice(0, 1).toUpperCase()),
          h('span', { class: 'conta-txt' }, h('strong', {}, nome), h('small', {}, usuarioDe(est.user.email)))))),
    principal,
    h('nav', { class: 'abas', 'aria-label': 'Abas' },
      h('div', { class: 'abas-grupo' }, NAV.slice(0, 4).map((n) => navLink(n, 'nav-item aba'))),
      navLink(NAV[4], 'nav-item aba abas-chat'))));
}

function marcarNav(rota) {
  const ativa = { salvo: 'salvos', pasta: 'pastas' }[rota] || rota;
  for (const a of raiz.querySelectorAll('.nav-item')) {
    const on = a.dataset.rota === ativa;
    a.classList.toggle('ativo', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    if (a.dataset.rota === 'salvos') a.querySelector('svg').replaceWith(ic(on ? 'inicioCheio' : 'inicio'));
  }
}

// Barra de cima no celular (perfil à esquerda, ações em pílula à direita).
const topoCelular = (esquerda, ...direita) => h('div', { class: 'topo-cel' }, esquerda || h('span'), direita.length ? h('div', { class: 'pilula' }, direita) : null);
const btnPilula = (icone, titulo, onclick, extra = {}) => botao('', { icone, titulo, onclick, classe: 'btn-pilula', ...extra });

// ---------- Rotas ----------
function rotear() {
  const [rota = 'salvos', arg] = location.hash.replace(/^#\/?/, '').split('/');
  marcarNav(rota);
  est.vista?.destruir?.();
  est.vista = null;
  principal.classList.toggle('com-mapa', rota === 'mapa');
  scrollTo(0, 0);
  if (rota === 'salvo') return vistaDetalhe(arg);
  if (rota === 'pastas') return vistaPastas();
  if (rota === 'mapa') return vistaMapa();
  if (rota === 'pasta') return vistaSalvos({ pastaId: arg });
  if (rota === 'chat') return vistaChat();
  if (rota === 'ajustes') return vistaAjustes(arg);
  if (rota !== 'buscar') est.selecao = null;
  return vistaSalvos({ busca: rota === 'buscar' });
}

function atualizar() {
  if (est.vista?.atualizar) est.vista.atualizar();
  else rotear();
}

// ---------- Ações sobre salvos ----------
function adicionarLink(texto, extra = {}) {
  const u = extrairUrl(texto);
  if (!u) {
    toast('Esse texto não tem um link http(s).');
    return null;
  }
  const url = normalizarUrl(u.href);
  const existente = est.salvos.find((s) => s.url === url);
  if (existente) {
    toast('Você já tinha guardado isso', { acao: 'Abrir', onAcao: () => { location.hash = `#/salvo/${existente.id}`; } });
    return existente.id;
  }
  const padrao = est.pastas.find((p) => p.id === est.ajustes.pastaPadrao);
  const id = nuvem.criarSalvo(est.user.uid, { url, plataforma: plataformaDe(url), tipo: tipoDe(url), titulo: '', origem: 'web', pastas: padrao ? [padrao.id] : [], ...extra });
  toast(padrao ? `Guardado em ${padrao.nome}` : 'Guardado no Guardei', { acao: 'Abrir', onAcao: () => { location.hash = `#/salvo/${id}`; } });
  return id;
}

function folhaAdicionar() {
  folha('Adicionar link', (fechar) => {
    const campo = h('input', { type: 'text', inputmode: 'url', placeholder: 'Cole um link', 'aria-label': 'Link', autofocus: true, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const ok = h('button', { type: 'submit', class: 'btn btn-pri', disabled: true }, 'Adicionar');
    campo.oninput = () => { ok.disabled = !extrairUrl(campo.value); };
    const colar = botao('Colar', {
      classe: 'btn-sec btn-peq',
      onclick: async () => {
        try {
          campo.value = await navigator.clipboard.readText();
          campo.oninput();
        } catch {
          toast('Sem permissão para ler a área de transferência');
        }
      },
    });
    const form = h('form', { class: 'folha-corpo' },
      h('div', { class: 'campo-linha' }, ic('link'), campo, colar),
      h('div', { class: 'acoes' }, botao('Cancelar', { classe: 'btn-sec', onclick: () => fechar() }), ok));
    form.onsubmit = (e) => {
      e.preventDefault();
      if (adicionarLink(campo.value)) fechar();
    };
    return form;
  }, { subtitulo: 'O Guardei lê qualquer link que começa com http:// ou https://.' });
}

function comoMarkdown(s) {
  const bloco = (t, v) => (v ? `\n## ${t}\n\n${v}\n` : '');
  return `# ${s.titulo || s.url}\n\n${s.url}\n\n- Categoria: ${s.categoria || '-'}\n- Autor: ${s.autor || '-'}\n- Guardado em: ${new Date(s.criadoEm).toLocaleDateString('pt-BR')}\n`
    + bloco('Resumo', s.resumo) + bloco('Nota', s.nota) + bloco('Legenda', s.legenda) + bloco('Transcrição', s.transcricao) + bloco('Texto na tela', s.textoNaTela);
}

function excluir(s) {
  nuvem.apagarSalvo(est.user.uid, s.id);
  if (location.hash === `#/salvo/${s.id}`) history.back();
  toast('Salvo excluído', { acao: 'Desfazer', ms: 5000, onAcao: () => nuvem.restaurarSalvo(est.user.uid, s) });
}

function acoesDoSalvo(s) {
  const uid = est.user.uid;
  return [
    { rotulo: s.visto ? 'Marcar como não visto' : 'Marcar como visto', icone: 'check', acao: () => nuvem.atualizarSalvo(uid, s.id, { visto: !s.visto }) },
    { rotulo: s.verDepois ? 'Tirar de Ver depois' : 'Ver depois', icone: 'relogio', acao: () => nuvem.atualizarSalvo(uid, s.id, { verDepois: !s.verDepois }) },
    '-',
    { rotulo: 'Adicionar à pasta', icone: 'pastas', acao: () => folhaPastas([s.id]) },
    { rotulo: 'Copiar link', icone: 'link', acao: () => copiar(s.url, 'Link copiado') },
    { rotulo: 'Copiar tudo em Markdown', icone: 'markdown', acao: () => copiar(comoMarkdown(s), 'Markdown copiado') },
    { rotulo: 'Ler de novo', icone: 'recarregar', acao: () => nuvem.atualizarSalvo(uid, s.id, { status: 'pendente', erro: '' }) },
    '-',
    { rotulo: 'Excluir', icone: 'lixo', perigo: true, acao: () => excluir(s) },
  ];
}

const itensDaPasta = (id) => est.salvos.filter((s) => s.pastas?.includes(id));
const rotuloItens = (n) => (n === 0 ? 'Nenhum item' : n === 1 ? '1 item' : `${n} itens`);

function capa(s, classe = '') {
  const vazio = () => h('span', { class: `capa capa-vazia ${classe}` }, ic(s.plataforma || 'web'));
  if (!s.capa) return vazio();
  const img = h('img', { class: `capa ${classe}`, src: s.capa, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' });
  img.onerror = () => img.replaceWith(vazio());
  return img;
}

// Mosaico 2x2 da pasta: capas dos primeiros itens e quadros vazios com ícone de foto.
function mosaico(pastaId) {
  const itens = pastaId ? itensDaPasta(pastaId).slice(0, 4) : [];
  return h('span', { class: 'mosaico' }, [0, 1, 2, 3].map((i) => (itens[i] ? capa(itens[i]) : h('span', { class: 'mosaico-vazio' }, ic('foto')))));
}

const chipCategoria = (cat, classe = '') => h('span', { class: `chip ${classe}` }, ic(iconeCategoria(cat)), cat);

// Folha "Adicionar à pasta": pastas lado a lado + "Nova pasta" tracejada.
function folhaPastas(ids) {
  folha('Adicionar à pasta', (fechar) => {
    const concluir = (msg) => {
      toast(msg);
      if (est.selecao) { est.selecao = null; atualizar(); }
      fechar();
    };
    const lista = h('div', { class: 'pastas-escolha' },
      est.pastas.map((p) => {
        const todos = ids.every((id) => est.salvos.find((s) => s.id === id)?.pastas?.includes(p.id));
        return h('button', {
          type: 'button', class: `pasta-mini${todos ? ' marcada' : ''}`, 'aria-pressed': String(todos),
          onclick: () => {
            nuvem.colocarNaPasta(est.user.uid, ids, p.id, !todos);
            concluir(todos ? `Tirado de ${p.nome}` : `Adicionado a ${p.nome}`);
          },
        }, mosaico(p.id), h('strong', {}, p.nome), h('small', {}, rotuloItens(itensDaPasta(p.id).length)), todos ? h('span', { class: 'selo' }, ic('check')) : null);
      }),
      h('button', { type: 'button', class: 'pasta-mini nova', onclick: async () => {
        const nome = await pedirNome('Nova pasta');
        if (!nome) return;
        const id = nuvem.criarPasta(est.user.uid, nome);
        nuvem.colocarNaPasta(est.user.uid, ids, id, true);
        concluir(`Adicionado a ${nome}`);
      } }, h('span', { class: 'mosaico tracejado' }, ic('mais')), h('strong', {}, 'Nova pasta')));
    return h('div', { class: 'folha-corpo' }, lista);
  }, { subtitulo: ids.length > 1 ? `${ids.length} itens selecionados` : '1 item selecionado' });
}

function pedirNome(titulo, valor = '') {
  return new Promise((ok) => {
    let resposta = null;
    folha(titulo, (fechar) => {
      const campo = h('input', { value: valor, maxlength: 60, placeholder: 'Ex.: Receitas', 'aria-label': 'Nome', autofocus: true });
      const form = h('form', { class: 'folha-corpo' }, h('div', { class: 'campo-linha' }, campo),
        h('div', { class: 'acoes' }, botao('Cancelar', { classe: 'btn-sec', onclick: () => fechar() }), h('button', { type: 'submit', class: 'btn btn-pri' }, 'Salvar')));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!campo.value.trim()) return;
        resposta = campo.value.trim();
        fechar();
      };
      return form;
    }, { onFechar: () => ok(resposta) });
  });
}

// ---------- Vista: lista (início, busca e pasta) ----------
function vistaSalvos({ pastaId, busca: modoBusca = false } = {}) {
  const pasta = pastaId ? est.pastas.find((p) => p.id === pastaId) : null;
  if (pastaId && !pasta && est.carregado) {
    location.hash = '#/pastas';
    return;
  }
  const contagem = h('p', { class: 'mudo contagem' });
  const grade = h('div', { class: 'grade' });
  const busca = h('input', { type: 'search', placeholder: modoBusca ? 'Buscar' : 'Buscar do jeito que você lembra', 'aria-label': 'Buscar', value: est.q, enterkeyhint: 'search' });
  const verDepois = h('button', { type: 'button', class: 'filtro' });
  const cat = h('select', { 'aria-label': 'Categoria', class: 'filtro' });
  const selBtn = botao('Selecionar', { icone: 'selecionar', classe: 'filtro' });
  const barraSel = h('div', { class: 'barra-sel', hidden: true });
  const filtros = h('div', { class: 'filtros' }, verDepois, cat, selBtn);
  const barra = h('div', { class: `barra${modoBusca ? ' modo-busca' : ''}` }, contagem, h('div', { class: 'linha-busca' }, h('label', { class: 'busca' }, ic('buscar'), busca), filtros));

  busca.oninput = () => { est.q = busca.value; desenhar(); };
  verDepois.onclick = () => { est.verDepois = !est.verDepois; desenhar(); };
  cat.onchange = () => { est.categoria = cat.value; desenhar(); };
  selBtn.onclick = () => { est.selecao = est.selecao ? null : new Set(); desenhar(); };

  // Busca pelo assunto (IA): pede o vetor da pergunta uma vez por texto, com uma pequena espera ao digitar.
  const sem = { q: '', qv: null, modelo: '', estado: '', t: 0 };
  function pedirSemantica(q) {
    if (!ia() || q.length < 3) { sem.q = ''; sem.estado = ''; return; }
    if (sem.q === q) return;
    Object.assign(sem, { q, qv: null, estado: 'buscando' });
    clearTimeout(sem.t);
    sem.t = setTimeout(async () => {
      const modelo = modeloDosIndices(est.salvos);
      if (!modelo) { sem.estado = 'sem-indice'; desenhar(); return; }
      try {
        const qv = await vetorDaConsulta(ia().chave, q, modelo);
        if (sem.q === q) Object.assign(sem, { qv, modelo, estado: 'ok' });
      } catch {
        if (sem.q === q) sem.estado = 'erro';
      }
      if (sem.q === q) desenhar();
    }, 450);
  }

  // Mostra de onde veio o resultado quando a palavra só aparece na transcrição/legenda.
  function trechoPorPalavra(s, q) {
    const ts = termos(q).map((t) => (t.length > 4 ? t.slice(0, -1) : t));
    if (!ts.length || ts.some((t) => normalizar(`${s.titulo} ${s.resumo} ${s.categoria} ${(s.tags || []).join(' ')}`).includes(t))) return null;
    for (const campo of ['transcricao', 'legenda', 'textoNaTela']) {
      if (ts.some((t) => normalizar(s[campo]).includes(t))) return trechoDe(s, `${campo}:0:${(s[campo] || '').length}`, q);
    }
    return null;
  }

  const topoCel = pasta
    ? topoCelular(botao('', { icone: 'voltar', classe: 'btn-redondo', titulo: 'Voltar para pastas', onclick: () => { location.hash = '#/pastas'; } }),
      btnPilula('menu', 'Ações da pasta', (e) => acoesPasta(e.currentTarget)))
    : modoBusca ? null
      : topoCelular(h('a', { href: '#/ajustes', class: 'btn-redondo azul', 'aria-label': 'Perfil e ajustes' }, ic('perfil')),
        btnPilula('filtros', 'Filtros', () => { est.filtros = !est.filtros; barra.classList.toggle('aberta', est.filtros); }),
        btnPilula('mais', 'Adicionar link', folhaAdicionar));

  function acoesPasta(ancora) {
    menu(ancora, [
      { rotulo: 'Renomear', icone: 'editar', acao: async () => { const n = await pedirNome('Renomear pasta', pasta.nome); if (n) nuvem.renomearPasta(est.user.uid, pasta.id, n); } },
      { rotulo: 'Excluir pasta', icone: 'lixo', perigo: true, acao: async () => {
        if (await confirmar('Excluir pasta?', 'Os salvos continuam guardados; só a pasta some.')) {
          nuvem.apagarPasta(est.user.uid, pasta.id, est.salvos);
          location.hash = '#/pastas';
        }
      } },
    ]);
  }

  const topo = h('header', { class: `topo${modoBusca ? ' so-desktop' : ''}` },
    pasta ? botao('', { icone: 'voltar', classe: 'btn-redondo so-desktop', titulo: 'Voltar para pastas', onclick: () => { location.hash = '#/pastas'; } }) : null,
    h('h1', {}, pasta ? pasta.nome : modoBusca ? 'Buscar' : [h('span', { class: 'so-celular' }, 'Guardei'), h('span', { class: 'so-desktop' }, 'Salvos')]),
    h('div', { class: 'topo-acoes so-desktop' },
      pasta ? botao('', { icone: 'menu', classe: 'btn-redondo', titulo: 'Ações da pasta', onclick: (e) => acoesPasta(e.currentTarget) }) : null,
      botao('Adicionar link', { icone: 'mais', classe: 'btn-pri', onclick: folhaAdicionar })));

  function desenhar() {
    const base = pasta ? itensDaPasta(pasta.id) : est.salvos;
    const cats = [...new Set(base.map((s) => s.categoria).filter(Boolean))].sort((a, b) => CATEGORIAS.indexOf(a) - CATEGORIAS.indexOf(b));
    if (est.categoria && !cats.includes(est.categoria)) est.categoria = '';
    cat.replaceChildren(h('option', { value: '' }, 'Todas as categorias'), ...cats.map((c) => h('option', { value: c, selected: c === est.categoria }, c)));
    verDepois.replaceChildren(ic('relogio'), h('span', {}, 'Ver depois'), h('span', { class: 'num' }, String(base.filter((s) => s.verDepois).length)));
    verDepois.setAttribute('aria-pressed', String(est.verDepois));
    selBtn.setAttribute('aria-pressed', String(!!est.selecao));
    barra.classList.toggle('aberta', est.filtros || est.verDepois || !!est.categoria || !!est.selecao);

    let lista = base;
    if (est.verDepois) lista = lista.filter((s) => s.verDepois);
    if (est.categoria) lista = lista.filter((s) => s.categoria === est.categoria);
    const filtrada = lista;
    lista = buscar(lista, est.q);
    const q = est.q.trim();
    pedirSemantica(q);
    const porAssunto = sem.qv && sem.q === q
      ? rankear(filtrada.filter((s) => !lista.includes(s)), sem.qv, sem.modelo)
      : [];
    if (porAssunto.length && sem.refinado !== q) {
      sem.refinado = q;
      refinarTrechos(ia().chave, sem.modelo, sem.qv, q, porAssunto).then((mudou) => { if (mudou && sem.q === q) desenhar(); }).catch(() => {});
    }
    const faltam = est.indexador?.faltam() || 0;
    const nota = !q || est.selecao ? null
      : !ia() ? h('p', { class: 'grade-nota mudo pequeno' }, 'Para achar também pelo assunto (o que foi falado no vídeo), ', h('a', { href: '#/ajustes/gemini' }, 'conecte o Gemini'), '.')
        : sem.estado === 'buscando' ? h('p', { class: 'grade-nota mudo pequeno' }, 'Procurando também pelo assunto…')
          : sem.estado === 'erro' ? h('p', { class: 'grade-nota mudo pequeno' }, 'A busca por assunto falhou agora. A busca por palavras continua funcionando.')
            : faltam ? h('p', { class: 'grade-nota mudo pequeno' }, `Preparando ${faltam} salvo${faltam > 1 ? 's' : ''} para a busca por assunto…`)
              : null;
    contagem.textContent = base.length === 1 ? '1 salvo' : `${base.length} salvos`;
    grade.classList.toggle('selecionando', !!est.selecao);

    if (!est.carregado) {
      grade.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'card esqueleto' })));
    } else if (!lista.length && !porAssunto.length && !(q && sem.estado === 'buscando')) {
      grade.replaceChildren(h('div', { class: 'vazio-estado' },
        h('strong', {}, base.length ? 'Nada encontrado' : pasta ? 'Pasta vazia' : 'Nada guardado ainda'),
        h('p', { class: 'mudo' }, base.length ? 'Tente outras palavras ou limpe os filtros.'
          : pasta ? 'Use “Adicionar à pasta” em qualquer salvo.' : 'Compartilhe um post com o Guardei pelo celular ou cole um link aqui.'),
        !base.length && !pasta ? h('p', { class: 'mudo pequeno' }, `Conta: ${usuarioDe(est.user.email)}. Guardou em outro aparelho? Confira se entrou com a mesma conta.`) : null,
        base.length && (est.q || est.categoria || est.verDepois) ? botao('Limpar filtros', { classe: 'btn-sec', onclick: () => { est.q = ''; est.categoria = ''; est.verDepois = false; rotear(); } }) : null,
        !base.length && !pasta ? botao('Adicionar link', { icone: 'mais', classe: 'btn-pri', onclick: folhaAdicionar }) : null),
        nota);
    } else {
      grade.replaceChildren(
        ...lista.map((s) => cartao(s, q ? trechoPorPalavra(s, q) : null)),
        ...(porAssunto.length ? [h('h2', { class: 'grade-titulo' }, lista.length ? 'Também pode ser, pelo assunto' : 'Pelo assunto')] : []),
        ...porAssunto.map((x) => cartao(x.s, trechoDe(x.s, x.ref, q), true)),
        ...(nota ? [nota] : []));
    }

    barraSel.hidden = !est.selecao;
    if (est.selecao) {
      const n = est.selecao.size;
      barraSel.replaceChildren(h('span', {}, n ? `${n} selecionado${n > 1 ? 's' : ''}` : 'Toque nos itens'),
        botao('Cancelar', { classe: 'btn-sec btn-peq', onclick: () => { est.selecao = null; desenhar(); } }),
        botao('Adicionar à pasta', { classe: 'btn-pri btn-peq', disabled: !n, onclick: () => folhaPastas([...est.selecao]) }));
    }
  }

  function cartao(s, trecho = null, porAssunto = false) {
    const lendo = s.status === 'pendente' || s.status === 'lendo';
    const sel = est.selecao?.has(s.id);
    const titulo = lendo ? 'Lendo este…' : s.status === 'erro' ? 'Não consegui ler este link' : s.titulo || s.tituloOriginal || s.url;
    const corpo = [
      h('span', { class: 'card-capa' }, capa(s), h('span', { class: 'scrim', 'aria-hidden': 'true' }),
        s.categoria ? chipCategoria(s.categoria, 'chip-capa') : null),
      h('span', { class: 'card-corpo' },
        h('span', { class: 'card-meta' }, ic(s.plataforma || 'web'), h('span', { class: 'autor' }, s.autor || nomePlataforma(s.plataforma)),
          s.verDepois ? h('span', { class: 'marca-relogio', title: 'Ver depois' }, ic('relogio')) : null,
          h('time', { datetime: new Date(s.criadoEm).toISOString() }, dia(s.criadoEm))),
        h('span', { class: `card-titulo${lendo ? ' lendo' : ''}` }, titulo),
        trecho ? h('span', { class: 'card-trecho' }, h('b', {}, `${trecho.onde}: `), trecho.texto) : null,
        s.categoria ? chipCategoria(s.categoria, 'card-cat') : null),
      est.selecao ? h('span', { class: `marcador${sel ? ' on' : ''}`, 'aria-hidden': 'true' }, ic('check')) : null,
    ];
    const link = est.selecao
      ? h('button', { type: 'button', class: 'card-link', 'aria-pressed': String(!!sel), onclick: () => {
        if (sel) est.selecao.delete(s.id); else est.selecao.add(s.id);
        desenhar();
      } }, corpo)
      : h('a', { class: 'card-link', href: `#/salvo/${s.id}` }, corpo);
    return h('article', { class: `card${s.visto ? ' visto' : ''}${sel ? ' sel' : ''}${porAssunto ? ' por-assunto' : ''}`, dataset: { id: s.id } }, link,
      est.selecao ? null : botao('', { icone: 'menu', classe: 'card-menu', titulo: 'Ações do item', onclick: (e) => menu(e.currentTarget, acoesDoSalvo(s)) }));
  }

  principal.replaceChildren(...[topoCel, topo, barra, grade, barraSel].filter(Boolean));
  desenhar();
  if (modoBusca && !est.selecao) busca.focus();
  est.vista = { atualizar: desenhar };
}

// ---------- Vista: detalhe ----------
const ABAS = [
  ['resumo', 'Resumo', 'Sem resumo ainda.'],
  ['legenda', 'Legenda', 'Sem legenda neste.'],
  ['transcricao', 'Transcrição', 'Sem fala neste.'],
  ['textoNaTela', 'Texto na tela', 'Nenhum texto na tela.'],
];
let abaAtual = 'resumo';

function vistaDetalhe(id) {
  const caixa = h('div', { class: 'detalhe' });
  let notaAberta = false;
  function desenhar() {
    const s = est.salvos.find((x) => x.id === id);
    if (!s) {
      if (est.carregado) caixa.replaceChildren(h('div', { class: 'vazio-estado' }, h('strong', {}, 'Esse salvo não existe mais.'), h('a', { href: '#/salvos', class: 'btn btn-sec' }, 'Voltar')));
      return;
    }
    if (caixa.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    const uid = est.user.uid;
    const voltar = () => (history.length > 1 ? history.back() : (location.hash = '#/salvos'));
    const lendo = s.status === 'pendente' || s.status === 'lendo';

    const catSel = h('select', { class: 'chip-select', 'aria-label': 'Categoria' }, CATEGORIAS.map((c) => h('option', { value: c, selected: c === s.categoria }, c)));
    if (!s.categoria) catSel.prepend(h('option', { value: '', selected: true }, 'Sem categoria'));
    catSel.onchange = () => nuvem.atualizarSalvo(uid, s.id, { categoria: catSel.value, categoriaManual: true });

    const nota = notaAberta || s.nota
      ? (() => {
        const t = h('textarea', { class: 'nota', rows: 3, maxlength: 2000, placeholder: 'Escreva uma nota…', 'aria-label': 'Nota' });
        t.value = s.nota || '';
        t.onblur = () => { notaAberta = false; if (t.value !== (s.nota || '')) nuvem.atualizarSalvo(uid, s.id, { nota: t.value.trim() }); };
        return t;
      })()
      : h('button', { type: 'button', class: 'nota-btn', onclick: () => { notaAberta = true; desenhar(); caixa.querySelector('textarea')?.focus(); } }, ic('nota'), h('span', {}, 'Adicionar uma nota'));

    const painel = h('div', { class: 'painel', role: 'tabpanel' });
    const abas = h('div', { class: 'abas-seg', role: 'tablist' }, ABAS.map(([k, rotulo]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === abaAtual),
      onclick: () => { abaAtual = k; desenhar(); },
    }, rotulo)));
    const [, rotuloAba, vazioAba] = ABAS.find(([k]) => k === abaAtual);
    const conteudo = s[abaAtual];
    painel.setAttribute('aria-label', rotuloAba);
    painel.replaceChildren(
      conteudo ? h('div', { class: 'painel-topo' }, botao('Copiar', { icone: 'copiar', classe: 'btn-sec btn-peq', onclick: () => copiar(conteudo) })) : null,
      lendo ? h('p', { class: 'mudo' }, 'Lendo o conteúdo…') : h('p', { class: `texto-longo${conteudo ? '' : ' mudo'}` }, conteudo || vazioAba));

    const avisos = [];
    if (s.status === 'erro') avisos.push(h('div', { class: 'aviso erro' }, h('span', {}, `Não consegui ler: ${s.erro || 'erro desconhecido'}`), botao('Tentar de novo', { classe: 'btn-sec btn-peq', onclick: () => nuvem.atualizarSalvo(uid, s.id, { status: 'pendente', erro: '' }) })));
    else if (s.status === 'pronto' && !ia()) avisos.push(h('div', { class: 'aviso' }, h('span', {}, 'Para resumo, transcrição e categoria automáticos, adicione sua chave grátis do Gemini.'), h('a', { href: '#/ajustes', class: 'btn btn-sec btn-peq' }, 'Ajustes')));
    else if (s.avisoIa) avisos.push(h('div', { class: 'aviso' }, h('span', {}, `A IA não conseguiu ler tudo: ${s.avisoIa}`), botao('Ler de novo', { classe: 'btn-sec btn-peq', onclick: () => nuvem.atualizarSalvo(uid, s.id, { status: 'pendente', avisoIa: '' }) })));

    const pastasDele = est.pastas.filter((p) => s.pastas?.includes(p.id));
    caixa.replaceChildren(
      h('header', { class: 'topo topo-detalhe' },
        botao('Salvos', { icone: 'voltar', classe: 'btn-voltar', titulo: 'Voltar', onclick: voltar }),
        h('nav', { class: 'trilha so-desktop', 'aria-label': 'Trilha' }, h('a', { href: '#/salvos' }, 'Salvos'), ic('seta'), h('span', { class: 'trilha-atual' }, s.titulo || 'Salvo')),
        h('div', { class: 'topo-acoes' },
          botao('', { icone: 'compartilhar', classe: 'btn-redondo', titulo: 'Compartilhar', onclick: () => (navigator.share ? navigator.share({ title: s.titulo, url: s.url }).catch(() => {}) : copiar(s.url, 'Link copiado')) }),
          botao('', { icone: 'menu', classe: 'btn-redondo', titulo: 'Mais ações', onclick: (e) => menu(e.currentTarget, acoesDoSalvo(s)) }))),
      h('div', { class: 'detalhe-grade' },
        h('div', { class: 'detalhe-midia' },
          h('div', { class: 'detalhe-capa' }, capa(s, 'grande')),
          h('a', { class: 'btn btn-sec btn-largo', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, ic(s.plataforma || 'web'), h('span', {}, 'Abrir original'), ic('externo'))),
        h('article', { class: 'detalhe-info' },
          h('div', { class: 'linha-chips' }, h('label', { class: 'chip chip-sel' }, ic(iconeCategoria(s.categoria)), catSel),
            s.verDepois ? h('span', { class: 'chip' }, ic('relogio'), 'Ver depois') : null, s.visto ? h('span', { class: 'chip' }, ic('check'), 'Visto') : null),
          h('h1', { class: `detalhe-titulo${lendo ? ' lendo' : ''}` }, lendo ? 'Lendo este…' : s.titulo || s.url),
          h('p', { class: 'mudo detalhe-meta' }, ic(s.plataforma || 'web'), h('span', {}, s.autor || nomePlataforma(s.plataforma)), h('span', { 'aria-hidden': 'true' }, '·'),
            h('span', {}, `Guardado em ${new Date(s.criadoEm).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`)),
          avisos,
          nota,
          h('section', { class: 'detalhe-abas' }, abas, painel),
          s.tags?.length ? h('div', { class: 'linha-chips' }, s.tags.map((t) => h('button', { type: 'button', class: 'chip chip-tag', onclick: () => { est.q = t; location.hash = '#/buscar'; } }, `#${t}`))) : null,
          h('div', { class: 'linha-chips' }, pastasDele.map((p) => h('a', { class: 'chip', href: `#/pasta/${p.id}` }, ic('pastas'), p.nome)),
            botao(pastasDele.length ? 'Pasta' : 'Adicionar à pasta', { icone: 'mais', classe: 'chip chip-acao', onclick: () => folhaPastas([s.id]) })))));
  }
  principal.replaceChildren(caixa);
  desenhar();
  est.vista = { atualizar: desenhar };
}

// ---------- Vista: pastas ----------
function folhaPastaPadrao() {
  folha('Salvar novos itens em uma pasta', (fechar) => h('div', { class: 'folha-corpo' },
    h('div', { class: 'grupo' }, [{ id: '', nome: 'Nenhuma (só em Salvos)' }, ...est.pastas].map((p) => h('button', {
      type: 'button', class: 'grupo-linha opcao', 'aria-pressed': String((est.ajustes.pastaPadrao || '') === p.id),
      onclick: () => { nuvem.salvarAjustes(est.user.uid, { pastaPadrao: p.id }); est.ajustes.pastaPadrao = p.id; fechar(); atualizar(); },
    }, h('span', {}, p.nome), (est.ajustes.pastaPadrao || '') === p.id ? ic('check', 'azul') : null)))),
  { subtitulo: 'Tudo que você guardar daqui em diante também entra nela.' });
}

function vistaPastas() {
  const grade = h('div', { class: 'grade-pastas' });
  const dica = h('button', { type: 'button', class: 'dica', onclick: folhaPastaPadrao });
  async function novaPasta() {
    const nome = await pedirNome('Nova pasta');
    if (nome) nuvem.criarPasta(est.user.uid, nome);
  }
  function desenhar() {
    const padrao = est.pastas.find((p) => p.id === est.ajustes.pastaPadrao);
    dica.replaceChildren(ic('caixa', 'azul'), h('span', {}, padrao ? `Novos itens vão para ${padrao.nome}` : 'Salvar novos itens em uma pasta'), ic('seta'));
    grade.replaceChildren(...est.pastas.map((p) => h('a', { class: 'pasta', href: `#/pasta/${p.id}` }, mosaico(p.id), h('strong', {}, p.nome), h('small', { class: 'mudo' }, rotuloItens(itensDaPasta(p.id).length)))),
      ...(est.pastas.length ? [] : [h('div', { class: 'vazio-estado' }, h('strong', {}, 'Nenhuma pasta ainda'), h('p', { class: 'mudo' }, 'Crie pastas como Receitas, Viagem ou Leituras.'))]));
  }
  principal.replaceChildren(
    topoCelular(null, btnPilula('mais', 'Nova pasta', novaPasta)),
    h('header', { class: 'topo' }, h('h1', {}, 'Pastas'), h('div', { class: 'topo-acoes so-desktop' }, botao('Nova pasta', { icone: 'mais', classe: 'btn-pri', onclick: novaPasta }))),
    h('div', { class: 'dica-linha' }, dica),
    grade);
  desenhar();
  est.vista = { atualizar: desenhar };
}

// ---------- Vista: mapa 3D ----------
async function vistaMapa() {
  const ver = (est.mapaVer ||= { pastas: true, cats: true, tags: false });
  const palco = h('div', { class: 'mapa' }, h('p', { class: 'mapa-carregando mudo' }, 'Montando o mapa…'));
  const busca = h('input', { type: 'search', placeholder: 'Destacar…', 'aria-label': 'Destacar no mapa' });
  const contagem = h('span', { class: 'mudo pequeno mapa-contagem' });
  const alternar = (chave, rotulo) => {
    const b = h('button', { type: 'button', class: 'filtro', 'aria-pressed': String(ver[chave]) }, rotulo);
    b.onclick = () => { ver[chave] = !ver[chave]; b.setAttribute('aria-pressed', String(ver[chave])); desenhar(); };
    return b;
  };
  const centralizar = botao('', { icone: 'alvo', classe: 'btn-redondo', titulo: 'Centralizar' });
  est.vista = { atualizar: () => {} };
  principal.replaceChildren(
    h('header', { class: 'topo' }, h('h1', {}, 'Mapa'), contagem),
    h('div', { class: 'mapa-barra' }, h('label', { class: 'busca' }, ic('buscar'), busca),
      h('div', { class: 'filtros' }, alternar('pastas', 'Pastas'), alternar('cats', 'Categorias'), alternar('tags', 'Tags')), centralizar),
    palco,
    h('p', { class: 'mapa-ajuda mudo pequeno' }, 'Arraste para girar · role ou pince para aproximar · botão direito ou dois dedos para mover · toque num salvo para abrir, numa pasta para chegar perto'));

  const modulo = await import('./mapa.js');
  if (!location.hash.startsWith('#/mapa')) return;
  if (!modulo.suportaWebGL()) {
    palco.replaceChildren(h('div', { class: 'vazio-estado' }, h('strong', {}, 'Seu navegador não mostra 3D'), h('p', { class: 'mudo' }, 'Ative a aceleração de hardware ou use outro navegador.')));
    return;
  }
  palco.replaceChildren();
  const mapa = modulo.montarMapa(palco, {
    aoAbrirSalvo: (id) => { location.hash = `#/salvo/${id}`; },
    aoAbrirPasta: (id) => { location.hash = `#/pasta/${id}`; },
  });
  let espera;
  function desenhar() {
    mapa.definir(est.salvos, est.pastas, ver);
    mapa.destacar(busca.value);
    contagem.textContent = `${est.salvos.length} salvos · ${est.pastas.length} pastas`;
    palco.dataset.nos = String(mapa.total);
  }
  busca.oninput = () => mapa.destacar(busca.value);
  centralizar.onclick = () => mapa.centralizar();
  desenhar();
  est.vista = {
    atualizar: () => { clearTimeout(espera); espera = setTimeout(desenhar, 300); },
    destruir: () => { clearTimeout(espera); mapa.destruir(); },
    mapa,
  };
}

// ---------- Vista: conversa ----------
const SUGESTOES = ['Monta a lista de compras com as receitas que salvei', 'Quais lugares salvei para viajar?', 'Resume tudo que salvei sobre treino', 'Faz um roteiro com os restaurantes que guardei'];

function textoRico(t, fontes = []) {
  const frag = [];
  let lista = null;
  const inline = (linha) => linha.split(/(\*\*[^*]+\*\*|\[\d+\])/g).filter(Boolean).map((p) => {
    if (p.startsWith('**')) return h('strong', {}, p.slice(2, -2));
    const m = p.match(/^\[(\d+)\]$/);
    if (m) {
      const fonte = est.salvos.find((s) => s.id === fontes[Number(m[1]) - 1]);
      return fonte ? h('a', { class: 'cita', href: `#/salvo/${fonte.id}`, title: fonte.titulo }, m[1]) : p;
    }
    return p;
  });
  for (const linha of t.split('\n')) {
    const item = linha.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (item) {
      if (!lista) frag.push((lista = h('ul')));
      lista.append(h('li', {}, inline(item[1])));
      continue;
    }
    lista = null;
    if (linha.trim()) frag.push(h('p', {}, inline(linha.replace(/^#+\s*/, ''))));
  }
  return frag;
}

function vistaChat() {
  const chave = `guardei:chat:${est.user.uid}`;
  if (!est.chat.length) {
    try { est.chat = JSON.parse(localStorage.getItem(chave) || '[]'); } catch { est.chat = []; }
  }
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const campo = h('textarea', { rows: 1, placeholder: 'Pergunte sobre o que você guardou', 'aria-label': 'Mensagem', enterkeyhint: 'send' });
  const enviar = botao('', { icone: 'enviar', classe: 'btn-enviar', titulo: 'Enviar', type: 'submit' });
  let pensando = false;

  function desenhar() {
    if (!ia()) {
      msgs.replaceChildren(h('div', { class: 'vazio-estado' }, h('strong', {}, 'A conversa usa o Gemini'),
        h('p', { class: 'mudo' }, 'Cole sua chave grátis do Google AI Studio em Ajustes para conversar com seus salvos.'),
        h('a', { href: '#/ajustes', class: 'btn btn-pri' }, 'Abrir ajustes')));
      return;
    }
    if (!est.chat.length) {
      msgs.replaceChildren(h('div', { class: 'chat-vazio' }, h('h2', {}, 'Converse com seus salvos'),
        h('p', { class: 'mudo' }, 'Peça listas, roteiros e resumos a partir do que você guardou.'),
        h('div', { class: 'sugestoes' }, SUGESTOES.map((s) => h('button', { type: 'button', class: 'sugestao', onclick: () => perguntar(s) }, s)))));
      return;
    }
    msgs.replaceChildren(...est.chat.map((m) => h('div', { class: `msg ${m.de}` }, m.de === 'ia' ? textoRico(m.texto, m.fontes) : h('p', {}, m.texto))),
      ...(pensando ? [h('div', { class: 'msg ia' }, h('p', { class: 'mudo' }, 'Procurando nos seus salvos…'))] : []));
    msgs.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  async function perguntar(texto) {
    if (!texto.trim() || pensando) return;
    est.chat.push({ de: 'eu', texto: texto.trim() });
    campo.value = '';
    pensando = true;
    desenhar();
    const prontos = est.salvos.filter((s) => s.status === 'pronto');
    let contexto = buscar(prontos, texto, 12);
    // Junta os parecidos pelo assunto: a pergunta raramente usa as mesmas palavras do vídeo.
    const modelo = modeloDosIndices(prontos);
    if (modelo) {
      try {
        const qv = await vetorDaConsulta(ia().chave, texto, modelo);
        const extras = rankear(prontos, qv, modelo, { max: 10, janela: 0.15 }).map((x) => x.s).filter((s) => !contexto.includes(s));
        contexto = [...contexto.slice(0, 8), ...extras, ...contexto.slice(8)].slice(0, 16);
      } catch { /* segue só com a busca por palavras */ }
    }
    if (contexto.length < 3) contexto = [...contexto, ...prontos.filter((s) => !contexto.includes(s))].slice(0, 25);
    try {
      const resposta = await conversar(ia(), est.chat.slice(-8), contexto);
      est.chat.push({ de: 'ia', texto: resposta || 'Não consegui responder agora.', fontes: contexto.map((s) => s.id) });
    } catch (e) {
      est.chat.push({ de: 'ia', texto: `Erro da IA: ${e.message}` });
    }
    pensando = false;
    localStorage.setItem(chave, JSON.stringify(est.chat.slice(-40)));
    if (est.vista?.chat) desenhar();
  }

  const form = h('form', { class: 'chat-form' }, campo, enviar);
  form.onsubmit = (e) => { e.preventDefault(); perguntar(campo.value); };
  campo.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); perguntar(campo.value); } };
  campo.oninput = () => { campo.style.height = 'auto'; campo.style.height = `${Math.min(campo.scrollHeight, 160)}px`; };
  const nova = () => { est.chat = []; localStorage.removeItem(chave); desenhar(); };
  principal.replaceChildren(h('div', { class: 'chat' },
    topoCelular(null, btnPilula('editar', 'Nova conversa', nova)),
    h('header', { class: 'topo' }, h('h1', {}, 'Conversa'), h('div', { class: 'topo-acoes so-desktop' }, botao('Nova conversa', { icone: 'editar', classe: 'btn-sec', onclick: nova }))),
    msgs, form));
  desenhar();
  est.vista = { atualizar: () => {}, chat: true };
}

// ---------- Vista: ajustes ----------
function vistaAjustes(secao) {
  const uid = est.user.uid;
  const appUrl = location.origin + location.pathname;
  const chaveIn = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Chave da API (AIza…)', value: est.ajustes.geminiKey || '', 'aria-label': 'Chave do Gemini' });
  const modeloSalvo = modeloObsoleto(est.ajustes.modelo) ? GEMINI_MODELO_PADRAO : est.ajustes.modelo;
  const modeloIn = h('input', { value: modeloSalvo, 'aria-label': 'Modelo', list: 'modelos', placeholder: 'Modelo' });
  const status = h('p', { class: 'mudo pequeno', role: 'status' });
  const tema = h('select', { 'aria-label': 'Tema' }, [['sistema', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(([v, r]) => h('option', { value: v, selected: v === (localStorage.getItem('guardei:tema') || 'sistema') }, r)));
  tema.onchange = () => { localStorage.setItem('guardei:tema', tema.value); aplicarTema(tema.value); };

  const salvarIa = () => {
    nuvem.salvarAjustes(uid, { geminiKey: chaveIn.value.trim(), modelo: modeloIn.value.trim() || GEMINI_MODELO_PADRAO });
    status.textContent = 'Salvo. Vale para todos os seus aparelhos.';
  };
  const testarIa = async () => {
    if (!chaveIn.value.trim()) {
      status.textContent = 'Cole a chave primeiro.';
      return;
    }
    status.textContent = 'Testando…';
    try {
      await conversar({ chave: chaveIn.value.trim(), modelo: modeloIn.value.trim() }, [{ de: 'eu', texto: 'Responda só: ok' }], []);
      modeloIn.value = ultimoModelo() || modeloIn.value;
      salvarIa();
      status.textContent = `Funcionou com ${modeloIn.value}. Chave salva para todos os seus aparelhos.`;
    } catch (e) {
      status.textContent = `Falhou: ${e.message}`;
    }
  };
  const comErro = est.salvos.filter((s) => s.status === 'erro' || s.avisoIa);
  const favorito = `javascript:void(open('${appUrl}?share_url='+encodeURIComponent(location.href)+'&share_title='+encodeURIComponent(document.title),'_blank'))`;
  const mcpJson = JSON.stringify({ servers: { guardei: { type: 'stdio', command: 'node', args: ['C:/Users/<você>/Documents/SalveApps/mcp/server.mjs'] } } }, null, 2);
  const nome = est.user.displayName || usuarioDe(est.user.email);

  const secaoEl = (id, titulo, ...filhos) => h('section', { class: 'ajuste', id: `aj-${id}` }, h('h2', {}, titulo), ...filhos);
  const linha = (rotulo, ...fim) => h('div', { class: 'grupo-linha' }, h('span', {}, rotulo), h('span', { class: 'fim' }, ...fim));
  const sincronia = h('p', { class: 'pequeno sync' });
  const desenharSync = () => {
    const { pendentes, doCache } = est.sync;
    sincronia.className = `pequeno sync ${pendentes ? 'pendente' : doCache ? '' : 'ok'}`;
    sincronia.textContent = pendentes ? `${pendentes} alteração(ões) esperando internet para ir à nuvem`
      : doCache ? 'Conectando à nuvem…' : 'Sincronizado com a nuvem';
  };
  desenharSync();
  principal.replaceChildren(
    topoCelular(h('a', { href: '#/salvos', class: 'btn-redondo', 'aria-label': 'Voltar' }, ic('voltar'))),
    h('header', { class: 'topo' }, h('h1', {}, 'Ajustes')),
    h('div', { class: 'ajustes' },
      h('div', { class: 'perfil' }, h('span', { class: 'avatar grande', 'aria-hidden': 'true' }, nome.slice(0, 1).toUpperCase()),
        h('div', {}, h('strong', {}, nome), h('p', { class: 'mudo pequeno' }, `Conta: ${usuarioDe(est.user.email)} · ${est.salvos.length} salvos · ${est.pastas.length} pastas`), sincronia)),
      secaoEl('gemini', 'IA (Google Gemini)',
        h('div', { class: 'grupo' }, h('label', { class: 'grupo-linha' }, chaveIn), h('label', { class: 'grupo-linha' }, modeloIn),
          h('datalist', { id: 'modelos' }, GEMINI_MODELOS.map((m) => h('option', { value: m })))),
        h('p', { class: 'mudo pequeno' }, 'Resumo, transcrição, categoria e conversa usam a sua chave do Gemini (tem plano grátis). Ela fica guardada só na sua conta.'),
        h('div', { class: 'acoes inicio' }, botao('Salvar', { classe: 'btn-pri', onclick: salvarIa }), botao('Testar', { classe: 'btn-sec', onclick: testarIa }),
          h('a', { class: 'btn btn-sec', href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'Pegar chave grátis', ic('externo'))),
        status,
        comErro.length ? botao(`Ler de novo ${comErro.length} com problema`, { icone: 'recarregar', classe: 'btn-sec', onclick: () => comErro.forEach((s) => nuvem.atualizarSalvo(uid, s.id, { status: 'pendente', erro: '', avisoIa: '' })) }) : null),
      secaoEl('onde', 'Guardar de qualquer lugar',
        h('div', { class: 'grupo' },
          h('div', { class: 'grupo-linha passo' }, ic('baixar', 'azul'), h('div', {}, h('strong', {}, 'Android'), h('p', { class: 'mudo pequeno' }, 'Instale este app (menu do Chrome › Instalar app). Depois, em qualquer post: Compartilhar › Guardei.')),
            matchMedia('(pointer: coarse)').matches ? instalarBtn() : botao('QR code', { classe: 'btn-sec btn-peq', onclick: folhaInstalar })),
          h('div', { class: 'grupo-linha passo' }, ic('compartilhar', 'azul'), h('div', {}, h('strong', {}, 'iPhone'), h('p', { class: 'mudo pequeno' }, 'Safari › Compartilhar › Adicionar à Tela de Início. Para guardar: copie o link do post e toque em + › Colar.'))),
          h('div', { class: 'grupo-linha passo' }, ic('web', 'azul'), h('div', {}, h('strong', {}, 'Extensão do Chrome'), h('p', { class: 'mudo pequeno' }, 'Botão Guardei nos posts do Instagram, X, TikTok, YouTube e LinkedIn. chrome://extensions › Modo do desenvolvedor › Carregar sem compactação › pasta extension.'))),
          h('div', { class: 'grupo-linha passo' }, ic('marca', 'azul'), h('div', {}, h('strong', {}, 'Favorito “Guardar”'), h('p', { class: 'mudo pequeno' }, 'Arraste o botão para a barra de favoritos e clique em qualquer página.')),
            h('a', { class: 'btn btn-sec btn-peq favorito', href: favorito, onclick: (e) => { e.preventDefault(); toast('Arraste este botão para a barra de favoritos'); } }, 'Guardar')))),
      secaoEl('ia', 'Conectar sua IA (MCP)',
        h('p', { class: 'mudo pequeno' }, 'Deixe o Claude, ChatGPT, Copilot ou Cursor lerem seus salvos (com transcrição), montarem listas e criarem pastas. Rode uma vez “npm run mcp:login” na pasta mcp e adicione o servidor:'),
        h('pre', { class: 'codigo' }, mcpJson),
        botao('Copiar configuração', { icone: 'copiar', classe: 'btn-sec', onclick: () => copiar(mcpJson) })),
      secaoEl('tema', 'Aparência', h('div', { class: 'grupo' }, linha('Tema', tema))),
      h('div', { class: 'grupo' }, h('button', { type: 'button', class: 'grupo-linha perigo', onclick: async () => { await nuvem.sair(); location.reload(); } }, ic('sair'), h('span', {}, 'Sair')))));
  if (secao) document.getElementById(`aj-${secao}`)?.scrollIntoView({ block: 'start' });
  est.vista = { atualizar: desenharSync };
}

// QR code com o endereço do app para abrir e instalar no celular.
function folhaInstalar() {
  const url = location.origin + location.pathname;
  folha('Instalar no celular', () => h('div', { class: 'folha-corpo instalar' },
    h('div', { class: 'qr' }, qrSvg(url, 220)),
    h('ol', { class: 'passos-qr' },
      h('li', {}, 'Aponte a câmera do celular para o código e abra o link.'),
      h('li', {}, 'Entre com a mesma conta: ', h('strong', {}, usuarioDe(est.user?.email || ''))),
      h('li', {}, 'Android (Chrome): menu ⋮ › ', h('strong', {}, 'Instalar app'), '. Depois, em qualquer post, Compartilhar › Guardei.'),
      h('li', {}, 'iPhone (Safari): Compartilhar › ', h('strong', {}, 'Adicionar à Tela de Início'), '.')),
    h('div', { class: 'acoes' }, botao('Copiar link', { icone: 'link', classe: 'btn-sec', onclick: () => copiar(url, 'Link copiado') }))),
  { subtitulo: 'Escaneie com a câmera do celular' });
}

let pedidoInstalar = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; });
function instalarBtn() {
  if (matchMedia('(display-mode: standalone)').matches) return h('span', { class: 'pequeno ok' }, ic('check'), 'Instalado');
  return botao('Instalar', { classe: 'btn-sec btn-peq', onclick: async () => {
    if (!pedidoInstalar) return toast('Use o menu do navegador › Instalar app');
    pedidoInstalar.prompt();
    pedidoInstalar = null;
  } });
}

// ---------- Início ----------
async function iniciar(user) {
  est.user = user;
  nuvem.aoErro((e) => toast(e.code === 'permission-denied' ? 'Sem permissão para salvar. Entre de novo.' : 'Não consegui salvar na nuvem. Tente de novo.'));
  montarCasca();
  const fila = criarFila(user.uid, ia);
  est.indexador = criarIndexador(() => est.ajustes.geminiKey, (id, indice) => nuvem.guardarIndice(user.uid, id, indice));
  let primeira = true;
  let esperaNuvem = 0;
  nuvem.ouvirAjustes(user.uid, (a) => {
    est.ajustes = a;
    est.indexador.entrada(est.salvos);
    if (est.carregado && /^#\/(ajustes|chat|pastas)/.test(location.hash) && !principal.contains(document.activeElement)) rotear();
  });
  nuvem.ouvirPastas(user.uid, (p) => { est.pastas = p; if (est.carregado) atualizar(); });
  nuvem.ouvirSalvos(user.uid, (s, sync) => {
    est.sync = sync;
    est.salvos = s;
    // Aparelho novo: o primeiro retorno vem do cache vazio; espera a nuvem antes de dizer que não há nada.
    if (!est.carregado && !s.length && sync.doCache) {
      if (!esperaNuvem) esperaNuvem = setTimeout(() => { est.carregado = true; atualizar(); }, 10000);
      return;
    }
    clearTimeout(esperaNuvem);
    est.carregado = true;
    fila(s);
    est.indexador.entrada(s);
    if (primeira) {
      primeira = false;
      rotear();
      const pendente = sessionStorage.getItem('guardei:compartilhado');
      if (pendente) {
        sessionStorage.removeItem('guardei:compartilhado');
        const { texto, legenda } = JSON.parse(pendente);
        adicionarLink(texto, { origem: 'compartilhar', legenda: legenda && !/^https?:\/\/\S+$/.test(legenda.trim()) ? legenda.slice(0, 3000) : '' });
      }
    } else atualizar();
  });
  addEventListener('hashchange', rotear);
  rotear();
}

// Versão nova publicada: o service worker novo assume e a página recarrega uma vez sozinha.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const tinhaControle = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaControle && !recarregou) { recarregou = true; location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js').then((r) => r.update()).catch(() => {});
}

const user = await nuvem.sessaoAtual();
if (user) iniciar(user);
else telaLogin();
