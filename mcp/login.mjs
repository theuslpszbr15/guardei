// Login do MCP no terminal: npm run mcp:login
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { emailDe, firebaseConfig } from '../js/config.js';
import { login } from '../js/firestore-rest.js';
import { ARQUIVO, gravarSessao } from './sessao.mjs';

const rl = createInterface({ input: stdin, output: stdout });
const usuario = (await rl.question('Usuário do Guardei: ')).trim();
rl.close();

// Esconde a senha enquanto digita.
stdout.write('Senha: ');
const senha = await new Promise((ok) => {
  let s = '';
  stdin.setRawMode?.(true);
  stdin.resume();
  const ler = (b) => {
    for (const c of b.toString('utf8')) {
      if (c === '\r' || c === '\n') {
        stdin.setRawMode?.(false);
        stdin.off('data', ler);
        stdout.write('\n');
        return ok(s);
      }
      if (c === '\u0003') process.exit(1);
      if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
      else s += c;
    }
  };
  stdin.on('data', ler);
});

try {
  const s = await login(firebaseConfig.apiKey, emailDe(usuario), senha);
  gravarSessao(s);
  console.log(`Pronto! Sessão salva em ${ARQUIVO}`);
  process.exit(0);
} catch (e) {
  console.error(`Não deu para entrar: ${e.message}`);
  process.exit(1);
}
