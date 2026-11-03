// Mapa 3D dos salvos (estilo grafo do Obsidian): pastas, categorias e tags ligadas aos salvos.
// Arraste para girar, role/pinça para aproximar, botão direito/dois dedos para mover.
import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { normalizar } from './search.js';

const CORES_CAT = {
  Receita: '#f59e0b', Lugar: '#10b981', Restaurante: '#ef4444', 'Filmes e séries': '#8b5cf6', Treino: '#14b8a6', Produto: '#ec4899',
  Dica: '#eab308', Música: '#6366f1', Livro: '#a16207', Moda: '#db2777', Beleza: '#f472b6', 'Casa e decoração': '#84cc16',
  Tecnologia: '#0ea5e9', Finanças: '#22c55e', Humor: '#f97316', 'Carreira e estudos': '#3b82f6', Outro: '#9ca3af',
};
const RAIO = { pasta: 1.7, cat: 1.15, tag: 0.6, salvo: 0.55 };
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
  caixa.append(canvas, rotulos, dica);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(0, 18, 70);
  const controles = new OrbitControls(camera, canvas);
  if (cameraAntiga) {
    camera.position.copy(cameraAntiga.pos);
    controles.target.copy(cameraAntiga.alvo);
  }
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.autoRotate = !reduzir && !cameraAntiga;
  controles.autoRotateSpeed = 0.6;
  controles.minDistance = 4;
  controles.maxDistance = 400;
  cena.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
  const luz = new THREE.DirectionalLight(0xffffff, 1.2);
  luz.position.set(30, 50, 40);
  cena.add(luz);

  const geos = Object.fromEntries(Object.entries(RAIO).map(([k, r]) => [k, new THREE.SphereGeometry(r, k === 'salvo' ? 16 : 24, k === 'salvo' ? 12 : 18)]));
  const grupoNos = new THREE.Group();
  cena.add(grupoNos);
  const linhasGeo = new THREE.BufferGeometry();
  const linhasMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 });
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

  let opacidadeLinhas = 0.35;
  function aplicarTema() {
    const fundo = new THREE.Color(css('--card') || '#000');
    const escuro = fundo.getHSL({}).l < 0.5;
    cena.background = fundo;
    linhasMat.color = new THREE.Color(escuro ? '#8e8e93' : '#9a9aa0');
    opacidadeLinhas = escuro ? 0.4 : 0.5;
    aplicarDestaque();
  }

  function corDo(n) {
    if (n.tipo === 'pasta') return css('--azul') || '#208aef';
    if (n.tipo === 'tag') return '#8e8e93';
    return n.cor;
  }

  function definir(salvos, pastas, ver) {
    for (const n of nos) posAntigas.set(n.id, n.p.clone());
    grupoNos.clear();
    rotulos.replaceChildren();
    ({ nos, arestas } = montarGrafo(salvos, pastas, ver));
    porId = new Map(nos.map((n) => [n.id, n]));
    vizinhos = new Map(nos.map((n) => [n.id, new Set()]));
    for (const [a, b] of arestas) { vizinhos.get(a).add(b); vizinhos.get(b).add(a); }
    const r = 10 + Math.cbrt(nos.length) * 8;
    for (const n of nos) {
      n.p = posAntigas.get(n.id)?.clone() || new THREE.Vector3((Math.random() - 0.5) * r, (Math.random() - 0.5) * r, (Math.random() - 0.5) * r);
      n.v = new THREE.Vector3();
      const escala = n.tipo === 'salvo' ? 1 : 1 + Math.min(n.grau, 30) * 0.03;
      n.mat = new THREE.MeshStandardMaterial({ color: corDo(n), roughness: 0.55, metalness: 0.05, transparent: true });
      n.mesh = new THREE.Mesh(geos[n.tipo], n.mat);
      n.mesh.scale.setScalar(escala);
      n.mesh.userData.id = n.id;
      grupoNos.add(n.mesh);
      n.el = document.createElement('span');
      n.el.className = `mapa-rotulo ${n.tipo}`;
      n.el.title = n.rotulo;
      n.el.textContent = n.rotulo.length > 40 ? `${n.rotulo.slice(0, 40)}…` : n.rotulo;
      rotulos.append(n.el);
    }
    linhasGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arestas.length * 6), 3));
    calor = nos.every((n) => posAntigas.has(n.id)) ? 0.05 : posAntigas.size ? 0.5 : 1;
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
        const f = (a.tipo === 'salvo' && b.tipo === 'salvo' ? 22 : 60) / dist2;
        d.normalize().multiplyScalar(f * calor);
        a.v.add(d);
        b.v.sub(d);
      }
    }
    for (const [ia, ib] of arestas) {
      const a = porId.get(ia);
      const b = porId.get(ib);
      d.subVectors(b.p, a.p);
      const alvo = b.tipo === 'pasta' || a.tipo === 'pasta' ? 7 : 9;
      const f = (d.length() - alvo) * 0.035 * calor;
      d.normalize().multiplyScalar(f);
      a.v.add(d);
      b.v.sub(d);
    }
    for (const no of nos) {
      no.v.addScaledVector(no.p, -0.02 * calor);
      no.v.multiplyScalar(0.82);
      no.p.add(no.v);
    }
    calor = Math.max(calor * 0.992, 0.02);
  }

  function aplicarDestaque() {
    const q = normalizar(destaque).trim();
    const viz = hover ? vizinhos.get(hover.id) : null;
    for (const n of nos) {
      const bate = q && normalizar(`${n.rotulo} ${n.salvo?.resumo || ''} ${n.salvo?.categoria || ''} ${(n.salvo?.tags || []).join(' ')} ${n.salvo?.nota || ''}`).includes(q);
      const ativo = hover ? n === hover || viz.has(n.id) : q ? bate : true;
      n.mat.opacity = ativo ? 1 : 0.12;
      n.mat.emissive = new THREE.Color(bate || n === hover ? corDo(n) : '#000');
      n.mat.emissiveIntensity = bate || n === hover ? 0.5 : 0;
      n.ativo = ativo;
      n.bate = bate;
    }
    linhasMat.opacity = hover || q ? opacidadeLinhas * 0.35 : opacidadeLinhas;
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
  function atualizarRotulos() {
    const w = caixa.clientWidth;
    const h = caixa.clientHeight;
    let salvosVisiveis = 0;
    for (const n of nos) {
      v.copy(n.p).project(camera);
      const dist = camera.position.distanceTo(n.p);
      const naFrente = v.z < 1;
      let mostrar = naFrente && n.ativo !== false;
      if (n.tipo === 'salvo') mostrar = mostrar && (n === hover || n.bate || ((dist < 28 || nos.length < 40) && salvosVisiveis++ < 60));
      if (n.tipo === 'tag') mostrar = mostrar && (n === hover || dist < 45);
      n.el.style.display = mostrar ? '' : 'none';
      if (!mostrar) continue;
      const raioTela = (RAIO[n.tipo] * n.mesh.scale.x * h) / (dist * Math.tan((camera.fov * Math.PI) / 360) * 2);
      n.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, ${Math.round(raioTela + 4)}px)`;
      n.el.style.opacity = String(Math.max(0.25, Math.min(1, 1.6 - dist / 120)));
    }
  }

  function quadro() {
    raf = requestAnimationFrame(quadro);
    if (calor > 0.021) for (let i = 0; i < (nos.length > 400 ? 1 : 2); i += 1) passo();
    // Primeira montagem: quando o layout quase assenta, enquadra tudo na tela.
    if (!enquadrado && calor < 0.15) { enquadrado = true; if (!cameraAntiga) centralizar(); }
    for (const n of nos) n.mesh.position.copy(n.p);
    atualizarLinhas();
    controles.update();
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
    const raio = Math.max(caixa3.getSize(new THREE.Vector3()).length() / 2, 8);
    const fovV = (camera.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    focar({ p: centro }, (raio / Math.sin(Math.min(fovV, fovH) / 2)) * 0.85);
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
      Object.values(geos).forEach((g) => g.dispose());
      linhasGeo.dispose();
      linhasMat.dispose();
      renderer.dispose();
    },
  };
}
