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
  console.error('Informe a URL do app: node scripts/test-resultado.js https://meu-estudo-production.up.railway.app');
  console.error('Ou defina APP_URL, DIAG_URL ou BASE_URL no ambiente/.env local.');
  process.exit(1);
}

if (!ADMIN_SENHA) {
  console.error('ADMIN_SENHA não encontrada no ambiente nem no .env local.');
  process.exit(1);
}

// Carrega as 7 turmas ativas (lendo as grades)
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

async function testarMateria({ turmaId, turmaNome, dia, materia }) {
  const url = new URL('/diag-resultado', BASE_URL);
  url.searchParams.set('senha', ADMIN_SENHA);
  url.searchParams.set('turma', turmaId);
  url.searchParams.set('dia', dia);
  url.searchParams.set('materia', materia);

  try {
    const resp = await fetch(url);
    const json = await resp.json();

    if (!resp.ok) {
      return {
        turmaId,
        turmaNome,
        dia,
        materia,
        status: 'ERRO',
        http: resp.status,
        erro: json.error || 'HTTP ' + resp.status,
      };
    }

    // classifica o resultado
    let status = 'OK';
    if (json.status === 'vazio') status = 'VAZIO';
    else if (json.status === 'erro') status = 'ERRO';
    else if (json.status === 'sem_aula') status = 'SEM_AULA';
    else if (json.status === 'ok' && (!json.resultado.aula || !json.resultado.aula.trim())) status = 'SEM_AULA';

    const temDever = json.resultado.deveres && json.resultado.deveres.length > 0;
    const temTeste = json.resultado.teste !== null && json.resultado.teste !== undefined;

    return {
      turmaId,
      turmaNome,
      dia,
      materia,
      professor: json.professor || '?',
      status,
      http: resp.status,
      aulaTamanho: json.resultado.aula ? json.resultado.aula.length : 0,
      temDever,
      temTeste,
      tempo_ms: json.tempo_ms || 0,
      erro: json.erro || null,
    };
  } catch (err) {
    return {
      turmaId,
      turmaNome,
      dia,
      materia,
      status: 'ERRO',
      http: 'FALHA_REDE',
      erro: err && err.message ? err.message : String(err),
    };
  }
}

function formatarStatus(s) {
  const cores = {
    'OK': '[32m', // verde
    'VAZIO': '[33m', // amarelo
    'ERRO': '[31m', // vermelho
    'SEM_AULA': '[35m', // magenta
  };
  const reset = '[0m';
  const cor = cores[s] || '';
  return cor + s.padEnd(10) + reset;
}

async function main() {
  const problemas = [];
  const dias = ['seg', 'ter', 'qua', 'qui', 'sex'];
  const DELAY = 2000; // 2 segundos entre chamadas

  console.log('Testando /diag-resultado em:', BASE_URL);
  console.log('Turmas: ' + Object.keys(TURMAS).filter(k => TURMAS[k].ativa).length);
  console.log('');

  for (const [turmaId, turma] of Object.entries(TURMAS).filter(([, t]) => t.ativa)) {
    console.log(`\n## ${turma.nome} (${turmaId})`);
    const materiasNaTurma = [];

    for (const dia of dias) {
      const itens = turma.grade[dia] || [];
      for (const item of itens) {
        for (const alvo of expandirMateria(item)) {
          materiasNaTurma.push({ dia, materia: alvo.materia, professor: alvo.professor });
        }
      }
    }

    for (const { dia, materia, professor } of materiasNaTurma) {
      const r = await testarMateria({ turmaId, turmaNome: turma.nome, dia, materia });
      const statusFmt = formatarStatus(r.status);
      const aulaTxt = r.aulaTamanho ? r.aulaTamanho + ' chars' : 'vazia';
      const deverTxt = r.temDever ? 'sim' : 'não';
      const testeTxt = r.temTeste ? 'sim' : 'não';
      const linha = `${statusFmt} | ${dia.padEnd(3)} | ${materia.padEnd(20)} (${(professor || '?').slice(0, 12).padEnd(12)}) | aula: ${aulaTxt.padEnd(11)} | dever: ${deverTxt} | teste: ${testeTxt}`;
      console.log(linha);

      if (r.status !== 'OK') {
        problemas.push({
          turmaId,
          dia,
          materia,
          status: r.status,
          erro: r.erro,
          http: r.http,
        });
      }

      // delay para não sobrecarregar
      if (materiasNaTurma.length > 1) await new Promise(resolve => setTimeout(resolve, DELAY));
    }
  }

  // resumo de problemas
  if (problemas.length) {
    console.log('\n\n## Problemas encontrados:\n');
    for (const p of problemas) {
      console.log(`- ${p.turmaId} | ${p.dia} | ${p.materia.padEnd(20)} | ${p.status}: ${p.erro || 'HTTP ' + p.http}`);
    }
    console.log('\n');
    process.exitCode = 1;
  } else {
    console.log('\n✓ Todas as matérias retornaram status OK.\n');
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
