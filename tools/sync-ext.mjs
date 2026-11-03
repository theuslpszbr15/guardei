// Copia os módulos compartilhados para a extensão (ela não pode importar fora da própria pasta).
import { copyFileSync } from 'node:fs';

for (const f of ['config.js', 'firestore-rest.js', 'link.js']) {
  copyFileSync(`js/${f}`, `extension/lib/${f}`);
  console.log(`js/${f} -> extension/lib/${f}`);
}
