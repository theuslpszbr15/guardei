// Firestore + Firebase Auth via REST (sem SDK). Usado pela extensão do Chrome e pelo servidor MCP.

const ID_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

async function postar(url, corpo, tipo = 'json') {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': tipo === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: tipo === 'json' ? JSON.stringify(corpo) : new URLSearchParams(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return d;
}

// ---- Conversão para o formato de valores do Firestore ----
export function paraValor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraValor) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraValor(x)])) } };
}

export function deValor(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, deValor(x)]));
  return null;
}

const deDoc = (d) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, deValor(v)])) });
const campos = (dados) => Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, paraValor(v)]));

export async function login(apiKey, email, senha) {
  const d = await postar(`${ID_URL}:signInWithPassword?key=${apiKey}`, { email, password: senha, returnSecureToken: true });
  return { uid: d.localId, email: d.email, nome: d.displayName || '', idToken: d.idToken, refreshToken: d.refreshToken, expira: Date.now() + Number(d.expiresIn) * 1000 };
}

export async function cadastrar(apiKey, email, senha) {
  const d = await postar(`${ID_URL}:signUp?key=${apiKey}`, { email, password: senha, returnSecureToken: true });
  return { uid: d.localId, email: d.email, nome: '', idToken: d.idToken, refreshToken: d.refreshToken, expira: Date.now() + Number(d.expiresIn) * 1000 };
}

export async function apagarConta(apiKey, idToken) {
  await postar(`${ID_URL}:delete?key=${apiKey}`, { idToken });
}

// Cliente do app Guardei para um usuário; renova o token sozinho e avisa (aoRenovar) para guardar o refreshToken novo.
export function cliente({ apiKey, projectId, appId, sessao, aoRenovar }) {
  let s = { ...sessao };
  const base = () => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${s.uid}/apps/${appId}`;

  async function token() {
    if (s.idToken && Date.now() < (s.expira || 0) - 60000) return s.idToken;
    const d = await postar(`${TOKEN_URL}?key=${apiKey}`, { grant_type: 'refresh_token', refresh_token: s.refreshToken }, 'form');
    s = { ...s, uid: d.user_id, idToken: d.id_token, refreshToken: d.refresh_token, expira: Date.now() + Number(d.expires_in) * 1000 };
    await aoRenovar?.(s);
    return s.idToken;
  }

  async function chamar(caminho, { metodo = 'GET', corpo, query = '' } = {}) {
    const r = await fetch(`${base()}${caminho}${query}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 404 && metodo === 'GET') return null;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error?.message || `Firestore ${r.status}`);
    return d;
  }

  return {
    get sessao() { return s; },
    async listar(colecao, mascara) {
      const itens = [];
      let pagina = '';
      do {
        const q = new URLSearchParams({ pageSize: '300' });
        if (pagina) q.set('pageToken', pagina);
        for (const c of mascara || []) q.append('mask.fieldPaths', c);
        const d = await chamar(`/${colecao}`, { query: `?${q}` });
        itens.push(...(d?.documents || []).map(deDoc));
        pagina = d?.nextPageToken || '';
      } while (pagina);
      return itens;
    },
    async ler(colecao, id) {
      const d = await chamar(`/${colecao}/${encodeURIComponent(id)}`);
      return d ? deDoc(d) : null;
    },
    async lerBase() {
      const d = await chamar('');
      return d ? deDoc(d) : {};
    },
    async criar(colecao, dados) {
      return deDoc(await chamar(`/${colecao}`, { metodo: 'POST', corpo: { fields: campos(dados) } }));
    },
    async atualizar(colecao, id, dados) {
      const q = new URLSearchParams();
      for (const k of Object.keys(dados)) q.append('updateMask.fieldPaths', k);
      q.set('currentDocument.exists', 'true');
      return deDoc(await chamar(`/${colecao}/${encodeURIComponent(id)}`, { metodo: 'PATCH', query: `?${q}`, corpo: { fields: campos(dados) } }));
    },
    async apagar(colecao, id) {
      await chamar(`/${colecao}/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
    },
  };
}
