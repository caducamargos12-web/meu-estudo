const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── grade ──────────────────────────────────────────────────────────────────
const GRADE = {
  seg: [
    { m:'Filosofia',      p:'Sandra Maisa',    url:'https://profsandracnsanglo.blogspot.com/p/3-ano-filosofia.html' },
    { m:'Geografia',      p:'Gabriel Fonseca', url:'https://profgabrielcnsanglo.blogspot.com/p/3-ano-geografia.html' },
    { m:'Prog. Lidere',   p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-lidere.html' },
  ],
  ter: [
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'História' },
    { m:'Química A',      p:'Washington Gois', url:'https://profwashingtonanglo.blogspot.com/p/3-ano.html' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html' },
  ],
  qua: [
    { m:'Linguística',    p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-gramatica.html' },
    { m:'Matemática A',   p:'Tiago Santos',    url:'https://professoratiagocnsanglo.blogspot.com/p/3-ano-em-matematica-a_27.html' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html' },
    { m:'Inglês',         p:'Jully Alvim',     url:'https://profjullycnsanglo.blogspot.com/p/3ano-em.html' },
  ],
  qui: [
    { m:'Biologia',       p:'Angelita Pimenta',url:'https://profangelitacnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html' },
    { m:'Química B',      p:'Maurélio',        url:'https://maureliopereiral.blogspot.com/p/3-ano.html' },
    { m:'Redação',        p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação' },
  ],
  sex: [
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Literatura',     p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Literatura' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html' },
  ],
};

const DIAS_PT = { seg:'Segunda', ter:'Terça', qua:'Quarta', qui:'Quinta', sex:'Sexta' };

const MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-8',
];

async function fetchBlog(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudyBot/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s{3,}/g, '\n').trim();
    return texto.length > 6000 ? texto.slice(texto.length - 6000) : texto;
  } catch { return null; }
}

function hojeStr() {
  const d = new Date();
  return ('0'+d.getDate()).slice(-2) + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + d.getFullYear();
}

async function callAnthropic(prompt, modelIndex) {
  modelIndex = modelIndex || 0;
  if (modelIndex >= MODELS.length) throw new Error('Nenhum modelo disponível');
  const model = MODELS[modelIndex];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await res.json();
  if (data.type === 'error' && data.error && data.error.type === 'not_found_error') {
    return callAnthropic(prompt, modelIndex + 1);
  }
  const raw = data.content.map(function(i){ return i.text || ''; }).join('').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

async function processWithAI(materia, professor, blogText, filtro) {
  const temConteudo = blogText && blogText.length > 50;
  const hoje = hojeStr();

  let instrucaoFiltro = '';
  if (filtro) {
    instrucaoFiltro = '\n\nIMPORTANTE: Este blog mistura DUAS disciplinas. Considere SOMENTE as aulas de "' + filtro + '". Ignore a outra disciplina completamente.';
  }

  const prompt = 'Você é um tutor do ensino médio brasileiro. Hoje é ' + hoje + ' (formato DD/MM/AAAA). Analise o registro de aulas do professor ' + professor + ' de ' + materia + '.' +
    instrucaoFiltro +
    '\n\nIdentifique DUAS aulas:\n' +
    '• ULTIMA AULA = a aula de data MAIS RECENTE que seja IGUAL OU ANTERIOR a hoje (' + hoje + '). É a matéria que cai no teste.\n' +
    '• PROXIMA AULA = a primeira aula com data POSTERIOR a hoje, SE já estiver registrada no blog. Se não houver aula futura registrada, deixe os campos da próxima aula vazios.\n' +
    '\nREGRAS:\n' +
    '1. Datas podem ser DD/MM ou DD/MM/AAAA. Assuma o ano atual (2026) se faltar ano.\n' +
    '2. NUNCA use uma aula futura como "última aula".\n' +
    (filtro ? '3. Ambas as aulas devem ser de "' + filtro + '".\n' : '') +
    '\n' + (temConteudo ? 'REGISTRO DE AULAS:\n' + blogText : 'Sem conteúdo disponível. Use conhecimento geral de ' + materia + ' para o 3º ano EM.') +
    '\n\nResponda APENAS JSON válido sem markdown:\n' +
    '{' +
    '"ultima_aula":"data e conteúdo da última aula",' +
    '"ultima_deveres":["dever da última aula"],' +
    '"resumo":"resumo didático em 3-4 parágrafos da ÚLTIMA aula, para estudar para o teste",' +
    '"questoes":[{"enunciado":"texto","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":"texto"}],' +
    '"proxima_aula":"data e conteúdo da próxima aula, ou string vazia se não houver",' +
    '"proxima_resumo":"breve resumo de 1-2 frases da próxima aula, ou vazio",' +
    '"proxima_deveres":["dever da próxima aula, se houver"]' +
    '}';

  return callAnthropic(prompt, 0);
}

app.get('/api/today', async function(req, res) {
  const dayMap = { 1:'seg', 2:'ter', 3:'qua', 4:'qui', 5:'sex' };
  const dayKey = req.query.day || dayMap[new Date().getDay()] || 'seg';
  const materias = GRADE[dayKey];
  if (!materias) return res.json({ error: 'Dia inválido' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('data: ' + JSON.stringify({ type:'start', day:dayKey, dayLabel:DIAS_PT[dayKey], total:materias.length }) + '\n\n');

  for (let i = 0; i < materias.length; i++) {
    const item = materias[i];
    res.write('data: ' + JSON.stringify({ type:'loading', index:i, materia:item.m }) + '\n\n');
    const blogText = await fetchBlog(item.url);
    try {
      const ai = await processWithAI(item.m, item.p, blogText, item.filtro);
      const result = Object.assign({}, item, ai, { ok: true });
      res.write('data: ' + JSON.stringify({ type:'result', index:i, item:result }) + '\n\n');
    } catch(e) {
      res.write('data: ' + JSON.stringify({ type:'result', index:i, item: Object.assign({}, item, { ok:false, ultima_aula:'—', ultima_deveres:[], resumo:'Erro: ' + e.message, questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] }) }) + '\n\n');
    }
  }

  res.write('data: ' + JSON.stringify({ type:'done' }) + '\n\n');
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
