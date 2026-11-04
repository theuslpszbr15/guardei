// Mapa 3D dos salvos (estilo grafo do Obsidian): pastas, categorias e tags ligadas aos salvos.
// Arraste para girar, role/pinça para aproximar, botão direito/dois dedos para mover.
import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { normalizar } from './search.js';
import { icone, iconeCategoria } from './icons.js';

const CORES_CAT = {
  Receita: '#f59e0b', Lugar: '#10b981', Restaurante: '#ef4444', 'Filmes e séries': '#8b5cf6', Treino: '#14b8a6', Produto: '#ec4899',
  Dica: '#eab308', Música: '#6366f1', Livro: '#a16207', Moda: '#db2777', Beleza: '#f472b6', 'Casa e decoração': '#84cc16',
  Tecnologia: '#0ea5e9', Finanças: '#22c55e', Humor: '#f97316', 'Carreira e estudos': '#3b82f6', Outro: '#9ca3af',
};
// Lado do sprite de cada tipo, em unidades do mundo.
const TAM = { pasta: 3.6, cat: 2.8, tag: 1.3, salvo: 1.4 };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Guarda posições entre visitas: voltar de um salvo reabre o mapa do mesmo jeito.
const posAntigas = new Map();
let cameraAntiga = null;

export function suportaWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Texturas desenhadas em canvas (nós planos, sempre de frente para a câmera).
function criarTexturas() {
  const cache = new Map();
  const nova = (chave, desenhar) => {
    if (cache.has(chave)) return cache.get(chave);
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    desenhar(c.getContext('2d'), () => { t.needsUpdate = true; });
    cache.set(chave, t);
    return t;
  };
  const comIcone = (ctx, nome, pronto, tam) => {
    const svg = icone(nome).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor', '#fff');
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 64 - tam / 2, 64 - tam / 2, tam, tam); pronto(); };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const circulo = (ctx, r) => { ctx.beginPath(); ctx.arc(64, 64, r, 0, Math.PI * 2); };
  return {
    salvo: (cor, borda) => nova(`s${cor}${borda}`, (ctx) => {
      circulo(ctx, 50);
      ctx.fillStyle = cor;
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.strokeStyle = borda;
      ctx.stroke();
    }),
    pasta: (cor) => nova(`p${cor}`, (ctx, pronto) => {
      ctx.beginPath();
      ctx.roundRect(8, 8, 112, 112, 32);
      ctx.fillStyle = cor;
      ctx.fill();
      comIcone(ctx, 'pastas', pronto, 62);
    }),
    cat: (cor, nome) => nova(`c${cor}${nome}`, (ctx, pronto) => {
      circulo(ctx, 60);
      ctx.fillStyle = cor;
      ctx.fill();
      comIcone(ctx, iconeCategoria(nome), pronto, 58);
    }),
    tag: (cor, fundo) => nova(`t${cor}${fundo}`, (ctx) => {
      circulo(ctx, 46);
      ctx.fillStyle = fundo;
      ctx.fill();
      ctx.lineWidth = 16;
      ctx.strokeStyle = cor;
      ctx.stroke();
    }),
    halo: () => nova('halo', (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }),
    destruir: () => cache.forEach((t) => t.dispose()),
  };
}

function montarGrafo(salvos, pastas, ver) {
  const nos = new Map();
  const arestas = [];
  const no = (id, tipo, rotulo, extra = {}) => {
    if (!nos.has(id)) nos.set(id, { id, tipo, rotulo, grau: 0, ...extra });
    return nos.get(id);
  };
  const ligar = (a, b) => { arestas.push([a.id, b.id]); a.grau += 1; b.grau += 1; };
  if (ver.pastas) for (const p of pastas) no(`p:${p.id}`, 'pasta', p.nome, { pastaId: p.id });
  for (const s of salvos) {
    const n = no(`s:${s.id}`, 'salvo', s.titulo || s.tituloOriginal || s.url, { salvo: s, cor: CORES_CAT[s.categoria] || CORES_CAT.Outro });
    if (ver.pastas) for (const pid of s.pastas || []) if (nos.has(`p:${pid}`)) ligar(n, nos.get(`p:${pid}`));
    if (ver.cats && s.categoria) ligar(n, no(`c:${s.categoria}`, 'cat', s.categoria, { cor: CORES_CAT[s.categoria] || CORES_CAT.Outro }));
    if (ver.tags) for (const t of s.tags || []) ligar(n, no(`t:${t}`, 'tag', `#${t}`));
  }
  return { nos: [...nos.values()], arestas };
}

export function montarMapa(caixa, { aoAbrirSalvo, aoAbrirPasta }) {
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.className = 'mapa-canvas';
  const rotulos = document.createElement('div');
  rotulos.className = 'mapa-rotulos';
  const dica = document.createElement('div');
  dica.className = 'mapa-dica';
  dica.hidden = true;
  const legenda = document.createElement('div');
  legenda.className = 'mapa-legenda';
  legenda.innerHTML = '<span data-k="salvo"><i class="lg-salvo"></i>Salvo</span><span data-k="pastas"><i class="lg-pasta"></i>Pasta</span><span data-k="cats"><i class="lg-cat"></i>Categoria</span><span data-k="tags"><i class="lg-tag"></i>Tag</span>';
  caixa.append(canvas, rotulos, dica, legenda);

  const cena = new THREE.Scene();
  cena.fog = new THREE.Fog(0xffffff, 40, 160);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  camera.position.set(0, 18, 70);
  const controles = new OrbitControls(camera, canvas);
  if (cameraAntiga) {
    camera.position.copy(cameraAntiga.pos);
    controles.target.copy(cameraAntiga.alvo);
  }
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.autoRotate = !reduzir && !cameraAntiga;
  controles.autoRotateSpeed = 0.5;
  controles.minDistance = 4;
  controles.maxDistance = 400;
  // Depois que a pessoa mexe na câmera, o mapa não reenquadra sozinho.
  let mexeu = !!cameraAntiga;
  controles.addEventListener('start', () => { mexeu = true; });

  const tex = criarTexturas();
  const grupoHalos = new THREE.Group();
  const grupoNos = new THREE.Group();
  cena.add(grupoHalos, grupoNos);
  const linhasGeo = new THREE.BufferGeometry();
  const linhasMat = new THREE.LineBasicMaterial({ vertexColors: true });
  const linhas = new THREE.LineSegments(linhasGeo, linhasMat);
  cena.add(linhas);

  let nos = [];
  let arestas = [];
  let porId = new Map();
  let vizinhos = new Map();
  let calor = 1;
  let destaque = '';
  let hover = null;
  let raf = 0;
  let enquadrado = false;
  let reenquadrado = false;

  let fundo = new THREE.Color('#fff');
  let fundoHex = '#ffffff';
  let escuro = false;
  function aplicarTema() {
    fundo = new THREE.Color(css('--card') || '#fff');
    fundoHex = `#${fundo.getHexString()}`;
    escuro = fundo.getHSL({}).l < 0.5;
    cena.background = fundo;
    cena.fog.color = fundo;
    for (const n of nos) {
      n.mat.map = texturaDo(n);
      n.mat.needsUpdate = true;
    }
    aplicarDestaque();
  }

  function corDo(n) {
    if (n.tipo === 'pasta') return css('--azul') || '#208aef';
    if (n.tipo === 'tag') return escuro ? '#98989f' : '#8e8e93';
    return n.cor;
  }

  function texturaDo(n) {
    if (n.tipo === 'pasta') return tex.pasta(corDo(n));
    if (n.tipo === 'cat') return tex.cat(n.cor, n.rotulo);
    if (n.tipo === 'tag') return tex.tag(corDo(n), fundoHex);
    return tex.salvo(n.cor, fundoHex);
  }

  function definir(salvos, pastas, ver) {
    for (const n of nos) posAntigas.set(n.id, n.p.clone());
    for (const n of nos) n.mat.dispose();
    for (const h of grupoHalos.children) h.material.dispose();
    grupoNos.clear();
    grupoHalos.clear();
    rotulos.replaceChildren();
    for (const item of legenda.children) item.hidden = item.dataset.k !== 'salvo' && !ver[item.dataset.k];
    ({ nos, arestas } = montarGrafo(salvos, pastas, ver));
    porId = new Map(nos.map((n) => [n.id, n]));
    vizinhos = new Map(nos.map((n) => [n.id, new Set()]));
    for (const [a, b] of arestas) { vizinhos.get(a).add(b); vizinhos.get(b).add(a); }
    const r = 8 + Math.cbrt(nos.length) * 6;
    for (const n of nos) {
      n.p = posAntigas.get(n.id)?.clone() || new THREE.Vector3((Math.random() - 0.5) * r, (Math.random() - 0.5) * r, (Math.random() - 0.5) * r);
      n.v = new THREE.Vector3();
      n.escala = n.tipo === 'salvo' || n.tipo === 'tag' ? 1 : 1 + Math.min(n.grau, 30) * 0.035;
      n.mat = new THREE.SpriteMaterial({ map: texturaDo(n), transparent: true, depthTest: false, depthWrite: false });
      n.mesh = new THREE.Sprite(n.mat);
      n.mesh.scale.setScalar(TAM[n.tipo] * n.escala);
      n.mesh.userData.id = n.id;
      grupoNos.add(n.mesh);
      n.halo = null;
      n.el = document.createElement('span');
      n.el.className = `mapa-rotulo ${n.tipo}`;
      n.el.title = n.rotulo;
      if (n.tipo === 'salvo' && n.salvo.capa) {
        const img = document.createElement('img');
        img.src = n.salvo.capa;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.remove();
        n.el.append(img);
      }
      const limite = n.tipo === 'salvo' ? 34 : 40;
      n.el.append(n.rotulo.length > limite ? `${n.rotulo.slice(0, limite)}…` : n.rotulo);
      if (n.tipo === 'pasta' || n.tipo === 'cat') n.el.dataset.n = String(n.grau);
      rotulos.append(n.el);
    }
    for (const n of nos) n.tam = [n.el.offsetWidth, n.el.offsetHeight];
    linhasGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arestas.length * 6), 3));
    linhasGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arestas.length * 6), 3));
    calor = nos.every((n) => posAntigas.has(n.id)) ? 0.05 : posAntigas.size ? 0.5 : 1;
    if (!mexeu) { enquadrado = false; reenquadrado = false; }
    aplicarDestaque();
  }

  // Simulação de forças: repulsão entre todos, molas nas ligações e leve puxão para o centro.
  function passo() {
    const n = nos.length;
    const d = new THREE.Vector3();
    for (let i = 0; i < n; i += 1) {
      const a = nos[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = nos[j];
        d.subVectors(a.p, b.p);
        const dist2 = Math.max(d.lengthSq(), 0.5);
        const f = (a.tipo === 'salvo' && b.tipo === 'salvo' ? 16 : 50) / dist2;
        d.normalize().multiplyScalar(f * calor);
        a.v.add(d);
        b.v.sub(d);
      }
    }
    for (const [ia, ib] of arestas) {
      const a = porId.get(ia);
      const b = porId.get(ib);
      d.subVectors(b.p, a.p);
      const alvo = b.tipo === 'tag' ? 5 : b.tipo === 'pasta' ? 6.5 : 7;
      const f = (d.length() - alvo) * 0.035 * calor;
      d.normalize().multiplyScalar(f);
      a.v.add(d);
      b.v.sub(d);
    }
    for (const no of nos) {
      no.v.addScaledVector(no.p, -0.03 * calor);
      no.v.multiplyScalar(0.82);
      no.p.add(no.v);
    }
    calor = Math.max(calor * 0.992, 0.02);
  }

  const cor = new THREE.Color();
  function aplicarDestaque() {
    const q = normalizar(destaque).trim();
    const viz = hover ? vizinhos.get(hover.id) : null;
    for (const n of nos) {
      const bate = q && normalizar(`${n.rotulo} ${n.salvo?.resumo || ''} ${n.salvo?.categoria || ''} ${(n.salvo?.tags || []).join(' ')} ${n.salvo?.nota || ''}`).includes(q);
      const ativo = hover ? n === hover || viz.has(n.id) : q ? bate : true;
      n.mat.opacity = ativo ? 1 : 0.14;
      n.ativo = ativo;
      n.bate = bate;
      const brilha = bate || n === hover;
      if (brilha && !n.halo) {
        n.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.halo(), transparent: true, depthTest: false, depthWrite: false, opacity: 0.5 }));
        n.halo.renderOrder = -1;
        n.halo.position.copy(n.p);
        grupoHalos.add(n.halo);
      }
      if (n.halo) {
        n.halo.visible = brilha;
        n.halo.material.color.set(corDo(n));
        n.halo.scale.setScalar(TAM[n.tipo] * n.escala * 2.6);
      }
    }
    const filtrando = hover || q;
    const cores = linhasGeo.getAttribute('color');
    if (!cores) return;
    arestas.forEach(([ia, ib], i) => {
      const a = porId.get(ia);
      const b = porId.get(ib);
      const acesa = filtrando && a.ativo && b.ativo;
      cor.set(corDo(b)).lerp(fundo, acesa ? 0.1 : filtrando ? 0.9 : 0.35);
      cores.array.set([cor.r, cor.g, cor.b, cor.r, cor.g, cor.b], i * 6);
    });
    cores.needsUpdate = true;
  }

  function atualizarLinhas() {
    const pos = linhasGeo.getAttribute('position');
    if (!pos) return;
    arestas.forEach(([ia, ib], i) => {
      const a = porId.get(ia).p;
      const b = porId.get(ib).p;
      pos.array.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    pos.needsUpdate = true;
    linhasGeo.computeBoundingSphere();
  }

  const v = new THREE.Vector3();
  const PRIORIDADE = { pasta: 3, cat: 2, tag: 1, salvo: 0 };
  const esconder = (n) => { if (n.el.style.display !== 'none') n.el.style.display = 'none'; };
  // Rótulos: mais importantes e mais perto primeiro; quem cairia em cima de outro fica escondido.
  function atualizarRotulos() {
    const w = caixa.clientWidth;
    const h = caixa.clientHeight;
    const escalaTela = h / (Math.tan((camera.fov * Math.PI) / 360) * 2);
    const candidatos = [];
    const ocupados = [];
    for (const n of nos) {
      v.copy(n.p).project(camera);
      if (v.z >= 1 || n.ativo === false) { esconder(n); continue; }
      n.tx = ((v.x + 1) / 2) * w;
      n.ty = ((1 - v.y) / 2) * h;
      n.dist = camera.position.distanceTo(n.p);
      n.raio = ((TAM[n.tipo] / 2) * n.escala * escalaTela) / n.dist;
      n.prio = n === hover ? 20 : (n.bate ? 10 : 0) + PRIORIDADE[n.tipo];
      if (n.tipo !== 'salvo') ocupados.push([n.tx - n.raio, n.ty - n.raio, n.tx + n.raio, n.ty + n.raio]);
      candidatos.push(n);
    }
    candidatos.sort((a, b) => b.prio - a.prio || a.dist - b.dist);
    let salvos = 0;
    for (const n of candidatos) {
      const livre = n === hover || n.bate;
      if (n.tipo === 'salvo' && !livre && salvos >= 30) { esconder(n); continue; }
      if (!n.tam?.[0]) {
        n.el.style.display = '';
        n.tam = [n.el.offsetWidth, n.el.offsetHeight];
      }
      const [lw, lh] = n.tam;
      const x0 = n.tipo === 'salvo' ? n.tx + n.raio + 6 : n.tx - lw / 2;
      const y0 = n.tipo === 'salvo' ? n.ty - lh / 2 : n.ty + n.raio + 4;
      const r = [x0 - 3, y0 - 2, x0 + lw + 3, y0 + lh + 2];
      const fora = r[0] < 0 || r[2] > w || r[1] < 0 || r[3] > h;
      if (n !== hover && (fora || ocupados.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]))) { esconder(n); continue; }
      ocupados.push(r);
      if (n.tipo === 'salvo') salvos += 1;
      n.el.style.display = '';
      n.el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y0)}px)`;
      n.el.style.opacity = String(Math.max(0.35, Math.min(1, 1.7 - n.dist / 110)));
    }
  }

  function quadro() {
    raf = requestAnimationFrame(quadro);
    if (calor > 0.021) for (let i = 0; i < (nos.length > 400 ? 1 : 2); i += 1) passo();
    // Primeira montagem: enquadra quando o layout quase assenta e de novo quando para de vez.
    if (!enquadrado && calor < 0.15) { enquadrado = true; if (!mexeu) centralizar(); }
    if (!reenquadrado && calor < 0.03) { reenquadrado = true; if (!mexeu) centralizar(); }
    for (const n of nos) {
      n.mesh.position.copy(n.p);
      n.halo?.position.copy(n.p);
    }
    atualizarLinhas();
    controles.update();
    // Névoa acompanha o zoom: o que está atrás do centro vai sumindo no fundo.
    const d = camera.position.distanceTo(controles.target);
    cena.fog.near = d * 0.75;
    cena.fog.far = d * 2.4;
    renderer.render(cena, camera);
    atualizarRotulos();
  }

  // Hover e clique (clique = soltar sem arrastar).
  const ray = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  let inicio = null;
  function noSob(e) {
    const r = canvas.getBoundingClientRect();
    ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ponteiro, camera);
    const alvo = ray.intersectObjects(grupoNos.children, false).find((i) => porId.get(i.object.userData.id)?.ativo !== false);
    return alvo ? porId.get(alvo.object.userData.id) : null;
  }
  function mostrarDica(n, e) {
    if (!n) { dica.hidden = true; return; }
    dica.replaceChildren();
    const s = n.salvo;
    if (s?.capa) {
      const img = document.createElement('img');
      img.src = s.capa;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      dica.append(img);
    }
    const t = document.createElement('strong');
    t.textContent = s ? s.titulo || s.url : n.rotulo;
    const sub = document.createElement('small');
    sub.textContent = s ? [s.categoria, s.autor].filter(Boolean).join(' · ') : `${vizinhos.get(n.id).size} ligado${vizinhos.get(n.id).size === 1 ? '' : 's'}`;
    dica.append(t, sub);
    const r = caixa.getBoundingClientRect();
    dica.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 230)}px`;
    dica.style.top = `${Math.min(e.clientY - r.top + 14, r.height - 120)}px`;
    dica.hidden = false;
  }
  const aoMover = (e) => {
    if (e.pointerType === 'touch') return;
    const n = noSob(e);
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? 'pointer' : '';
      aplicarDestaque();
    }
    mostrarDica(n, e);
  };
  const aoDescer = (e) => { inicio = { x: e.clientX, y: e.clientY }; controles.autoRotate = false; };
  const aoSubir = (e) => {
    if (!inicio || Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 6) return;
    const n = noSob(e);
    if (!n) return;
    if (n.tipo === 'salvo') aoAbrirSalvo(n.salvo.id);
    else focar(n);
  };
  const aoSair = () => { hover = null; dica.hidden = true; aplicarDestaque(); };
  canvas.addEventListener('pointermove', aoMover);
  canvas.addEventListener('pointerdown', aoDescer);
  canvas.addEventListener('pointerup', aoSubir);
  canvas.addEventListener('pointerleave', aoSair);
  canvas.addEventListener('dblclick', (e) => { const n = noSob(e); if (n?.tipo === 'pasta') aoAbrirPasta(n.pastaId); });

  // Leva a câmera até o nó, mantendo a direção atual.
  function focar(n, distancia = 22) {
    const de = { alvo: controles.target.clone(), cam: camera.position.clone() };
    const dir = camera.position.clone().sub(controles.target).normalize();
    const para = { alvo: n.p.clone(), cam: n.p.clone().addScaledVector(dir, distancia) };
    const t0 = performance.now();
    const dur = reduzir ? 1 : 650;
    const anim = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      controles.target.lerpVectors(de.alvo, para.alvo, e);
      camera.position.lerpVectors(de.cam, para.cam, e);
      if (k < 1) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  function centralizar() {
    if (!nos.length) return;
    const caixa3 = new THREE.Box3();
    for (const n of nos) caixa3.expandByPoint(n.p);
    const centro = caixa3.getCenter(new THREE.Vector3());
    const raio = Math.max(...nos.map((n) => n.p.distanceTo(centro) + (TAM[n.tipo] * n.escala) / 2), 6);
    const fovV = (camera.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    focar({ p: centro }, raio / Math.sin(Math.min(fovV, fovH) / 2));
  }

  function redimensionar() {
    const w = caixa.clientWidth;
    const h = caixa.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const obs = new ResizeObserver(redimensionar);
  obs.observe(caixa);
  const temaObs = new MutationObserver(aplicarTema);
  temaObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
  const temaSistema = matchMedia('(prefers-color-scheme: dark)');
  temaSistema.addEventListener('change', aplicarTema);
  aplicarTema();
  redimensionar();
  quadro();

  return {
    definir,
    destacar(q) { destaque = q; aplicarDestaque(); },
    centralizar,
    // Assenta o layout de uma vez (usado nos testes e ao abrir com muitos nós).
    assentar(n = 300) { for (let i = 0; i < n && calor > 0.021; i += 1) passo(); },
    get total() { return nos.length; },
    destruir() {
      cancelAnimationFrame(raf);
      for (const n of nos) posAntigas.set(n.id, n.p.clone());
      cameraAntiga = { pos: camera.position.clone(), alvo: controles.target.clone() };
      obs.disconnect();
      temaObs.disconnect();
      temaSistema.removeEventListener('change', aplicarTema);
      controles.dispose();
      for (const n of nos) n.mat.dispose();
      for (const h of grupoHalos.children) h.material.dispose();
      tex.destruir();
      linhasGeo.dispose();
      linhasMat.dispose();
      renderer.dispose();
    },
  };
}
