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

// ── checagem de segurança no arranque ───────────────────────────────────────
// o app se recusa a subir sem os segredos essenciais definidos
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error('ERRO FATAL: variável SESSION_SECRET ausente ou muito curta (mínimo 16 caracteres). Defina-a no Railway.');
  process.exit(1);
}
if (!process.env.ADMIN_SENHA || process.env.ADMIN_SENHA.length < 6) {
  console.error('ERRO FATAL: variável ADMIN_SENHA ausente ou muito curta (mínimo 6 caracteres). Defina-a no Railway.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERRO FATAL: variável ANTHROPIC_API_KEY ausente. Defina-a no Railway.');
  process.exit(1);
}

// ── vínculos de dispositivo por usuário (até 2 por conta) ───────────────────
// cada item: { id, aparelho, data }
const dispositivosPorUser = {}; // user -> [{id, aparelho, data}, ...]
const MAX_DISPOSITIVOS = 2;

// ── persistência dos vínculos de dispositivo em disco ───────────────────────
// usa o volume persistente do Railway em /data; se não existir, cai em /tmp
const DATA_DIR = fs.existsSync('/data') ? '/data' : '/tmp';
const DISPOSITIVOS_FILE = DATA_DIR + '/dispositivos.json';

function carregarDispositivos() {
  try {
    const dados = JSON.parse(fs.readFileSync(DISPOSITIVOS_FILE, 'utf8'));
    Object.assign(dispositivosPorUser, dados);
    console.log('Vínculos de dispositivo carregados do disco.');
  } catch { /* primeiro uso, arquivo ainda não existe */ }
}

function salvarDispositivos() {
  try { fs.writeFileSync(DISPOSITIVOS_FILE, JSON.stringify(dispositivosPorUser)); }
  catch (e) { console.log('Erro ao salvar dispositivos:', e.message); }
}

carregarDispositivos();

// ── pagamentos / assinaturas (salvos no volume persistente) ─────────────────
// pagamentos[user] = { cadastro, vencimento, ultimoPagamento, valorPago, historico:[{data,valor}] }
const pagamentos = {};
const PAGAMENTOS_FILE = DATA_DIR + '/pagamentos.json';

function carregarPagamentos() {
  try {
    const dados = JSON.parse(fs.readFileSync(PAGAMENTOS_FILE, 'utf8'));
    Object.assign(pagamentos, dados);
    console.log('Pagamentos carregados do disco.');
  } catch { /* primeiro uso */ }
}
function salvarPagamentos() {
  try { fs.writeFileSync(PAGAMENTOS_FILE, JSON.stringify(pagamentos)); }
  catch (e) { console.log('Erro ao salvar pagamentos:', e.message); }
}
carregarPagamentos();

// registra o cadastro de um aluno na primeira vez que ele loga
function registrarCadastro(user) {
  if (!pagamentos[user]) {
    pagamentos[user] = {
      cadastro: new Date().toISOString(),
      vencimento: null,
      ultimoPagamento: null,
      valorPago: 0,
      historico: []
    };
    salvarPagamentos();
  }
}

// detecta o tipo de aparelho a partir do User-Agent
function detectarAparelho(ua) {
  ua = ua || '';
  let so = 'Desconhecido';
  if (/iPhone/i.test(ua)) so = 'iPhone';
  else if (/iPad/i.test(ua)) so = 'iPad';
  else if (/Android/i.test(ua)) so = 'Android';
  else if (/Windows/i.test(ua)) so = 'Windows (PC)';
  else if (/Macintosh|Mac OS/i.test(ua)) so = 'Mac';
  else if (/Linux/i.test(ua)) so = 'Linux';
  let navegador = '';
  if (/Edg/i.test(ua)) navegador = 'Edge';
  else if (/Chrome/i.test(ua)) navegador = 'Chrome';
  else if (/Safari/i.test(ua)) navegador = 'Safari';
  else if (/Firefox/i.test(ua)) navegador = 'Firefox';
  return navegador ? `${navegador} · ${so}` : so;
}

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
  // verifica se o dispositivo está entre os registrados para esse usuário
  const lista = dispositivosPorUser[dados.user];
  if (lista && lista.length && !lista.some(d => d.id === dados.device)) {
    return res.status(403).json({ error: 'Limite de dispositivos atingido' });
  }
  req.user = dados.user;
  next();
}

// ── PAINEL ADMIN ─────────────────────────────────────────────────────────────
// senha do admin vem da variável ADMIN_SENHA no Railway
// comparação com tempo constante para evitar ataques de timing
function senhaIgual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function checkAdmin(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.adminSenha || (req.body && req.body.adminSenha);
  if (!senha || !senhaIgual(senha, process.env.ADMIN_SENHA)) {
    return res.status(401).json({ error: 'Senha de admin incorreta' });
  }
  next();
}

// lista alunos e os dispositivos vinculados (com detalhes)
app.get('/api/admin/alunos', checkAdmin, (req, res) => {
  const agora = new Date();
  const lista = Object.keys(ALUNOS).map(user => {
    const devs = dispositivosPorUser[user] || [];
    const pag = pagamentos[user] || null;

    // calcula status e dias restantes
    let statusPag = 'novo';          // novo, pago, vencido
    let diasRestantes = null;
    let diasDeUso = null;
    if (pag) {
      if (pag.cadastro) {
        diasDeUso = Math.floor((agora - new Date(pag.cadastro)) / 86400000);
      }
      if (pag.vencimento) {
        const venc = new Date(pag.vencimento);
        diasRestantes = Math.ceil((venc - agora) / 86400000);
        statusPag = diasRestantes >= 0 ? 'pago' : 'vencido';
      } else {
        statusPag = 'pendente'; // cadastrou mas nunca pagou
      }
    }

    return {
      user,
      vinculado: devs.length > 0,
      qtd_dispositivos: devs.length,
      max_dispositivos: MAX_DISPOSITIVOS,
      dispositivos: devs.map(d => ({ id: d.id, aparelho: d.aparelho || 'Desconhecido', data: d.data || '—' })),
      // dados de pagamento
      cadastro: pag ? pag.cadastro : null,
      vencimento: pag ? pag.vencimento : null,
      ultimoPagamento: pag ? pag.ultimoPagamento : null,
      valorTotal: pag ? pag.valorPago : 0,
      historico: pag ? pag.historico : [],
      statusPag,
      diasRestantes,
      diasDeUso
    };
  });
  res.json({ alunos: lista, total: lista.length });
});

// marca um pagamento: soma 30 dias ao vencimento e registra o valor
app.post('/api/admin/marcar-pagamento', checkAdmin, (req, res) => {
  const { user, valor } = req.body;
  if (!ALUNOS[user]) return res.json({ error: 'Aluno não encontrado' });
  if (!pagamentos[user]) registrarCadastro(user);
  const p = pagamentos[user];
  const agora = new Date();
  // se ainda tem vencimento futuro, soma 30 dias a partir dele; senão, a partir de hoje
  const base = (p.vencimento && new Date(p.vencimento) > agora) ? new Date(p.vencimento) : agora;
  base.setDate(base.getDate() + 30);
  p.vencimento = base.toISOString();
  p.ultimoPagamento = agora.toISOString();
  const v = parseFloat(valor) || 16;
  p.valorPago = (p.valorPago || 0) + v;
  p.historico = p.historico || [];
  p.historico.push({ data: agora.toISOString(), valor: v });
  salvarPagamentos();
  res.json({ ok: true, msg: 'Pagamento registrado. Vence em ' + base.toLocaleDateString('pt-BR') });
});

// desfaz o último pagamento (caso tenha clicado errado)
app.post('/api/admin/desfazer-pagamento', checkAdmin, (req, res) => {
  const { user } = req.body;
  const p = pagamentos[user];
  if (!p || !p.historico || !p.historico.length) return res.json({ error: 'Sem pagamento para desfazer' });
  const ultimo = p.historico.pop();
  p.valorPago = Math.max(0, (p.valorPago || 0) - ultimo.valor);
  // recalcula vencimento removendo 30 dias
  if (p.vencimento) {
    const v = new Date(p.vencimento);
    v.setDate(v.getDate() - 30);
    p.vencimento = p.historico.length ? v.toISOString() : null;
  }
  p.ultimoPagamento = p.historico.length ? p.historico[p.historico.length-1].data : null;
  salvarPagamentos();
  res.json({ ok: true, msg: 'Último pagamento desfeito.' });
});

// remove UM dispositivo específico de um aluno
app.post('/api/admin/remover-dispositivo', checkAdmin, (req, res) => {
  const { user, deviceId } = req.body;
  if (!ALUNOS[user]) return res.json({ error: 'Aluno não encontrado' });
  const lista = dispositivosPorUser[user] || [];
  const idx = lista.findIndex(d => d.id === deviceId);
  if (idx === -1) return res.json({ error: 'Dispositivo não encontrado' });
  lista.splice(idx, 1);
  if (lista.length === 0) delete dispositivosPorUser[user];
  salvarDispositivos();
  res.json({ ok: true, msg: 'Acesso removido. A vaga foi liberada para um novo aparelho.' });
});

// desbloqueia TODOS os dispositivos de um aluno
app.post('/api/admin/desbloquear', checkAdmin, (req, res) => {
  const { user } = req.body;
  if (!ALUNOS[user]) return res.json({ error: 'Aluno não encontrado' });
  delete dispositivosPorUser[user];
  salvarDispositivos();
  res.json({ ok: true, msg: 'Todos os dispositivos de ' + user + ' foram liberados.' });
});

// ── rate limiting do login (anti força-bruta) ───────────────────────────────
// guarda tentativas recentes por IP; máx 5 falhas por minuto
const tentativasLogin = {}; // ip -> { count, reset }
function checarRateLimit(ip) {
  const agora = Date.now();
  const reg = tentativasLogin[ip];
  if (!reg || agora > reg.reset) {
    tentativasLogin[ip] = { count: 0, reset: agora + 60000 };
    return true;
  }
  return reg.count < 5;
}
function registrarFalha(ip) {
  const reg = tentativasLogin[ip];
  if (reg) reg.count++;
}
// limpeza periódica para não acumular IPs antigos na memória
setInterval(() => {
  const agora = Date.now();
  Object.keys(tentativasLogin).forEach(ip => {
    if (agora > tentativasLogin[ip].reset) delete tentativasLogin[ip];
  });
}, 300000);

// ── rota de login ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido';
  if (!checarRateLimit(ip)) {
    return res.json({ error: 'Muitas tentativas. Aguarde 1 minuto e tente de novo.' });
  }
  const { user, pass, device } = req.body;
  if (!user || !pass || !device) return res.json({ error: 'Dados incompletos' });
  if (ALUNOS[user] !== pass) {
    registrarFalha(ip);
    return res.json({ error: 'Usuário ou senha incorretos' });
  }

  // registra a data de primeiro cadastro (se for a primeira vez)
  registrarCadastro(user);

  // inicializa a lista de dispositivos do usuário
  if (!dispositivosPorUser[user]) dispositivosPorUser[user] = [];
  const lista = dispositivosPorUser[user];

  // verifica se o dispositivo já está registrado
  const jaExiste = lista.some(d => d.id === device);
  if (!jaExiste) {
    // dispositivo novo: só registra se ainda houver vaga (até 2)
    if (lista.length >= MAX_DISPOSITIVOS) {
      return res.json({ error: 'Esta conta já está vinculada a ' + MAX_DISPOSITIVOS + ' dispositivos. Contate o administrador para liberar.' });
    }
    const aparelho = detectarAparelho(req.headers['user-agent']);
    const data = new Date().toLocaleDateString('pt-BR');
    lista.push({ id: device, aparelho, data });
    salvarDispositivos();
  }

  const token = gerarToken(user, device);
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
const CACHE_FILE = DATA_DIR + '/cache_estudo.json';
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
    '\n\nIdentifique:\n' +
    '• AULA DE HOJE = a aula de data MAIS RECENTE que seja IGUAL OU ANTERIOR a hoje (' + hoje + '). É a matéria vista na aula mais recente.\n' +
    '• MATÉRIA DO TESTE = a matéria que cai no teste de hoje. REGRA: é a aula IMEDIATAMENTE ANTERIOR à aula de hoje (uma aula atrás). Se o blog tiver uma anotação explícita do tipo "matéria para o teste do dia XX/XX" ou "teste", USE essa informação com prioridade. Senão, use a aula imediatamente anterior à de hoje.\n' +
    '  ATENÇÃO AOS FERIADOS: "uma aula atrás" significa a aula real anterior que ACONTECEU. Se entre a aula de hoje e a anterior houve uma data sem aula (feriado), pule para a aula que de fato ocorreu antes.\n' +
    '• DEVERES PENDENTES = deveres/tarefas das ATÉ 3 AULAS ANTERIORES à aula de hoje (não inclua o dever da aula de hoje). Para cada, informe a data de origem.\n' +
    '• PROXIMA AULA = primeira aula com data POSTERIOR a hoje, SE registrada. Senão vazio.\n' +
    '\nEXEMPLO REAL: hoje 11/06. Aula de hoje = 11/06. Matéria do teste = aula de uma atrás, que seria 09/06 (a aula real anterior). O resumo e o simulado são sobre a MATÉRIA DO TESTE (09/06), não sobre a de hoje.\n' +
    '\nIMPORTANTE: o RESUMO e as QUESTÕES do simulado devem ser sobre a MATÉRIA DO TESTE (a aula de uma atrás), porque é isso que o aluno precisa estudar hoje.\n' +
    '\nREGRAS:\n1. Datas DD/MM ou DD/MM/AAAA. Ano atual 2026 se faltar.\n2. NUNCA use aula futura como aula de hoje.\n3. Aula anterior sem tarefa: pule.\n' +
    (filtro ? '4. Tudo apenas de "' + filtro + '".\n' : '') +
    '\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo. Use conhecimento geral de ' + materia + '.') +
    '\n\nResponda APENAS JSON sem markdown:\n' +
    '{"aula_hoje":"data e conteúdo da aula de hoje","materia_teste_data":"DD/MM da matéria do teste","materia_teste":"conteúdo da matéria que cai no teste","deveres_pendentes":[{"data":"03/06","deveres":["dever 1"]}],"resumo":"resumo didático 3-4 parágrafos da MATÉRIA DO TESTE (aula de uma atrás)","questoes":[{"enunciado":"","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":""}],"proxima_aula":"data e conteúdo ou vazio","proxima_resumo":"1-2 frases ou vazio","proxima_deveres":[]}';
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
      const result = Object.assign({}, item, { ok:false, aula_hoje:'—', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], resumo:'Erro: '+e.message, questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
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

// ── página do painel admin ───────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── serve arquivos estáticos só depois das rotas de API ──────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
