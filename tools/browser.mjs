// Chrome headless e puppeteer-core reaproveitados da instalação do HyperFrames (ou via variáveis de ambiente).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function acharChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');
  if (!existsSync(base)) throw new Error('Defina CHROME_PATH com o caminho do Chrome.');
  const versao = readdirSync(base).sort().pop();
  return join(base, versao, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
}

export const chromePath = acharChrome();
export const puppeteerPath = process.env.PUPPETEER_CORE || join(process.env.APPDATA || '', 'npm', 'node_modules', 'hyperframes', 'node_modules', 'puppeteer-core');
