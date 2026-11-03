// Copia o Three.js e o OrbitControls para vendor/ (o app roda sem bundler e sem CDN).
// Uso: node tools/vendor-three.mjs <pasta node_modules/three>
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const three = process.argv[2];
if (!three) throw new Error('Informe a pasta node_modules/three');
copyFileSync(join(three, 'build', 'three.module.min.js'), 'vendor/three.module.min.js');
copyFileSync(join(three, 'build', 'three.core.min.js'), 'vendor/three.core.min.js');
const orbit = readFileSync(join(three, 'examples', 'jsm', 'controls', 'OrbitControls.js'), 'utf8').replace(/from 'three'/g, "from './three.module.min.js'");
writeFileSync('vendor/OrbitControls.js', orbit);
console.log('three + OrbitControls -> vendor/');
