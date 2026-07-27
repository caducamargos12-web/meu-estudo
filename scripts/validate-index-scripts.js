#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const outDir = path.join(root, 'tmp', 'index-scripts');

if (!fs.existsSync(indexPath)) {
  console.error('index.html não encontrado na raiz do projeto.');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
let failed = false;

fs.mkdirSync(outDir, { recursive: true });

while ((match = scriptRegex.exec(html)) !== null) {
  const attrs = match[1] || '';
  const code = match[2] || '';

  if (/\bsrc\s*=/.test(attrs)) continue;
  if (!code.trim()) continue;

  count += 1;
  const file = path.join(outDir, `script-${count}.js`);
  fs.writeFileSync(file, code, 'utf8');

  try {
    new vm.Script(code, { filename: file });
    console.log(`OK script-${count}.js`);
  } catch (err) {
    failed = true;
    console.error(`ERRO script-${count}.js`);
    console.error(err.message);
  }
}

if (count === 0) {
  console.log('Nenhum script inline encontrado em index.html.');
  process.exit(0);
}

if (failed) {
  console.error(`Falha: ${count} script(s) inline analisado(s), com erro.`);
  process.exit(1);
}

console.log(`Sucesso: ${count} script(s) inline validado(s).`);
