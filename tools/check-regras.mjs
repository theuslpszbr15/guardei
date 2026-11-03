// Confere as regras do Firestore: sem login ninguém lê nada, e uma conta não lê nem escreve na outra.
import { APP_ID, emailDe, firebaseConfig } from '../js/config.js';
import { apagarConta, cadastrar, cliente } from '../js/firestore-rest.js';

const { apiKey, projectId } = firebaseConfig;
const base = (uid) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/apps/${APP_ID}/saves`;
const sufixo = Date.now().toString(36);
const contas = [];
let falhas = 0;
const conferir = (ok, msg) => { console.log(`  ${ok ? 'ok ' : 'FALHA'} ${msg}`); if (!ok) falhas += 1; };

try {
  const a = await cadastrar(apiKey, emailDe(`regraa${sufixo}`), 'teste-123456');
  const b = await cadastrar(apiKey, emailDe(`regrab${sufixo}`), 'teste-123456');
  contas.push(a, b);
  const apiA = cliente({ apiKey, projectId, appId: APP_ID, sessao: a });
  await apiA.criar('saves', { url: 'https://exemplo.com', titulo: 'segredo da conta A' });

  const semLogin = await fetch(base(a.uid));
  conferir(semLogin.status === 403, `sem login, ler os salvos da conta A -> ${semLogin.status}`);

  const bLendoA = await fetch(base(a.uid), { headers: { Authorization: `Bearer ${b.idToken}` } });
  conferir(bLendoA.status === 403, `conta B lendo os salvos da conta A -> ${bLendoA.status}`);

  const bEscrevendoA = await fetch(base(a.uid), {
    method: 'POST',
    headers: { Authorization: `Bearer ${b.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { url: { stringValue: 'https://invasor' } } }),
  });
  conferir(bEscrevendoA.status === 403, `conta B gravando na conta A -> ${bEscrevendoA.status}`);

  const aLendoA = await fetch(base(a.uid), { headers: { Authorization: `Bearer ${a.idToken}` } });
  conferir(aLendoA.status === 200, `conta A lendo os próprios salvos -> ${aLendoA.status}`);
} finally {
  for (const c of contas) {
    const api = cliente({ apiKey, projectId, appId: APP_ID, sessao: c });
    for (const d of await api.listar('saves').catch(() => [])) await api.apagar('saves', d.id);
    await apagarConta(apiKey, c.idToken).catch(() => {});
  }
  console.log(`contas de teste apagadas (${contas.length})`);
}
if (falhas) process.exitCode = 1;
