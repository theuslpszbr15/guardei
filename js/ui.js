// Utilidades de interface: criação segura de elementos (texto nunca vira HTML), toast, folha e menu.
import { icone } from './icons.js';

export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'icone') el.insertAdjacentHTML('afterbegin', icone(v));
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export const ic = (nome, classe) => {
  const t = document.createElement('template');
  t.innerHTML = icone(nome, classe);
  return t.content.firstChild;
};

export function botao(rotulo, { icone: i, classe = '', onclick, titulo, ...resto } = {}) {
  return h('button', { type: 'button', class: `btn ${classe}`, onclick, title: titulo, 'aria-label': titulo || undefined, ...resto }, i ? ic(i) : null, rotulo ? h('span', {}, rotulo) : null);
}

let toastAtual;
export function toast(msg, { acao, onAcao, ms = 3200 } = {}) {
  toastAtual?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, msg),
    acao ? h('button', { type: 'button', class: 'toast-acao', onclick: () => { onAcao?.(); el.remove(); } }, acao) : null);
  document.body.append(el);
  toastAtual = el;
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 250); }, ms);
}

// Folha (modal no desktop, sobe de baixo no celular). Fecha com Esc, clique fora ou botão.
export function folha(titulo, corpo, { subtitulo, classe = '', onFechar } = {}) {
  const anterior = document.activeElement;
  let fechada = false;
  const fechar = () => {
    if (fechada) return;
    fechada = true;
    onFechar?.();
    fundo.classList.remove('on');
    document.removeEventListener('keydown', tecla);
    setTimeout(() => fundo.remove(), 200);
    anterior?.focus?.();
  };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  const caixa = h('div', { class: `folha ${classe}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('header', { class: 'folha-topo' },
      h('div', { class: 'folha-titulos' }, h('h2', {}, titulo), subtitulo ? h('p', { class: 'mudo' }, subtitulo) : null),
      botao('', { icone: 'fechar', classe: 'btn-fechar', titulo: 'Fechar', onclick: () => fechar() })),
    typeof corpo === 'function' ? corpo(fechar) : corpo);
  const fundo = h('div', { class: 'folha-fundo', onclick: (e) => { if (e.target === fundo) fechar(); } }, caixa);
  document.body.append(fundo);
  document.addEventListener('keydown', tecla);
  requestAnimationFrame(() => {
    fundo.classList.add('on');
    (caixa.querySelector('[autofocus]') || caixa.querySelector('input, textarea, button:not(.btn-fechar)'))?.focus();
  });
  return fechar;
}

export function menu(ancora, itens) {
  document.querySelector('.menu')?.remove();
  const fechar = () => { m.remove(); document.removeEventListener('pointerdown', fora, true); document.removeEventListener('keydown', tecla); };
  const fora = (e) => { if (!m.contains(e.target)) fechar(); };
  const tecla = (e) => { if (e.key === 'Escape') { fechar(); ancora.focus(); } };
  const m = h('div', { class: 'menu', role: 'menu' }, itens.filter(Boolean).map((it) => (it === '-' ? h('hr') :
    h('button', { type: 'button', role: 'menuitem', class: it.perigo ? 'perigo' : '', onclick: () => { fechar(); it.acao(); } }, ic(it.icone), h('span', {}, it.rotulo)))));
  document.body.append(m);
  const r = ancora.getBoundingClientRect();
  const w = m.offsetWidth;
  const hh = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + hh + 8 > innerHeight ? Math.max(8, r.top - hh - 6) : r.bottom + 6}px`;
  setTimeout(() => document.addEventListener('pointerdown', fora, true));
  document.addEventListener('keydown', tecla);
  m.querySelector('button')?.focus();
}

export function confirmar(titulo, texto, rotulo = 'Excluir') {
  return new Promise((ok) => {
    let sim = false;
    folha(titulo, (f) => h('div', { class: 'folha-corpo' }, h('p', {}, texto),
      h('div', { class: 'acoes' },
        botao('Cancelar', { classe: 'btn-sec', onclick: () => f() }),
        botao(rotulo, { classe: 'btn-perigo', onclick: () => { sim = true; f(); } }))), { onFechar: () => ok(sim) });
  });
}

export function quando(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `há ${hr} h`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

// Como na lista do app de celular: "hoje", "ontem" ou a data.
export function dia(ms) {
  const d = new Date(ms);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 864e5);
  if (d.toDateString() === hoje.toDateString()) return 'hoje';
  if (d.toDateString() === ontem.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

export async function copiar(texto, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(aviso);
  } catch {
    toast('Não consegui copiar');
  }
}
