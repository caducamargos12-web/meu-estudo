#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , materia, fixturePath] = process.argv;

if (!materia || !fixturePath) {
  console.error('Uso: node scripts/test-parser.js <materia> <fixture.txt>');
  console.error('Exemplo: node scripts/test-parser.js mat-a test-fixtures/mat-a/exemplo.txt');
  process.exit(1);
}

const fullPath = path.resolve(process.cwd(), fixturePath);

if (!fs.existsSync(fullPath)) {
  console.error(`Fixture não encontrada: ${fixturePath}`);
  process.exit(1);
}

const texto = fs.readFileSync(fullPath, 'utf8');

console.log('Teste de parser - Meu Estudo');
console.log(`Matéria: ${materia}`);
console.log(`Fixture: ${fixturePath}`);
console.log(`Tamanho: ${texto.length} caracteres`);
console.log('');
console.log('Este script é um harness inicial.');
console.log('Ao extrair parsers puros do server.js, conecte a função da matéria aqui para teste determinístico.');
console.log('');
console.log('Checklist manual:');
console.log('- O texto contém a data esperada?');
console.log('- O texto contém aula/conteúdo?');
console.log('- O texto contém dever/TM/TC/Plurall?');
console.log('- Há rodapé do Blogspot sobrando?');
console.log('- O formato é compatível com parser existente?');

const markers = ['Postagens (Atom)', 'Arquivo do blog', 'Pesquisar este blog', 'Quem sou eu', 'Denunciar abuso'];
const found = markers.filter((m) => texto.includes(m));

if (found.length) {
  console.warn('Atenção: marcadores de rodapé encontrados:', found.join(', '));
  process.exitCode = 2;
} else {
  console.log('OK: nenhum marcador clássico de rodapé encontrado.');
}
