const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

app.use(express.json());

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE ALUNOS (logins)
// Edite a variável de ambiente ALUNOS no Railway no formato:
//   usuario1:senha1,usuario2:senha2,usuario3:senha3
// Exemplo: joao:1234,maria:abcd,pedro:xyz9
// ════════════════════════════════════════════════════════════════════════════
function carregarAlunos() {
  const raw = process.env.ALUNOS || '';
  const map = {};
  raw.split(',').forEach(par => {
    const [user, pass] = par.split(':');
    if (user && pass) map[user.trim()] = pass.trim();
  });
  return map;
}
const ALUNOS = carregarAlunos();

// segredo para assinar tokens de sessão
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-isto-no-railway';

// ── sessões ativas: { token: { user, device, criadoEm } } ───────────────────
// guarda qual dispositivo (fingerprint) está logado em cada conta
const sessoesAtivas = {};      // token -> dados
const dispositivoPorUser = {}; // user -> deviceId (1 login = 1 dispositivo)

function gerarToken(user, device) {
  const payload = `${user}|${device}|${Date.now()}`;
  const assinatura = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + assinatura;
}

function validarToken(token) {
  try {
    const [b64, assinatura] = token.split('.');
    const payload = Buffer.from(b64, 'base64').toString();
    const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (assinatura !== esperado) return null;
    const [user, device] = payload.split('|');
    return { user, device };
  } catch { return null; }
}

// ── middleware de autenticação ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const dados = validarToken(token);
  if (!dados) return res.status(401).json({ error: 'Sessão inválida' });
  // verifica se o dispositivo bate com o registrado para esse usuário
  if (dispositivoPorUser[dados.user] && dispositivoPorUser[dados.user] !== dados.device) {
    return res.status(403).json({ error: 'Conta em uso em outro dispositivo' });
  }
  req.user = dados.user;
  next();
}

// ── rota de diagnóstico (temporária) ────────────────────────────────────────
app.get('/api/diag', (req, res) => {
  res.json({
    alunos_carregados: Object.keys(ALUNOS).length,
    usuarios: Object.keys(ALUNOS),
    tem_session_secret: !!process.env.SESSION_SECRET,
    tem_api_key: !!process.env.ANTHROPIC_API_KEY
  });
});

// ── rota de login ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { user, pass, device } = req.body;
  if (!user || !pass || !device) return res.json({ error: 'Dados incompletos' });
  if (ALUNOS[user] !== pass) return res.json({ error: 'Usuário ou senha incorretos' });

  // 1 login = 1 dispositivo. Se já tem dispositivo registrado e é outro, bloqueia
  if (dispositivoPorUser[user] && dispositivoPorUser[user] !== device) {
    return res.json({ error: 'Esta conta já está vinculada a outro dispositivo. Contate o administrador para liberar.' });
  }
  // registra o dispositivo na primeira vez
  dispositivoPorUser[user] = device;
  const token = gerarToken(user, device);
  sessoesAtivas[token] = { user, device, criadoEm: Date.now() };
  res.json({ token, user });
});

// ════════════════════════════════════════════════════════════════════════════
// GRADE
// ════════════════════════════════════════════════════════════════════════════
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
const MODELS = ['claude-haiku-4-5-20251001','claude-sonnet-4-6','claude-sonnet-4-5-20250929','claude-opus-4-8'];

// ════════════════════════════════════════════════════════════════════════════
// CACHE DE 24H — processa cada matéria 1x por dia, salva em disco
// ════════════════════════════════════════════════════════════════════════════
const CACHE_FILE = '/tmp/cache_estudo.json';
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
function salvarCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
}
function chaveCacheHoje(dayKey) {
  const d = new Date();
  const dia = d.toISOString().slice(0,10); // AAAA-MM-DD
  return `${dia}_${dayKey}`;
}

// ── busca blog ──────────────────────────────────────────────────────────────
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
    instrucaoFiltro = '\n\nIMPORTANTE: Este blog mistura DUAS disciplinas. Considere SOMENTE as aulas de "' + filtro + '". Ignore a outra disciplina.';
  }
  const prompt = 'Você é um tutor do ensino médio brasileiro. Hoje é ' + hoje + ' (DD/MM/AAAA). Analise o registro de aulas do professor ' + professor + ' de ' + materia + '.' +
    instrucaoFiltro +
    '\n\nIdentifique DUAS aulas:\n' +
    '• ULTIMA AULA = aula de data MAIS RECENTE que seja IGUAL OU ANTERIOR a hoje (' + hoje + '). Cai no teste.\n' +
    '• PROXIMA AULA = primeira aula com data POSTERIOR a hoje, SE registrada. Se não houver, deixe vazio.\n' +
    '\nREGRAS:\n1. Datas DD/MM ou DD/MM/AAAA. Ano atual 2026 se faltar.\n2. NUNCA use aula futura como última aula.\n' +
    (filtro ? '3. Ambas de "' + filtro + '".\n' : '') +
    '\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo. Use conhecimento geral de ' + materia + '.') +
    '\n\nResponda APENAS JSON sem markdown:\n' +
    '{"ultima_aula":"data e conteúdo","ultima_deveres":["dever"],"resumo":"resumo didático 3-4 parágrafos da última aula","questoes":[{"enunciado":"","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":""}],"proxima_aula":"data e conteúdo ou vazio","proxima_resumo":"1-2 frases ou vazio","proxima_deveres":[]}';
  return callAnthropic(prompt, 0);
}

// ── rota protegida ────────────────────────────────────────────────────────────
app.get('/api/today', auth, async function(req, res) {
  // SEMPRE usa o dia real de hoje (trava no dia da semana)
  const dayMap = { 1:'seg', 2:'ter', 3:'qua', 4:'qui', 5:'sex' };
  const hojeDay = new Date().getDay();
  const dayKey = dayMap[hojeDay];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // fim de semana: sem aulas
  if (!dayKey) {
    res.write('data: ' + JSON.stringify({ type:'start', day:'fds', dayLabel:'Fim de semana', total:0 }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type:'weekend' }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type:'done' }) + '\n\n');
    return res.end();
  }

  const materias = GRADE[dayKey];
  const chaveHoje = chaveCacheHoje(dayKey);

  res.write('data: ' + JSON.stringify({ type:'start', day:dayKey, dayLabel:DIAS_PT[dayKey], total:materias.length }) + '\n\n');

  // SE JÁ TEM CACHE DE HOJE: entrega instantâneo, sem gastar API
  if (cache[chaveHoje]) {
    cache[chaveHoje].forEach((item, i) => {
      res.write('data: ' + JSON.stringify({ type:'result', index:i, item, cached:true }) + '\n\n');
    });
    res.write('data: ' + JSON.stringify({ type:'done', fromCache:true }) + '\n\n');
    return res.end();
  }

  // SE NÃO TEM CACHE: processa e salva
  const resultados = [];
  for (let i = 0; i < materias.length; i++) {
    const item = materias[i];
    res.write('data: ' + JSON.stringify({ type:'loading', index:i, materia:item.m }) + '\n\n');
    const blogText = await fetchBlog(item.url);
    try {
      const ai = await processWithAI(item.m, item.p, blogText, item.filtro);
      const result = Object.assign({}, item, ai, { ok: true });
      resultados.push(result);
      res.write('data: ' + JSON.stringify({ type:'result', index:i, item:result }) + '\n\n');
    } catch(e) {
      const result = Object.assign({}, item, { ok:false, ultima_aula:'—', ultima_deveres:[], resumo:'Erro: '+e.message, questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
      resultados.push(result);
      res.write('data: ' + JSON.stringify({ type:'result', index:i, item:result }) + '\n\n');
    }
  }

  // salva no cache do dia
  cache[chaveHoje] = resultados;
  // limpa caches de dias antigos
  Object.keys(cache).forEach(k => {
    if (k !== chaveHoje && !k.startsWith(new Date().toISOString().slice(0,10))) delete cache[k];
  });
  salvarCache();

  res.write('data: ' + JSON.stringify({ type:'done' }) + '\n\n');
  res.end();
});

// ── serve arquivos estáticos só depois das rotas de API ──────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
