// Login e dados sincronizados (Firestore com cache offline) do app web.
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from '../vendor/firebase/firebase-auth.js';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from '../vendor/firebase/firebase-firestore.js';
import { APP_ID, emailDe, firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

export function sessaoAtual() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export const entrar = async (usuario, senha) => (await signInWithEmailAndPassword(auth, emailDe(usuario), senha)).user;

export async function cadastrar(usuario, senha, nome) {
  const { user } = await createUserWithEmailAndPassword(auth, emailDe(usuario), senha);
  if (nome) await updateProfile(user, { displayName: nome });
  return user;
}

export const sair = () => signOut(auth);

const base = (uid) => doc(db, 'users', uid, 'apps', APP_ID);
const salvosCol = (uid) => collection(base(uid), 'saves');
const pastasCol = (uid) => collection(base(uid), 'folders');

const comId = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function ouvirSalvos(uid, cb) {
  return onSnapshot(salvosCol(uid), (snap) => cb(comId(snap).sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))));
}

export function ouvirPastas(uid, cb) {
  return onSnapshot(pastasCol(uid), (snap) => cb(comId(snap).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))));
}

export function ouvirAjustes(uid, cb) {
  return onSnapshot(base(uid), (snap) => cb(snap.data() || {}));
}

// Gravações não esperam o servidor (offline elas só confirmam quando a conexão volta); falhas vão para aoErro.
let tratarErro = (e) => console.error(e);
export const aoErro = (fn) => { tratarErro = fn; };
const enviar = (p) => {
  p.catch((e) => tratarErro(e));
  return p;
};

export const salvarAjustes = (uid, dados) => { enviar(setDoc(base(uid), dados, { merge: true })); };

export function criarSalvo(uid, dados) {
  const agora = Date.now();
  const ref = doc(salvosCol(uid));
  enviar(setDoc(ref, { pastas: [], verDepois: false, visto: false, nota: '', status: 'pendente', criadoEm: agora, atualizadoEm: agora, ...dados }));
  return ref.id;
}

export const atualizarSalvo = (uid, id, dados) => enviar(updateDoc(doc(salvosCol(uid), id), { ...dados, atualizadoEm: Date.now() }));
export const apagarSalvo = (uid, id) => { enviar(deleteDoc(doc(salvosCol(uid), id))); };
export const restaurarSalvo = (uid, { id, ...dados }) => { enviar(setDoc(doc(salvosCol(uid), id), dados)); };

// Marca o salvo como "lendo" só se ninguém (outra aba/aparelho) pegou nos últimos 2 minutos.
// Devolve 'ok', 'ocupado' ou 'sumiu' (ainda não chegou ao servidor ou foi excluído).
export const LENDO_MAX_MS = 120000;
export async function reservarProcessamento(uid, id) {
  const ref = doc(salvosCol(uid), id);
  return runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists()) return 'sumiu';
    const d = s.data();
    const livre = d.status === 'pendente' || (d.status === 'lendo' && Date.now() - (d.lendoDesde || 0) > LENDO_MAX_MS);
    if (!livre) return 'ocupado';
    tx.update(ref, { status: 'lendo', lendoDesde: Date.now() });
    return 'ok';
  });
}

export function criarPasta(uid, nome) {
  const ref = doc(pastasCol(uid));
  enviar(setDoc(ref, { nome: nome.trim().slice(0, 60), criadoEm: Date.now() }));
  return ref.id;
}
export const renomearPasta = (uid, id, nome) => { enviar(updateDoc(doc(pastasCol(uid), id), { nome: nome.trim().slice(0, 60) })); };

export function apagarPasta(uid, id, salvos) {
  const lote = writeBatch(db);
  for (const s of salvos.filter((x) => x.pastas?.includes(id))) lote.update(doc(salvosCol(uid), s.id), { pastas: arrayRemove(id) });
  lote.delete(doc(pastasCol(uid), id));
  enviar(lote.commit());
}

export function colocarNaPasta(uid, ids, pastaId, dentro = true) {
  const lote = writeBatch(db);
  for (const id of ids) lote.update(doc(salvosCol(uid), id), { pastas: dentro ? arrayUnion(pastaId) : arrayRemove(pastaId), atualizadoEm: Date.now() });
  enviar(lote.commit());
}
