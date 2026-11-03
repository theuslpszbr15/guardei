// QR code em SVG (desenhado com DOM, sem innerHTML).
import { qrcode } from '../vendor/qrcode.mjs';

export function qrSvg(texto, tamanho = 200) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margem = 2;
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c + margem} ${r + margem}h1v1h-1z`;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const total = n + margem * 2;
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code para ${texto}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const fundo = document.createElementNS(ns, 'rect');
  fundo.setAttribute('width', total);
  fundo.setAttribute('height', total);
  fundo.setAttribute('fill', '#fff');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(fundo, path);
  return svg;
}
