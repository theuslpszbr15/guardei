// Sessão do MCP: guarda só o refreshToken (nunca a senha) em ~/.guardei/sessao.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ID, firebaseConfig } from '../js/config.js';
import { cliente } from '../js/firestore-rest.js';

export const ARQUIVO = process.env.GUARDEI_SESSAO || join(homedir(), '.guardei', 'sessao.json');

export function lerSessao() {
  try {
    return JSON.parse(readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return null;
  }
}

export function gravarSessao(s) {
  mkdirSync(join(ARQUIVO, '..'), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify({ uid: s.uid, email: s.email, nome: s.nome, refreshToken: s.refreshToken }, null, 2), { mode: 0o600 });
}

export function criarCliente(sessao = lerSessao()) {
  if (!sessao?.refreshToken) throw new Error(`Sem login. Rode "npm run mcp:login" na pasta mcp (sessão esperada em ${ARQUIVO}).`);
  return cliente({ apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, appId: APP_ID, sessao, aoRenovar: gravarSessao });
}
