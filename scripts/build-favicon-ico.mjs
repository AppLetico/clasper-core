#!/usr/bin/env node
/**
 * Build favicon.ico from favicon.svg using resvg (proper stroke/mask rendering).
 * Run: node scripts/build-favicon-ico.mjs
 * Requires: npm i -D @resvg/resvg-js png-to-ico
 */
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const opsUi = join(root, 'src', 'ops-ui');
const faviconSvgPath = join(opsUi, 'favicon.svg');
const faviconIcoPath = join(opsUi, 'favicon.ico');

const SIZES = [16, 32, 48, 64, 128, 256];

// SVG with explicit stroke (no CSS) so resvg renders the outline like favicon.svg
function svgWithExplicitStroke(svgContent) {
  return svgContent
    .replace(/<style>[\s\S]*?<\/style>\s*/i, '')
    .replace(/<g class="logo-stroke" stroke-width="8">/, '<g stroke="#0f172a" stroke-width="8">');
}

const svgRaw = readFileSync(faviconSvgPath, 'utf-8');
const svg = svgWithExplicitStroke(svgRaw);

const tmpDir = mkdtempSync(join(root, 'favicon-ico-'));
const pngPaths = [];

try {
  for (const size of SIZES) {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const path = join(tmpDir, `favicon-${size}.png`);
    writeFileSync(path, pngBuffer);
    pngPaths.push(path);
  }

  const icoBuffer = await pngToIco(pngPaths);
  writeFileSync(faviconIcoPath, icoBuffer);
  console.log('Wrote', faviconIcoPath);
} finally {
  for (const p of pngPaths) {
    try { unlinkSync(p); } catch (_) {}
  }
  try { rmdirSync(tmpDir); } catch (_) {}
}
