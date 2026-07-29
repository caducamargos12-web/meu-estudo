#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const l = linha.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const idx = l.indexOf('=');
    const chave = l.slice(0, idx).trim();
    let valor = l.slice(idx + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (chave && !process.env[chave]) process.env[chave] = valor;
  }
}

carregarEnvLocal();

const BASE_URL = (process.argv[2] || process.env.APP_URL || process.env.DIAG_URL || process.env.BASE_URL || '').replace(/\/$/, '');
const ADMIN_SENHA = process.env.ADMIN_SENHA || '';

if (!BASE_URL) {
  console.error('Informe a URL do app: node scripts/test-diag.js https://meu-estudo-production.up.railway.app');
  console.error('Ou defina APP_URL, DIAG_URL ou BASE_URL no ambiente/.env local.');
  process.exit(1);
}

if (!ADMIN_SENHA) {
  console.error('ADMIN_SENHA não encontrada no ambiente nem no .env local.');
  process.exit(1);
}

const TURMAS = {
  '3-ano':   { nome: '3º ano',   ativa: true, grade: require('../grades/3-ano') },
  '2-medio': { nome: '2º médio', ativa: true, grade: require('../grades/2-medio') },
  '1-medio': { nome: '1º médio', ativa: true, grade: require('../grades/1-medio') },
  '9-fund':  { nome: '9º ano',   ativa: true, grade: require('../grades/9-fund') },
  '8-fund':  { nome: '8º ano',   ativa: true, grade: require('../grades/8-fund') },
  '7-fund':  { nome: '7º ano',   ativa: true, grade: require('../grades/7-fund') },
  '6-fund':  { nome: '6º ano',   ativa: true, grade: require('../grades/6-fund') },
};

function expandirMateria(item) {
  if (Array.isArray(item.combinar)) return item.combinar.map(sub => ({ materia: sub.m, professor: sub.p || item.p || '?' }));
  return [{ materia: item.m, professor: item.p || '?' }];
}

function pareceVazio(texto) {
  const t = (texto || '').trim();
  if (!t) return true;
  return /\(blog nao retornou texto - todas as estrategias de busca falharam\)/i.test(t)
    || /ERRO ao buscar o blog:/i.test(t)
    || /Nada encontrado para dia=/i.test(t)
    || /senha invalida/i.test(t)
    || /Muitas tentativas/i.test(t);
}

async function testarMateria({ turmaId, turmaNome, dia, materia }) {
  const url = new URL('/diag', BASE_URL);
  url.searchParams.set('senha', ADMIN_SENHA);
  url.searchParams.set('turma', turmaId);
  url.searchParams.set('dia', dia);
  url.searchParams.set('materia', materia);

  try {
    const resp = await fetch(url);
    const texto = await resp.text();
    const vazio = !resp.ok || pareceVazio(texto);
    return {
      turmaId,
      turmaNome,
      dia,
      materia,
      status: vazio ? 'VAZIO' : 'OK',
      http: resp.status,
      tamanho: texto.trim().length,
    };
  } catch (err) {
    return {
      turmaId,
      turmaNome,
      dia,
      materia,
      status: 'VAZIO',
      http: 'ERRO',
      tamanho: 0,
      erro: err && err.message ? err.message : String(err),
    };
  }
}

async function main() {
  const problemas = [];
  const dias = ['seg', 'ter', 'qua', 'qui', 'sex'];

  console.log('Testando /diag em:', BASE_URL);
  console.log('Senha: [oculta]');
  console.log('');

  for (const [turmaId, turma] of Object.entries(TURMAS).filter(([, t]) => t.ativa)) {
    console.log(`## ${turma.nome} (${turmaId})`);
    for (const dia of dias) {
      const itens = turma.grade[dia] || [];
      for (const item of itens) {
        for (const alvo of expandirMateria(item)) {
          const r = await testarMateria({ turmaId, turmaNome: turma.nome, dia, materia: alvo.materia });
          const linha = `${r.status.padEnd(5)} | ${turmaId.padEnd(8)} | ${dia} | ${alvo.materia} (${alvo.professor}) | HTTP ${r.http} | ${r.tamanho} chars`;
          console.log(linha);
          if (r.status !== 'OK') problemas.push(r);
        }
      }
    }
    console.log('');
  }

  if (problemas.length) {
    console.log('Matérias com problema:');
    for (const p of problemas) {
      console.log(`- ${p.turmaId} | ${p.dia} | ${p.materia} | HTTP ${p.http} | ${p.erro || (p.tamanho + ' chars')}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Todas as matérias retornaram texto no /diag.');
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
