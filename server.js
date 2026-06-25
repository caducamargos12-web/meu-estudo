const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '256kb' })); // limita tamanho do corpo (evita abuso)

// ── headers de segurança em todas as respostas ──────────────────────────────
app.use((req, res, next) => {
  // impede o navegador de "adivinhar" o tipo do conteúdo (evita alguns XSS)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // impede que o app seja embutido em iframe de outro site (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // proteção XSS legada de alguns navegadores
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // não vaza a URL completa do app para sites externos
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy: controla de onde scripts/estilos podem vir.
  // 'unsafe-inline' é necessário porque o app usa estilos e scripts inline;
  // restringe o resto a 'self' (o próprio domínio) + o necessário.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "media-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  next();
});

// valida a origem das requisições POST (proteção CSRF). Definida mais abaixo;
// registrada aqui para proteger TODAS as rotas (app.use só afeta rotas seguintes).
app.use(checkOrigin);

// volume persistente do Railway em /data; se não existir, cai em /tmp
const DATA_DIR = fs.existsSync('/data') ? '/data' : '/tmp';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE ALUNOS (logins)
// Agora os alunos são cadastrados pelo painel admin, com senha guardada em HASH
// (bcrypt). As senhas nunca são salvas em texto puro.
// A variável ALUNOS antiga (texto puro) só é usada UMA VEZ para migração inicial.
// ════════════════════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');

// alunos = { user: { hash, criadoEm } }
let alunos = {};
const ALUNOS_FILE = DATA_DIR + '/alunos.json';
function carregarAlunosDisco() {
  try { alunos = JSON.parse(fs.readFileSync(ALUNOS_FILE, 'utf8')); } catch { alunos = {}; }
}
function salvarAlunos() {
  try { fs.writeFileSync(ALUNOS_FILE, JSON.stringify(alunos)); }
  catch (e) { console.log('Erro ao salvar alunos:', e.message); }
}
carregarAlunosDisco();

// migração única: se não há alunos no disco mas existe a variável ALUNOS antiga,
// importa esses logins gerando hash para cada um (só roda uma vez).
function migrarAlunosAntigos() {
  if (Object.keys(alunos).length > 0) return; // já migrado
  const raw = process.env.ALUNOS || '';
  if (!raw.trim()) return;
  let migrou = 0;
  raw.split(',').forEach(par => {
    const [user, pass] = par.split(':');
    if (user && pass) {
      const u = user.trim();
      const hash = bcrypt.hashSync(pass.trim(), 10);
      alunos[u] = { hash, criadoEm: new Date().toISOString() };
      migrou++;
    }
  });
  if (migrou > 0) { salvarAlunos(); console.log('Migrados ' + migrou + ' aluno(s) da variável ALUNOS para hash.'); }
}
migrarAlunosAntigos();

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

// ── reports de erro enviados pelos alunos ───────────────────────────────────
let reports = [];
const REPORTS_FILE = DATA_DIR + '/reports.json';
function carregarReports() {
  try { reports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch { reports = []; }
}
function salvarReports() {
  try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports)); }
  catch (e) { console.log('Erro ao salvar reports:', e.message); }
}
carregarReports();

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
  const registro = alunos[user];
  const pv = registro ? senhaVersao(registro) : '0';
  const payload = `${user}|${device}|${Date.now()}|${pv}`;
  const assinatura = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + assinatura;
}

function validarToken(token) {
  try {
    const [b64, assinatura] = token.split('.');
    const payload = Buffer.from(b64, 'base64').toString();
    const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (assinatura !== esperado) return null;
    const [user, device, ts, pv] = payload.split('|');
    return { user, device, ts, pv };
  } catch { return null; }
}

// ── middleware de autenticação ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const dados = validarToken(token);
  if (!dados) return res.status(401).json({ error: 'Sessão inválida' });

  // 1. o aluno ainda existe? (se foi removido, o token deixa de valer)
  const registro = alunos[dados.user];
  if (!registro) return res.status(401).json({ error: 'Conta não encontrada. Faça login novamente.' });

  // 2. a senha mudou depois que o token foi emitido? (invalida tokens antigos)
  //    o token carrega a "versão" da senha; se não bater, exige novo login
  if (typeof dados.pv !== 'undefined' && String(dados.pv) !== String(senhaVersao(registro))) {
    return res.status(401).json({ error: 'Senha alterada. Faça login novamente.' });
  }

  // 3. o dispositivo está entre os registrados para esse usuário?
  const lista = dispositivosPorUser[dados.user] || [];
  if (!lista.some(d => d.id === dados.device)) {
    return res.status(403).json({ error: 'Dispositivo não autorizado. Faça login novamente.' });
  }
  req.user = dados.user;
  next();
}

// "versão" da senha: primeiros caracteres do hash. Quando a senha muda, o hash
// muda, então a versão muda, e tokens antigos (com versão velha) param de valer.
function senhaVersao(registro) {
  if (!registro || !registro.hash) return '0';
  return registro.hash.slice(-10); // trecho final do hash bcrypt
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
// ── proteção CSRF: valida a origem das requisições que mudam estado ─────────
// como o app usa token no header (não cookie), o CSRF clássico já é mitigado,
// mas validar a Origin é uma camada extra. Só aplica a POST (que alteram dados).
function checkOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const host = req.headers.host || '';
  if (!origin && !referer) return next();
  const fonte = origin || referer;
  if (host && fonte.includes(host)) return next();
  return res.status(403).json({ error: 'Origem não autorizada' });
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
  const lista = Object.keys(alunos).map(user => {
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

// ── cadastrar um novo aluno (senha guardada em hash) ─────────────────────────
app.post('/api/admin/criar-aluno', checkAdmin, (req, res) => {
  let { user, senha } = req.body;
  user = (user || '').trim();
  senha = (senha || '').trim();
  if (!user || !senha) return res.json({ error: 'Informe usuário e senha' });
  if (user.length < 2) return res.json({ error: 'Usuário muito curto' });
  if (senha.length < 4) return res.json({ error: 'Senha muito curta (mínimo 4 caracteres)' });
  if (/[,:]/.test(user)) return res.json({ error: 'Usuário não pode conter , ou :' });
  if (alunos[user]) return res.json({ error: 'Já existe um aluno com esse nome' });
  alunos[user] = { hash: bcrypt.hashSync(senha, 10), criadoEm: new Date().toISOString() };
  salvarAlunos();
  res.json({ ok: true });
});

// ── trocar a senha de um aluno ───────────────────────────────────────────────
app.post('/api/admin/trocar-senha', checkAdmin, (req, res) => {
  let { user, senha } = req.body;
  user = (user || '').trim();
  senha = (senha || '').trim();
  if (!alunos[user]) return res.json({ error: 'Aluno não encontrado' });
  if (senha.length < 4) return res.json({ error: 'Senha muito curta (mínimo 4 caracteres)' });
  alunos[user].hash = bcrypt.hashSync(senha, 10);
  salvarAlunos();
  res.json({ ok: true });
});

// ── remover um aluno (apaga login, dispositivos e pagamento) ─────────────────
app.post('/api/admin/remover-aluno', checkAdmin, (req, res) => {
  const user = (req.body.user || '').trim();
  if (!alunos[user]) return res.json({ error: 'Aluno não encontrado' });
  delete alunos[user];
  salvarAlunos();
  // limpa dados associados
  if (dispositivosPorUser[user]) { delete dispositivosPorUser[user]; salvarDispositivos(); }
  if (pagamentos[user]) { delete pagamentos[user]; salvarPagamentos(); }
  res.json({ ok: true });
});

// marca um pagamento: soma 30 dias ao vencimento e registra o valor
app.post('/api/admin/marcar-pagamento', checkAdmin, (req, res) => {
  const { user, valor } = req.body;
  if (!alunos[user]) return res.json({ error: 'Aluno não encontrado' });
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
  if (!alunos[user]) return res.json({ error: 'Aluno não encontrado' });
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
  if (!alunos[user]) return res.json({ error: 'Aluno não encontrado' });
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
  const registro = alunos[user];
  if (!registro || !bcrypt.compareSync(pass, registro.hash)) {
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
// tipo de matéria controla o que aparece:
//   (sem tipo) = padrão: teste semanal, mostra matéria do teste + simulado sempre
//   'soDever'    = só aula do dia + deveres (sem teste, resumo ou simulado)
//   'provaFinal' = aula + deveres + resumo; só mostra matéria do teste + simulado
//                  quando detectar teste/prova/avaliação marcado no blog
const GRADE = {
  seg: [
    { m:'Filosofia',      p:'Sandra Maisa',    url:'https://profsandracnsanglo.blogspot.com/p/3-ano-filosofia.html', tipo:'provaFinal' },
    { m:'Geografia',      p:'Gabriel Fonseca', url:'https://profgabrielcnsanglo.blogspot.com/p/3-ano-geografia.html', ignorarAvaliacao:true, testeAulaAnterior:true },
    { m:'Prog. Lidere',   p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-lidere.html', tipo:'soDever' },
  ],
  ter: [
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'História', tipo:'acumulativo' },
    { m:'Química A',      p:'Washington Gois', url:'https://profwashingtonanglo.blogspot.com/p/3-ano.html', formato:'testesPorData' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, formato:'fisica', aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
  qua: [
    { m:'Linguística',    p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-gramatica.html', formato:'duasAulas' },
    { m:'Matemática A',   p:'Tiago Santos',    url:'https://professoratiagocnsanglo.blogspot.com/p/3-ano-em-matematica-a_27.html', formato:'rotulado' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Inglês',         p:'Jully Alvim',     url:'https://profjullycnsanglo.blogspot.com/p/3ano-em.html', tipo:'provaFinal', maxDiasDever:14, linkEstudo:'https://drive.google.com/file/d/1qo7bJWbUPA3Yz3W9dvBKNSYCCdHRkwpY/view?usp=drivesdk', linkEstudoLabel:'Arquivo de estudos do 2º bimestre' },
  ],
  qui: [
    { m:'Biologia',       p:'Angelita Pimenta',url:'https://profangelitacnsanglo.blogspot.com/p/3-ano.html', ignorarAvaliacao:true },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Química B',      p:'Maurélio',        url:'https://maureliopereiral.blogspot.com/p/3-ano.html', maxDiasDever:7, ignorarAvaliacao:true, deverFixo:'TAREFAS DO 2º BIMESTRE: todas as TC da Frente A', aviso:'O professor marcou no blog a data da prova final do bimestre, mas essa data está incorreta e deve ser ajustada por ele. A prova não é nesta data. Considere abaixo apenas a matéria do teste mais recente.' },
    { m:'Redação',        p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14 },
  ],
  sex: [
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html', maxDiasDever:14, testeMarcado:true, ignorarAvaliacao:true },
    { m:'Redação e Literatura', p:'Fábio', combinar:[
      { m:'Redação',    p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14 },
      { m:'Literatura', p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Literatura', ignorarAvaliacao:true },
    ] },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, formato:'fisica', aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
};
const DIAS_PT = { seg:'Segunda', ter:'Terça', qua:'Quarta', qui:'Quinta', sex:'Sexta' };
// modelos em ordem de uso. Haiku primeiro (barato e rápido). Se ele falhar em gerar
// JSON válido, o sistema sobe automaticamente para o Sonnet (mais capaz). Assim, o
// custo fica baixo no caso comum, e o Sonnet só é usado quando realmente precisa.
// Haiku é o principal (barato e rápido). Sonnet 4.6 é a ÚNICA reserva, usada só se o
// Haiku gerar JSON inválido. O Opus foi removido da cadeia: é caro demais para extração
// de blog e disparava o custo quando entrava no fallback.
const MODELS = ['claude-haiku-4-5-20251001','claude-sonnet-4-6'];

// ════════════════════════════════════════════════════════════════════════════
// CACHE DE 24H — processa cada matéria 1x por dia, salva em disco
// ════════════════════════════════════════════════════════════════════════════
const CACHE_VERSAO = 'v31';
const CACHE_FILE = DATA_DIR + '/cache_estudo.json';
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
// limpa do disco qualquer cache que não seja da versão atual (evita servir dados velhos após deploy)
(function limparCacheAntigo(){
  // remove cache de dias anteriores (mantém só o de hoje). Não apaga por versão,
  // para que um deploy não invalide o cache bom do dia.
  const hoje = new Date().toISOString().slice(0,10);
  let mudou = false;
  Object.keys(cache).forEach(k => {
    if (!k.startsWith(hoje + '_')) { delete cache[k]; mudou = true; }
  });
  if (mudou) {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); console.log('Cache de dias anteriores limpo.'); } catch {}
  }
})();
function salvarCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
}
// versão do cache: mudar este número invalida todo o cache antigo no próximo deploy
function chaveCacheHoje(dayKey) {
  const d = new Date();
  const dia = d.toISOString().slice(0,10); // AAAA-MM-DD
  // a versão NÃO entra mais na chave: assim um deploy não joga fora o cache bom.
  // o cache se renova sozinho a cada dia (a data está na chave). Para forçar
  // reprocessamento após mudar a lógica de leitura, use /api/limpar-cache.
  return `${dia}_${dayKey}`;
}

// ── busca blog ──────────────────────────────────────────────────────────────
// cache de blogs em memória: o mesmo blog (URL) é usado por várias matérias e dias
// (ex: Mat B aparece quarta e quinta). Sem isso, o mesmo blog era baixado várias vezes,
// o que deixava o carregamento MUITO lento. Cada blog fica em cache por 10 minutos.
const blogCache = {}; // url -> { texto, ts }
const BLOG_CACHE_MS = 30 * 60 * 1000; // 30 minutos (blogs mudam pouco; reduz buscas e uso de proxy)

let ultimaEstrategia = ''; // qual estratégia de busca funcionou por último (p/ diagnóstico)
// busca o HTML de uma URL. Tenta DIRETO primeiro; se falhar (ex: Blogspot bloqueia com
// 403 o IP do servidor), tenta por proxies de leitura públicos, em cascata, até um
// funcionar. Isso resolve o "não puxou nada" causado pelo bloqueio do Blogspot.
async function obterHtml(url) {
  const headersNavegador = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache'
  };
  // estratégias de busca, em ordem de preferência. Timeouts CURTOS para não travar o app:
  // se uma estratégia demora, passa rápido para a próxima.
  const estrategias = [
    // 1) direto (rápido quando o blog não bloqueia)
    async () => {
      const r = await fetch(url, { headers: headersNavegador, signal: AbortSignal.timeout(8000) });
      return r.ok ? await r.text() : null;
    },
    // 2) AllOrigins (proxy que devolve o conteúdo bruto)
    async () => {
      const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(10000) });
      return r.ok ? await r.text() : null;
    },
    // 3) corsproxy.io
    async () => {
      const r = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { headers: headersNavegador, signal: AbortSignal.timeout(10000) });
      return r.ok ? await r.text() : null;
    }
  ];
  const nomes = ['direto', 'allorigins', 'corsproxy'];
  for (let idx = 0; idx < estrategias.length; idx++) {
    try {
      const html = await estrategias[idx](); // UMA tentativa por estratégia (sem repetir)
      if (html && html.length > 400) {
        ultimaEstrategia = nomes[idx];
        return html;
      }
    } catch (e) { /* tenta a próxima estratégia */ }
  }
  return null;
}

async function fetchBlog(url) {
  // serve do cache de memória se foi buscado há menos de 10 min
  const cached = blogCache[url];
  if (cached && (Date.now() - cached.ts) < BLOG_CACHE_MS) {
    return cached.texto;
  }
  const html = await obterHtml(url);
  if (!html) return null; // todas as estratégias falharam; NÃO cacheia (tenta de novo depois)
  try {
    let texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      // remove widgets de compartilhamento e rodapé do Blogspot
      .replace(/<div[^>]*class=['"][^'"]*sharing[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class=['"][^'"]*post-share-buttons[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class=['"][^'"]*social[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      // PRESERVA A ESTRUTURA DA TABELA: cada linha <tr> vira uma linha de texto,
      // cada célula <td>/<th> é separada por " | ". Isso é essencial para a IA
      // entender qual matéria/dever pertence a qual data.
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .replace(/ \| (?= \| )/g, '')
      .trim();
    // remove linhas que são claramente botões de compartilhar/navegação do Blogspot
    const lixo = /^(enviar por e-?mail|postar no blog|compartilhar (no|com)|marcadores|postagens? (mais|mais antiga|recente)|in[ií]cio|assinar|comentários|nenhum comentário|reações|um blog|tecnologia do blogger|página inicial|ver vers[aã]o|seguir)/i;
    texto = texto.split('\n').filter(l => !lixo.test(l.trim())).join('\n');
    // envia só os 7000 caracteres finais (aulas mais recentes) à IA. Cortar pela metade
    // reduz o custo por matéria, sem perder as aulas recentes que importam para o teste.
    const textoFinal = texto.length > 7000 ? texto.slice(texto.length - 7000) : texto;
    blogCache[url] = { texto: textoFinal, ts: Date.now() }; // guarda no cache de memória
    return textoFinal;
  } catch { return null; }
}

function hojeStr() {
  const d = new Date();
  return ('0'+d.getDate()).slice(-2) + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + d.getFullYear();
}

async function callAnthropic(prompt, modelIndex, tentativa) {
  modelIndex = modelIndex || 0;
  tentativa = tentativa || 0;
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
  // qualquer erro da API: se for not_found (modelo não existe), tenta o próximo modelo
  if (data.type === 'error' && data.error && data.error.type === 'not_found_error') {
    if (modelIndex + 1 < MODELS.length) return callAnthropic(prompt, modelIndex + 1);
    throw new Error('Modelo não encontrado: ' + (data.error.message || ''));
  }
  // rate limit (429) ou sobrecarga (529): espera e tenta de novo (até 3 vezes)
  if (data.type === 'error' && data.error && /rate_limit|overloaded/i.test(data.error.type || '')) {
    if (tentativa < 3) {
      await new Promise(r => setTimeout(r, 2000 * (tentativa + 1)));
      return callAnthropic(prompt, modelIndex, tentativa + 1);
    }
    throw new Error('IA sobrecarregada');
  }
  // qualquer OUTRO erro da API (auth, permissão, billing, request inválido): expõe a
  // mensagem real, em vez de "resposta inesperada". Isso facilita o diagnóstico.
  if (data.type === 'error' && data.error) {
    throw new Error('Erro da API [' + (data.error.type||'?') + ']: ' + (data.error.message || 'sem detalhe'));
  }
  if (!data.content || !Array.isArray(data.content)) {
    throw new Error('Resposta sem conteúdo: ' + JSON.stringify(data).slice(0, 300));
  }
  const raw = data.content.map(function(i){ return i.text || ''; }).join('').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // tenta extrair o JSON de dentro do texto (a IA às vezes adiciona texto em volta)
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    // JSON inválido: tenta o PRÓXIMO modelo (mais capaz), em vez de desistir.
    // isso resolve o caso do Haiku gerar JSON quebrado em blogs complexos.
    if (modelIndex + 1 < MODELS.length) {
      return callAnthropic(prompt, modelIndex + 1, tentativa);
    }
    throw new Error('JSON inválido da IA');
  }
}

// detecta textos que são eventos/atividades da escola, NÃO matéria nem dever
// (ex: copaanglo, gincana, olimpíadas, feira, festa junina, simulado de evento)
function ehEventoEscolar(texto) {
  const t = (texto || '').toLowerCase();
  return /cop[ae]?[\s\-]*anglo|copanglo|copaanglo|prova\s+anglo|simulado\s+anglo|gincana|olimp[ií]ada|festa\s*junina|feira\s*de|feira\s*cultural|festival|interclasse|recesso|feriado|reuni[ãa]o de pais|conselho de classe|sábado letivo|s[áa]bado letivo|semana de avalia|jogos? (internos|escolares)|excurs[ãa]o|passeio|formatura|ensaio|aula concedida/i.test(t);
}

// converte "DD/MM" ou "DD/MM/AAAA" em número comparável (AAAAMMDD)
function dataParaNum(ddmm) {
  if (!ddmm) return 0;
  const m = ddmm.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return 0;
  const dia = parseInt(m[1],10), mes = parseInt(m[2],10);
  let ano = m[3] ? parseInt(m[3],10) : 2026;
  if (ano < 100) ano += 2000;
  return ano*10000 + mes*100 + dia;
}

// converte AAAAMMDD de volta para objeto Date (para calcular diferença em dias)
function numParaData(num) {
  if (!num) return null;
  const ano = Math.floor(num / 10000);
  const mes = Math.floor((num % 10000) / 100) - 1;
  const dia = num % 100;
  return new Date(ano, mes, dia);
}

// ── processamento especial de HISTÓRIA (acumulativo por bimestre) ────────────
// A matéria do teste é tudo que foi dado no 2º bimestre e ainda NÃO caiu em teste.
async function processarHistoria(materia, professor, blogText, filtro, dataRef) {
  const temConteudo = blogText && blogText.length > 50;
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  // ETAPA 1: extrai a tabela E identifica o que já caiu em teste
  const prompt = 'Você analisa o registro de aulas de História do professor ' + professor + '. Considere SOMENTE História (ignore Sociologia ou outra disciplina misturada).' +
    '\n\nO registro é uma TABELA com colunas separadas por " | ": DATA | CONTEÚDO | DEVERES.' +
    '\n\n*** MARCO DO BIMESTRE ***' +
    '\nProcure no texto onde está escrito "2º BIMESTRE" (ou "2 BIMESTRE", "SEGUNDO BIMESTRE"). Considere APENAS as aulas/matérias que aparecem DEPOIS desse marco. Ignore tudo que vem antes (é do 1º bimestre).' +
    '\n\n*** O QUE EXTRAIR ***' +
    '\n1. "aula_hoje": o conteúdo da matéria da linha cuja data é EXATAMENTE ' + ref + '. Se não houver matéria nessa data exata, "".' +
    '\n2. "deveres_aula": deveres da linha de ' + ref + '. Se não houver, [].' +
    '\n3. "deveres_pendentes": deveres das 2 últimas datas ANTERIORES a ' + ref + ' que tenham dever. Formato [{"data":"DD/MM","deveres":["..."]}].' +
    '\n4. "materias_bimestre": LISTA de TODAS as matérias/conteúdos dados no 2º BIMESTRE (cada aula com seu conteúdo), na ordem. Formato [{"data":"DD/MM","materia":"conteúdo"}].' +
    '\n5. "ja_cairam": LISTA das matérias que JÁ FORAM APLICADAS EM TESTE. O professor marca isso escrevendo algo como "Foi realizado testinho (Matéria: X)" ou "teste (Matéria: X)" ou "avaliação: X". Extraia o nome da matéria X de cada uma dessas anotações. Formato ["Revolução Francesa","..."].' +
    '\n\nIGNORE textos de navegação do Blogspot (compartilhar, marcadores, etc).' +
    '\nIGNORE TAMBÉM eventos e atividades da escola que NÃO são matéria nem dever: CopaAnglo, gincana, olimpíadas, feira cultural, festa junina, festival, interclasse, recesso, feriado, sábado letivo, semana de avaliações, ensaios, excursões, formatura. Esses NUNCA são deveres nem conteúdo de aula.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"aula_hoje":"","deveres_aula":[],"deveres_pendentes":[],"materias_bimestre":[{"data":"DD/MM","materia":""}],"ja_cairam":[]}';

  let dados;
  try { dados = await callAnthropic(prompt, 0); } catch (e) { dados = {}; }

  const ehLixo = (t) => ehEventoEscolar(t) || /enviar por e-?mail|postar no blog|compartilhar|marcadores|postagens?|^in[ií]cio$|assinar|reações|coment/i.test((t||'').trim());

  // limpa deveres
  let deveres_aula = (dados.deveres_aula || []).filter(d => d && d.trim() && !ehLixo(d));
  let deveres_pendentes = (dados.deveres_pendentes || [])
    .map(g => ({ data: (g.data||'').slice(0,5), deveres: (g.deveres||[]).filter(d => d && d.trim() && !ehLixo(d)) }))
    .filter(g => g.deveres.length > 0)
    .slice(0, 2);

  // CÓDIGO decide o que sobrou: matérias do bimestre MENOS as que já caíram
  const materiasBim = (dados.materias_bimestre || []).filter(m => m && m.materia && m.materia.trim());
  const jaCairam = (dados.ja_cairam || []).map(s => (s||'').toLowerCase().trim()).filter(Boolean);

  // uma matéria "já caiu" se o nome dela bate bem com algum item de jaCairam
  function jaCaiu(materiaTexto) {
    const t = (materiaTexto||'').toLowerCase();
    return jaCairam.some(caiu => {
      const palavrasCaiu = caiu.split(/\s+/).filter(p => p.length > 3);
      if (palavrasCaiu.length === 0) return t.includes(caiu);
      // conta quantas palavras significativas do "já caiu" aparecem na matéria
      const batem = palavrasCaiu.filter(p => t.includes(p)).length;
      // exige que a MAIORIA das palavras bata (evita falso positivo por 1 palavra só
      // compartilhada, ex: "Primeiro Reinado" vs "Segundo Reinado")
      return batem >= Math.ceil(palavrasCaiu.length * 0.6) && batem >= 1
             && (palavrasCaiu.length === 1 ? true : batem >= 2);
    });
  }

  // matérias que sobraram (podem cair no teste)
  const sobraram = materiasBim.filter(m => !jaCaiu(m.materia));

  // matérias que sobraram (podem cair no teste) — mantido só como dado de apoio,
  // sem gerar resumo (o front não usa mais a lista; economiza tokens)
  const materiasComResumo = sobraram.map(m => ({ data:(m.data||'').slice(0,5), materia:m.materia, resumo:'' }));

  const aula_hoje = (dados.aula_hoje && dados.aula_hoje.trim().length > 1) ? dados.aula_hoje.trim() : '';

  // NOVA LÓGICA: a matéria do teste é o "Foi realizado testinho (Matéria: X)" marcado
  // na data de REFERÊNCIA. Busca direto no blog a linha da data de hoje e extrai o testinho.
  // formato real: "Data:23/.06 - Aula: 14 -Matéria: Segundo Reinado - Foi realizado testinho (Matéria: Período Joanino)"
  let testeMateria = '', testeData = '';
  const refSlash = refDDMM; // ex "23/06"
  const refRegex = refSlash.replace('/', '\\/?\\.?'); // tolera "23/.06" e "23/06"
  // tenta achar o trecho da data de referência e o testinho logo após
  const reLinha = new RegExp('data\\s*:?\\s*' + refRegex + '[\\s\\S]{0,260}?foi\\s+realizado\\s+testinho\\s*\\(mat[ée]ria:\\s*([^)]+)\\)', 'i');
  const mLinha = (blogText || '').match(reLinha);
  if (mLinha && mLinha[1].trim()) {
    testeMateria = mLinha[1].trim();
    testeData = refDDMM;
  }

  // resumo gerado sob demanda (quando o aluno abre a matéria), não aqui
  let resumoTeste = '';

  return {
    aula_hoje,
    aula_data: aula_hoje ? refDDMM : '',
    deveres_pendentes, deveres_aula,
    // campos específicos de história
    historia: true,
    materias_teste: materiasComResumo, // lista das que podem cair, com resumo (mantido como apoio)
    // matéria do teste do dia (testinho marcado na data de referência)
    tem_avaliacao: !!testeMateria, materia_teste: testeMateria, materia_teste_data: testeData,
    resumo: resumoTeste, questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

// ── processamento de GRAMÁTICA/LINGUÍSTICA (2 aulas no mesmo dia) ─────────────
// O professor numera as aulas (AULA 9, AULA 10) e pode dar 2 no mesmo dia.
// Mostra as aulas do dia de referência; o dever é as ATIVIDADES da última aula.
async function processarDuasAulas(materia, professor, blogText, filtro, dataRef, maxDeveres) {
  const temConteudo = blogText && blogText.length > 50;
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  const prompt = 'Você extrai dados do registro de aulas de ' + materia + ', professor ' + professor + '.' +
    '\n\n*** FORMATO ***' +
    '\nAs aulas são numeradas: "AULA 7", "AULA 8", "AULA 9", "AULA 10"... Cada uma tem "DATA: DD/MM/AAAA" e uma descrição.' +
    '\nPode haver DUAS (ou mais) aulas no MESMO dia (ex: AULA 9 e AULA 10 ambas em 17/06).' +
    '\nNa descrição de cada aula, procure as ATIVIDADES/DEVERES: textos como "Atividade complementar", "Atividades na apostila nas páginas X", "Páginas da apostila X", "atividades das páginas X". Essas atividades SÃO o dever do aluno.' +
    '\n\n*** O QUE EXTRAIR ***' +
    '\nExtraia TODAS as aulas numeradas que tiverem data. Para cada uma:' +
    '\n- "numero": o número da aula (ex: 9, 10).' +
    '\n- "data": a data dela (DD/MM).' +
    '\n- "descricao": o conteúdo da aula como está escrito no blog (completo). Ex: "aula expositiva sobre discurso citado, abordando os discursos direto, indireto e indireto livre".' +
    '\n- "tema": o TÓPICO central da aula em poucas palavras, SÓ o assunto estudado, sem verbos nem "aula expositiva sobre". Ex: para a descrição acima, o tema é "discurso direto, indireto e indireto livre". Para "estudo das orações subordinadas substantivas", o tema é "orações subordinadas substantivas".' +
    '\n- "atividades": lista das atividades/deveres daquela aula (ex: "Atividades na apostila nas páginas 37-38-39"). Se não houver, [].' +
    '\n\nIGNORE rodapé do Blogspot (Postagens, Páginas, perfil, Atom, "Escolha a turma", "Pesquisar este blog", nome do professor solto) e eventos da escola (CopaAnglo, gincana, etc.).' +
    '\nNÃO invente. Extraia só o que está escrito.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"aulas":[{"numero":9,"data":"DD/MM","descricao":"texto","tema":"tópico curto","atividades":["..."]}]}';

  let dados;
  try { dados = await callAnthropic(prompt, 0); } catch (e) { dados = { aulas: [] }; }

  const ehLixo = (t) => ehEventoEscolar(t) || /postagens?|^páginas$|^in[ií]cio$|pesquisar este blog|ver meu perfil|denunciar|arquivo do blog/i.test((t||'').trim());

  const aulas = (dados.aulas || [])
    .map(a => ({
      numero: a.numero,
      data: (a.data||'').slice(0,5),
      num: dataParaNum(a.data),
      descricao: (a.descricao||'').trim(),
      tema: (a.tema||'').trim(),
      atividades: (a.atividades||[]).filter(d => d && d.trim() && !ehLixo(d))
    }))
    .filter(a => a.num > 0);

  // aulas do dia de referência (pode ter 2)
  const aulasDoDia = aulas.filter(a => a.data === refDDMM).sort((x,y) => (x.numero||0) - (y.numero||0));

  // monta "aula de hoje" mostrando as 2 aulas
  let aula_hoje = '';
  if (aulasDoDia.length > 0) {
    aula_hoje = aulasDoDia.map(a => 'Aula ' + (a.numero||'?') + (a.descricao ? ': ' + a.descricao : '')).join('\n');
  }

  // dever de hoje = atividades da ÚLTIMA aula do dia (maior número)
  let deveres_aula = [];
  if (aulasDoDia.length > 0) {
    const ultima = aulasDoDia[aulasDoDia.length - 1];
    deveres_aula = ultima.atividades;
  }

  // deveres pendentes = atividades das 2 últimas datas ANTERIORES ao dia que tenham atividade
  const limite = (maxDeveres && maxDeveres > 0) ? maxDeveres : 2;
  const anteriores = aulas
    .filter(a => a.num < refNum && a.atividades.length > 0)
    .sort((a,b) => b.num - a.num);
  // agrupa por data (pode ter 2 aulas na mesma data anterior)
  const pendPorData = {};
  for (const a of anteriores) {
    if (!pendPorData[a.data]) pendPorData[a.data] = [];
    pendPorData[a.data].push(...a.atividades);
  }
  const deveres_pendentes = Object.keys(pendPorData)
    .map(data => ({ data, num: dataParaNum(data), deveres: pendPorData[data] }))
    .sort((a,b) => b.num - a.num)
    .slice(0, limite)
    .map(g => ({ data: g.data, deveres: g.deveres }));

  // MATÉRIA DO TESTE: a PRIMEIRA aula do dia da referência (menor número de aula daquela
  // data). Ex: hoje tem aula 11 e 12; a matéria do teste está na aula 11.
  // Se não houver aula exatamente na data de hoje, usa a aula mais recente até hoje.
  const aulasDoDiaRef = aulas
    .filter(a => a.descricao && a.descricao.length > 3 && a.data === refDDMM)
    .sort((a,b) => (a.numero||0) - (b.numero||0)); // menor nº de aula primeiro (a primeira)
  let linhaTeste = aulasDoDiaRef[0] || null;
  if (!linhaTeste) {
    // sem aula hoje: pega a aula mais recente até hoje (maior número)
    const recentes = aulas
      .filter(a => a.num <= refNum && a.descricao && a.descricao.length > 3)
      .sort((a,b) => (b.numero||0) - (a.numero||0) || b.num - a.num);
    linhaTeste = recentes[0] || null;
  }
  // a matéria do teste é o TEMA curto (ex: "discurso direto, indireto e indireto livre").
  // Se a IA não extraiu o tema, cai na descrição limpa como reserva.
  let materia_teste = linhaTeste ? (linhaTeste.tema || linhaTeste.descricao) : '';
  const materia_teste_data = linhaTeste ? linhaTeste.data : '';

  // se usou a descrição (sem tema), limpa: remove "aplicação de testinho" (início) e
  // "atividades de fixação" (fim), deixando o conteúdo expositivo.
  if (materia_teste && linhaTeste && !linhaTeste.tema) {
    let t = materia_teste;
    // se há "Em seguida," / "Na sequência," pega o que vem depois (o conteúdo principal)
    const mApos = t.match(/(?:em\s+seguida|na\s+sequ[êe]ncia|posteriormente)\s*,?\s*(aula\s+expositiva[^]*)/i);
    if (mApos) t = mApos[1];
    // corta a parte final de atividades/fixação/exercícios
    t = t.split(/\.\s*(?:posteriormente|por\s+fim|em\s+seguida|ao\s+final|os\s+alunos\s+realizaram|atividades?\s+de\s+fixa|atividade\s+complementar)/i)[0];
    // corta "com exemplos e explicações" e similares no fim (são acessórios, não conteúdo)
    t = t.replace(/,?\s*com\s+exemplos?(\s+e\s+explica[çc][õo]es?)?\.?\s*$/i, '');
    materia_teste = t.replace(/[.;\s]+$/,'').trim();
  }

  // gera resumo + questões sobre a matéria do teste
  // resumo e simulado são gerados SOB DEMANDA (quando o aluno abre a matéria), não aqui.
  let resumo = '', questoes = [];

  return {
    aula_hoje,
    aula_data: aulasDoDia.length ? refDDMM : '',
    deveres_pendentes, deveres_aula,
    tem_avaliacao: !!materia_teste, materia_teste, materia_teste_data,
    resumo, questoes,
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

// ── processamento de FÍSICA (formato TAREFA/TESTE/CONTEUDO com data no rótulo) ─
// O blog usa: "TAREFA DD/MM <descrição>" (dever), "TESTE DD/MM <conteúdo>" (teste),
// "CONTEUDO DO TESTE DD/MM <conteúdo>", "CONTEUDO DA PROVA <conteúdo>".
async function processarFisica(materia, professor, blogText, dataRef, maxDeveres) {
  const temConteudo = blogText && blogText.length > 50;
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);

  const prompt = 'Você extrai dados do registro de aulas de ' + materia + ', professor ' + professor + '.' +
    '\n\n*** FORMATO DESTE REGISTRO ***' +
    '\nO blog usa marcadores seguidos de data DD/MM e descrição:' +
    '\n- "TAREFA DD/MM <descrição>" = um DEVER do aluno com a data dele. Ex: "TAREFA 19/6 TRABALHO E POTENCIA".' +
    '\n- "TESTE DD/MM <conteúdo>" ou "CONTEUDO DO TESTE DD/MM <conteúdo>" = o conteúdo de um teste com a data dele. Ex: "TESTE 22/5 LEIS DE NEWTON".' +
    '\n- "CONTEUDO DA PROVA <conteúdo>" = conteúdo de prova (sem data clara).' +
    '\n\n*** O QUE EXTRAIR ***' +
    '\n1. "deveres": lista de TAREFAS. Para cada "TAREFA DD/MM X", extraia {data:"DD/MM", dever:"X"}.' +
    '\n2. "testes": lista de TESTES. Para cada "TESTE DD/MM X" ou "CONTEUDO DO TESTE DD/MM X", extraia {data:"DD/MM", conteudo:"X"}.' +
    '\nIGNORE eventos da escola (olimpíadas, copaanglo, gincana) e rodapé do blog (Postagens, perfil, Escolha a turma, Atom).' +
    '\nNÃO invente. Extraia só o que está escrito. Use o ano 2026 para todas as datas.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"deveres":[{"data":"DD/MM","dever":"texto"}],"testes":[{"data":"DD/MM","conteudo":"texto"}]}';

  let dados;
  try { dados = await callAnthropic(prompt, 0); } catch (e) { dados = { deveres: [], testes: [] }; }

  const ehLixo = (t) => ehEventoEscolar(t) || /postagens?|^páginas$|^in[ií]cio$|pesquisar este blog|ver meu perfil|denunciar|escolha a turma|fevereiro 20/i.test((t||'').trim());

  // deveres com data <= hoje, mais recentes primeiro
  const deveres = (dados.deveres || [])
    .map(d => ({ data: (d.data||'').slice(0,5), num: dataParaNum(d.data), dever: (d.dever||'').trim() }))
    .filter(d => d.num > 0 && d.dever && !ehLixo(d.dever))
    .sort((a,b) => b.num - a.num);

  // testes com data, mais recentes primeiro
  const testes = (dados.testes || [])
    .map(t => ({ data: (t.data||'').slice(0,5), num: dataParaNum(t.data), conteudo: (t.conteudo||'').trim() }))
    .filter(t => t.num > 0 && t.conteudo && !ehLixo(t.conteudo))
    .sort((a,b) => b.num - a.num);

  // AULA E DEVER DE HOJE: a tarefa da data de hoje (ou a mais recente até hoje)
  const deveresAteHoje = deveres.filter(d => d.num <= refNum);
  const deverHoje = deveresAteHoje[0] || null;
  const aula_hoje = deverHoje ? deverHoje.dever : '';
  const deveres_aula = deverHoje ? [deverHoje.dever] : [];

  // DEVERES PENDENTES: as tarefas ANTERIORES ao dever de hoje (limita por maxDeveres)
  const limite = (maxDeveres && maxDeveres > 0) ? maxDeveres : 2;
  const deveres_pendentes = deveresAteHoje
    .filter(d => !deverHoje || d.num < deverHoje.num)
    .slice(0, limite)
    .map(d => ({ data: d.data, deveres: [d.dever] }));

  // MATÉRIA DO TESTE: o professor pode aplicar (a) o conteúdo da última TAREFA/aula de
  // hoje, ou (b) o último TESTE marcado. Mostra os dois como "TESTE_ANTERIOR ou AULA_HOJE".
  // Ex: TESTE 22/5 LEIS DE NEWTON (teste) + TAREFA 19/6 TRABALHO E POTENCIA (aula de hoje)
  //  -> "LEIS DE NEWTON ou TRABALHO E POTENCIA".
  const testesAteHoje = testes.filter(t => t.num <= refNum);
  const ultimoTeste = testesAteHoje[0] || null;        // ex: Leis de Newton
  const conteudoHoje = deverHoje ? deverHoje.dever : ''; // ex: Trabalho e Potencia (tarefa de hoje)
  let materia_teste = '', materia_teste_data = '';
  const partes = [];
  if (ultimoTeste && ultimoTeste.conteudo) partes.push(ultimoTeste.conteudo);
  // só adiciona a aula de hoje se for diferente do último teste (evita repetir)
  if (conteudoHoje && conteudoHoje.toLowerCase() !== (ultimoTeste ? ultimoTeste.conteudo.toLowerCase() : '')) {
    partes.push(conteudoHoje);
  }
  if (partes.length) {
    materia_teste = partes.join(' ou ');
    materia_teste_data = deverHoje ? deverHoje.data : (ultimoTeste ? ultimoTeste.data : '');
  }

  let resumo = ''; // resumo gerado sob demanda (ao abrir a matéria)

  return {
    aula_hoje,
    aula_data: deverHoje ? deverHoje.data : '',
    deveres_pendentes, deveres_aula,
    tem_avaliacao: !!materia_teste, materia_teste, materia_teste_data,
    resumo, questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

// ── química A: blog é uma lista de "DD/MM - TESTE N - CONTEÚDO" ──────────────
// a matéria do teste é o TESTE da data de referência (ou o mais recente até hoje).
// Matemática B (Saulo): blog em texto corrido com rótulos.
// Formato: "DATA: DD/MM/AAAA MÓDULO: N MATÉRIA: X PAG: Y TAREFA: Z" (repetido).
// Extração determinística (sem IA): mais confiável e custo zero.
async function processarRotulosSaulo(materia, professor, blogText, dataRef) {
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  // extrai cada bloco DATA/MATÉRIA/TAREFA
  const re = /DATA:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:M[ÓO]DULO:\s*\d+\s*)?MAT[ÉE]RIA:\s*(.+?)\s*(?:PAG\.?:\s*.+?\s*)?TAREFA:\s*(.+?)(?=\s*DATA:|$)/gi;
  const linhas = [...(blogText || '').matchAll(re)]
    .map(m => ({
      data: m[1].slice(0,5),
      num: dataParaNum(m[1]),
      materia: (m[2] || '').replace(/\s+/g,' ').trim(),
      tarefa: (m[3] || '').replace(/\s+/g,' ').trim()
    }))
    .filter(l => l.num > 0 && l.materia && !ehEventoEscolar(l.materia));

  // AULA DE HOJE: a linha com data igual à referência (ou a mais recente até hoje)
  const ateHoje = linhas.filter(l => l.num <= refNum).sort((a,b) => b.num - a.num);
  const linhaHoje = linhas.find(l => l.data === refDDMM) || ateHoje[0] || null;
  const aula_hoje = linhaHoje ? linhaHoje.materia : '';

  // DEVER DESTA AULA: a TAREFA da linha de hoje (se não for "testinho", que é avaliação)
  const deveres_aula = [];
  if (linhaHoje && linhaHoje.tarefa && !/testinho|teste\b/i.test(linhaHoje.tarefa)) {
    deveres_aula.push(linhaHoje.tarefa);
  }

  // DEVERES PENDENTES: tarefas das aulas recentes anteriores a hoje (até 2), que sejam
  // tarefas de verdade (não "testinho"), agrupadas por data.
  const pendentes = [];
  for (const l of ateHoje) {
    if (l.data === refDDMM) continue; // a de hoje não é pendente
    if (l.tarefa && !/testinho|teste\b/i.test(l.tarefa)) {
      pendentes.push({ data: l.data, deveres: [l.tarefa] });
    }
    if (pendentes.length >= 2) break;
  }

  // MATÉRIA DO TESTE: o "testinho" marcado. No blog do Saulo, quando uma aula tem
  // TAREFA: TESTINHO, o conteúdo do teste é a matéria daquela aula. Pega o testinho
  // mais recente até hoje.
  let materia_teste = '', materia_teste_data = '';
  const comTestinho = ateHoje.filter(l => /testinho/i.test(l.tarefa));
  if (comTestinho.length) {
    materia_teste = comTestinho[0].materia;
    materia_teste_data = comTestinho[0].data;
  }

  return {
    aula_hoje,
    aula_data: linhaHoje ? linhaHoje.data : '',
    deveres_pendentes: pendentes,
    deveres_aula,
    tem_avaliacao: !!materia_teste, materia_teste, materia_teste_data,
    resumo: '', questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

async function processarTestesPorData(materia, professor, blogText, dataRef) {
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);

  // extrai todos os "DD/MM - TESTE N - CONTEÚDO" (para no próximo "DD/MM -" ou fim)
  const matches = [...(blogText || '').matchAll(/(\d{1,2}\/\d{1,2})\s*[-–]\s*TESTE\s+[IVXLC0-9]+\s*[-–]\s*(.+?)(?=\s+\d{1,2}\/\d{1,2}\s*[-–]|\s*\\n|$)/gi)];
  const testes = matches
    .map(m => ({ data: m[1], num: dataParaNum(m[1]), conteudo: m[2].trim().replace(/\s+/g,' ') }))
    .filter(t => t.num > 0 && t.conteudo && !ehEventoEscolar(t.conteudo))
    .sort((a,b) => b.num - a.num);

  // o teste atual: o da data de hoje, ou o mais recente até hoje
  const ateHoje = testes.filter(t => t.num <= refNum);
  const testeAtual = ateHoje[0] || testes[0] || null; // se nenhum até hoje, o mais recente
  const materia_teste = testeAtual ? testeAtual.conteudo : '';
  const materia_teste_data = testeAtual ? testeAtual.data : '';

  let resumo = ''; // resumo gerado sob demanda (ao abrir a matéria)

  return {
    aula_hoje: materia_teste ? ('Teste: ' + materia_teste) : '',
    aula_data: materia_teste_data,
    deveres_pendentes: [], deveres_aula: [],
    tem_avaliacao: !!materia_teste, materia_teste, materia_teste_data,
    resumo, questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

async function processWithAI(materia, professor, blogText, filtro, dataRef, labelDia, tipo, maxDeveres, maxDiasDever, formato, ignorarAvaliacao, testeAulaAnterior, testeMarcado) {
  // história tem lógica acumulativa própria
  if (tipo === 'acumulativo') {
    return processarHistoria(materia, professor, blogText, filtro, dataRef);
  }
  // gramática/linguística: mostra 2 aulas do mesmo dia, dever = atividades da última aula
  if (formato === 'duasAulas') {
    return processarDuasAulas(materia, professor, blogText, filtro, dataRef, maxDeveres);
  }
  // física: formato "TAREFA DD/MM ...", "TESTE DD/MM ...", "CONTEUDO DO TESTE DD/MM ..."
  if (formato === 'fisica') {
    return processarFisica(materia, professor, blogText, dataRef, maxDeveres);
  }
  // química A: blog é uma lista de "DD/MM - TESTE N - CONTEÚDO"
  if (formato === 'testesPorData') {
    return processarTestesPorData(materia, professor, blogText, dataRef);
  }
  // Matemática B (Saulo): blog com rótulos "DATA: DD/MM/AAAA MÓDULO: N MATÉRIA: X PAG: Y
  // TAREFA: Z" em texto corrido (não é tabela com barras). Extração 100% por código.
  if (formato === 'rotulosSaulo') {
    return processarRotulosSaulo(materia, professor, blogText, dataRef);
  }
  const temConteudo = blogText && blogText.length > 50;
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  let instrucaoFiltro = '';
  if (filtro) {
    instrucaoFiltro = ' IMPORTANTE: este blog mistura DUAS disciplinas; considere SOMENTE "' + filtro + '" e ignore a outra.';
  }

  // ETAPA 1: a IA apenas EXTRAI a tabela bruta (não decide nada).
  // Pedir só a estrutura é muito mais confiável que pedir interpretação.
  const promptTabela = 'Você extrai dados de um registro de aulas (blog de professor). Matéria: ' + materia + ', professor ' + professor + '.' + instrucaoFiltro +
    '\n\nO registro é uma TABELA. As colunas de cada linha estão separadas por " | " (barra vertical). O formato de cada linha é geralmente:' +
    '\n  DATA | CONTEÚDO/matéria da aula | DEVERES daquela data' +
    '\nCada linha começa com uma data. Tudo entre as barras "|" daquela linha pertence àquela data. NÃO misture conteúdo de linhas diferentes.' +
    '\n\n*** ATENÇÃO: A TABELA PODE ESTAR DESALINHADA ***' +
    '\nEste blog às vezes tem a tabela bagunçada: os deveres podem aparecer deslocados, numa linha visual diferente da data a que pertencem. Use INTELIGÊNCIA para realinhar:' +
    '\n1. A DATA é a âncora. Cada bloco de deveres pertence à aula de uma data específica.' +
    '\n2. Os deveres reais são tarefas para o aluno fazer (ex: "Página 52 (1-2)", "Exercícios 1-10", "Leitura p.16-18"). ' +
    '\n3. NÃO confunda as páginas da MATÉRIA (ex: "Páginas: 51, 56-58" que aparece junto ao conteúdo da aula) com DEVERES. Páginas que fazem parte da descrição da matéria NÃO são deveres.' +
    '\n4. Se um bloco de deveres aparece logo após uma data X e antes da próxima data Y, esses deveres são da data X.' +
    '\n5. Quando em dúvida sobre a qual data um dever pertence, associe-o à data mais próxima ACIMA dele no texto.' +
    '\n\n*** REGRA CRÍTICA SOBRE DEVERES ***' +
    '\nÀS VEZES uma data tem vários deveres que aparecem em linhas visuais seguidas. TODOS os deveres que aparecem ENTRE uma data e a PRÓXIMA data pertencem à PRIMEIRA data (a de cima).' +
    '\nNUNCA mova um dever para uma data anterior. Se a coluna de deveres de uma linha estiver "—" ou vazia, ela NÃO tem dever, mesmo que a linha seguinte tenha vários. Não puxe deveres da linha de baixo para preencher uma linha que está com "—".' +
    '\nExemplo: se 08/06 tem dever "—" e 15/06 tem "Págs 59-61; Pág 53-54", então 08/06 fica com [] e 15/06 fica com AMBOS ["Págs 59-61","Pág 53-54"]. NÃO coloque "Págs 59-61" no 08/06.' +
    '\nTAMBÉM NUNCA mova um dever para uma data POSTERIOR. Se 01/06 tem "Pág 52; Págs 63-64", AMBOS ficam no 01/06. NÃO empurre "Págs 63-64" para uma data seguinte (08/06 ou 15/06). Todos os deveres listados juntos sob uma data ficam TODOS naquela data.' +
    '\nRegra geral: agrupe TODOS os deveres consecutivos sob a data imediatamente ACIMA deles. Um dever pertence à data mais próxima ACIMA dele na tabela.' +
    '\n\n*** EXEMPLO REAL DESTE BLOG (siga este raciocínio) ***' +
    '\nNo registro, a linha "18/05" tem matéria "Platão... Páginas: 40,47,48" e o dever "3 e 4 (páginas 41-42); 5 a 8 (páginas 49-50)".' +
    '\nA linha "01/06" tem matéria "Ensaio para Festa Junina / Módulo 4" e os deveres "Página 52 (1-2)" E "Páginas 63-64 (1-6)" — AMBOS são do 01/06, juntos.' +
    '\nA linha "08/06" tem matéria "Correção da tarefa. A lógica de Aristóteles. Página 59" e dever "—" (vazio).' +
    '\nA linha "15/06" tem matéria VAZIA e os deveres "Páginas 59-61 (Leitura)" E "Página 53-54" — AMBOS do 15/06, juntos.' +
    '\nRESULTADO correto: 01/06 → ["Página 52 (1-2)","Páginas 63-64 (1-6)"]; 08/06 → []; 15/06 → ["Páginas 59-61 (Leitura)","Página 53-54"].' +
    '\n\n*** REGRA CRÍTICA SOBRE MATÉRIA ***' +
    '\nA matéria de cada linha pertence SÓ àquela data. Se a célula de matéria de uma data estiver VAZIA, a matéria fica "" (vazio) para essa data. NUNCA copie a matéria de uma linha para outra.' +
    '\nExemplo: se 08/06 tem matéria "A lógica de Aristóteles" e 15/06 tem a célula de matéria VAZIA (só tem deveres), então a matéria do 15/06 é "" (vazio). NÃO copie "A lógica de Aristóteles" para o 15/06. É melhor deixar vazio do que repetir a matéria de outra data.' +
    '\n\nExtraia TODAS as linhas que tenham uma data, na ordem em que aparecem. Para cada linha:' +
    '\n- "data": a data da linha (formato DD/MM)' +
    '\n- "materia": o texto da coluna do meio (conteúdo da aula). Se vazia, use "".' +
    '\n  IMPORTANTE: inclua o conteúdo COMPLETO da aula na "materia", incluindo o tema E as atividades/exercícios mencionados junto ao conteúdo (ex: "Testinho: Parnasianismo e Simbolismo; Atividades da apostila"). NÃO resuma nem corte partes do conteúdo da aula. Preserve o texto inteiro do que foi dado naquela aula.' +
    '\n- "deveres": TODOS os deveres daquela data (última coluna). Se for "—" ou vazio, use []. Liste cada dever como um item separado.' +
    '\n  ATENÇÃO: alguns professores escrevem o dever junto ao conteúdo da aula, não numa coluna separada. Se o texto da aula mencionar "Exercício(s)", "Atividade(s)", "Tarefa", "Fazer exercícios", "Apostila página X", "Visto na folha/caderno", trate isso TAMBÉM como dever daquela data (ex: "Exercício apostila 1" → dever "Exercício apostila 1").' +
    '\n\nIGNORE textos de navegação do Blogspot (Enviar por e-mail, Postar no blog, Compartilhar, Marcadores, Início, Assinar, Comentários, Reações). Nunca os inclua.' +
    '\nIGNORE TAMBÉM eventos e atividades da escola que NÃO são matéria nem dever: CopaAnglo, gincana, olimpíadas, feira cultural, festa junina, festival, interclasse, recesso, feriado, sábado letivo, semana de avaliações, ensaios, excursões, formatura. Esses NUNCA são deveres nem conteúdo de aula.' +
    '\nIGNORE listas de "conteúdo da avaliação bimestral", "matérias do bimestre" ou ementas que não têm data de aula específica. A matéria de cada linha é o que foi dado NAQUELA aula, não um resumo geral do bimestre.' +
    '\nNÃO invente linhas nem datas. Extraia só o que está escrito.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown, no formato:' +
    '\n{"linhas":[{"data":"DD/MM","materia":"texto ou vazio","deveres":["dever1"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}' +
    '\nNo campo "avaliacao": "tem"=true só se o registro mencionar explicitamente TESTE/PROVA/AVALIAÇÃO/SIMULADO com data; "data"=quando; "sobre"=o conteúdo que cai.';

  // formato "rotulado": blogs que usam etiquetas (MÓDULO:, MATÉRIA:, TAREFA:, DATA:)
  // com a DATA no FIM da linha, em vez de tabela com colunas. Ex: prof. de Matemática B.
  const promptRotulado = 'Você extrai dados de um registro de aulas de ' + materia + ', professor ' + professor + '.' + instrucaoFiltro +
    '\n\n*** FORMATO DESTE REGISTRO ***' +
    '\nCada aula é um bloco com CAMPOS ROTULADOS. A DATA aparece como "DATA: DD/MM/AAAA" (em geral no FIM ou início do bloco, não numa coluna fixa).' +
    '\nRótulos comuns: "MÓDULO:", "MATÉRIA:" ou "CONTEÚDO:", "PAG.:"/"PÁGINA:" (páginas), "TAREFA:" ou "TAREFA PARA XX:" (o dever), "PLURALL:" (plataforma de exercícios), "DATA:" (data da aula).' +
    '\nExemplo: "CONTEÚDO: Equações do 2º grau PÁGINA: 132 até 134 TAREFA PARA 18/03: Caderno de Estudos - Exercícios 1 ao 10 - Páginas 40 e 41 DATA: 11/03/2026"' +
    '\nNesse exemplo: data=11/03, materia="Equações do 2º grau (pág. 132-134)", dever="Caderno de Estudos - Exercícios 1 ao 10 - Páginas 40-41 (para 18/03)".' +
    '\n\n*** O QUE EXTRAIR ***' +
    '\nPara CADA aula (cada bloco que tenha "DATA:"):' +
    '\n- "data": o valor após "DATA:" no formato DD/MM.' +
    '\n- "materia": junte CONTEÚDO/MATÉRIA/MÓDULO + páginas num texto curto.' +
    '\n- "deveres": o que vem após "TAREFA:" ou "TAREFA PARA XX:". Esse é o DEVER. Inclua páginas/exercícios e o "(para dia XX)" se houver. Considere TAMBÉM como dever as ATIVIDADES e ATIVIDADES COMPLEMENTARES, se houver. Se a tarefa for "*", "—" ou vazia, use [].' +
    '\n\nIGNORE rodapé do Blogspot (Postagens, Páginas, Arquivo do blog, "Ver meu perfil", "Pesquisar este blog", nome/biografia do professor, Atom, "Escolha a turma", "janeiro 2022", etc.) e eventos da escola (CopaAnglo, gincana, festa junina, feriado, carnaval, etc.).' +
    '\nNÃO invente. Extraia só o que está escrito. Cada dever pertence à data da SUA própria linha/bloco.' +
    '\n\n*** TABELA DE TESTES (IMPORTANTE) ***' +
    '\nEste professor às vezes marca testes numa tabela: "Teste XX | dia da semana | DATA | Bimestre | Conteúdo: ...". Procure linhas com "Teste" + número + data.' +
    '\nSe achar um teste COM DATA, preencha "avaliacao": tem=true, data=data do teste (DD/MM), sobre=o CONTEÚDO que cai (o texto após "Conteúdo:" ou a matéria daquele teste). NUNCA use eventos (CopaAnglo, gincana, "aula concedida a...") como conteúdo do teste.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"linhas":[{"data":"DD/MM","materia":"texto","deveres":["tarefa"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}';

  // formato "agrupado": blogs que agrupam aulas geminadas ("Aulas 21 e 22/05: REDAÇÃO")
  // onde a "Tarefa:" é UM dever só para o grupo, não um por data. Ex: prof. de Redação.
  const promptAgrupado = 'Você extrai dados de aulas de ' + materia + ', professor ' + professor + '.' + instrucaoFiltro +
    '\n\n*** FORMATO DESTE REGISTRO ***' +
    '\nO blog mistura LITERATURA e REDAÇÃO. Cada aula começa com "Aulas X e Y/MM:" ou "Aula X/MM:" seguido da disciplina (REDAÇÃO ou LITERATURA) e do tema.' +
    '\nVocê deve considerar SOMENTE as aulas marcadas como "' + (filtro||'REDAÇÃO') + '". Ignore completamente as de outra disciplina. Quando a linha disser "REDAÇÃO E LITERATURA", considere só a parte de ' + (filtro||'REDAÇÃO') + '.' +
    '\nCada aula pode ter, no fim, "Tarefa:" com o dever. Os outros itens (temas, "Atividades de produção", "Atividades da apostila", "Atividades no caderno") são conteúdo da aula.' +
    '\nExemplos reais deste blog:' +
    '\n  "Aulas 21 e 22/05: REDAÇÃO Repertório legitimado, pertinente e produtivo; Atividades de produção; Tarefa: redação nota 1000." → data=22/05, dever="redação nota 1000".' +
    '\n  "Aulas 14 e 15/05: REDAÇÃO Competência 5 - elementos de intervenção; Atividades no caderno." → data=15/05, dever="Atividades no caderno" (aqui o dever é a atividade, não há linha "Tarefa:").' +
    '\n\n*** REGRA DO DEVER ***' +
    '\nO dever de cada aula é: o que vem após "Tarefa:" SE existir; senão, as "Atividades" que a aula pedir (ex: "Atividades no caderno", "Atividades da apostila páginas X"). Se a aula só tem tema/conteúdo sem atividade nem tarefa, deveres=[].' +
    '\n"Aulas X e Y" é UMA aula só (use a ÚLTIMA data do par). NUNCA repita o mesmo dever em duas datas.' +
    '\n\n*** O QUE EXTRAIR (só ' + (filtro||'REDAÇÃO') + ') ***' +
    '\n- "data": última data do grupo (DD/MM).' +
    '\n- "materia": disciplina + tema curto.' +
    '\n- "deveres": pela regra acima (um item, ou []).' +
    '\n\nIGNORE rodapé do Blogspot (Postagens, Páginas, Arquivo do blog, perfil, Atom) e eventos da escola (excursão, recesso, feriado, etc.).' +
    '\nNÃO invente. Extraia só o que está escrito.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"linhas":[{"data":"DD/MM","materia":"texto","deveres":["tarefa"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}';

  const promptEscolhido = (formato === 'rotulado') ? promptRotulado
                        : (formato === 'agrupado') ? promptAgrupado
                        : promptTabela;

  let tabela;
  try {
    const raw = await callAnthropic(promptEscolhido, 0);
    tabela = (raw && Array.isArray(raw.linhas)) ? raw : { linhas: [], avaliacao:{tem:false} };
  } catch (e) {
    tabela = { linhas: [], avaliacao:{tem:false} };
  }

  // EXTRAÇÃO DIRETA DO QUADRO DE TESTE (rotulado, ex: Matemática A do Tiago).
  // O professor marca o teste num quadro fixo:
  // "Teste 04 | Quarta-feira | 24/06/2026 | 2° Bimestre  Conteúdo: Introdução ao modelo
  //  exponencial  Páginas: 139 até 141". Pegamos o Conteúdo do teste cuja data bate com
  // a referência (ou o mais recente até a referência). Isso é mais confiável que a IA.
  if (formato === 'rotulado') {
    const quadros = [...(blogText || '').matchAll(/Teste\s+\d+\s*\|[^|]*\|\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\|[^]*?Conte[úu]do:\s*([^]*?)(?=\s*P[áa]ginas:|\s*Teste\s+\d+\s*\||\s*DATA:|$)/gi)];
    const testesQuadro = quadros
      .map(m => ({ data: (m[1]||'').slice(0,5), num: dataParaNum(m[1]), conteudo: (m[2]||'').replace(/\s+/g,' ').trim() }))
      .filter(t => t.num > 0 && t.conteudo)
      .sort((a,b) => b.num - a.num);
    if (testesQuadro.length) {
      const refN = dataParaNum(dataRef || hojeStr());
      // o teste da data de referência, ou o mais recente até ela, ou o próximo
      const doDia = testesQuadro.find(t => t.data === (dataRef||'').slice(0,5));
      const ateRef = testesQuadro.filter(t => t.num <= refN);
      const escolhido = doDia || ateRef[0] || testesQuadro[0];
      if (escolhido) {
        tabela.avaliacao = { tem: true, data: escolhido.data, sobre: escolhido.conteudo };
      }
    }
  }

  // limpa lixo de navegação dos deveres
  const ehLixo = (t) => ehEventoEscolar(t) || /enviar por e-?mail|postar no blog|compartilhar|marcadores|postagens?|^in[ií]cio$|assinar|reações|coment|pinterest|facebook|twitter/i.test((t||'').trim());
  const linhas = (tabela.linhas||[])
    .map(l => ({
      data: (l.data||'').trim(),
      num: dataParaNum(l.data),
      materia: (l.materia||'').trim(),
      deveres: (l.deveres||[]).filter(d => d && d.trim() && !ehLixo(d))
    }))
    .filter(l => l.num > 0);

  // ── O CÓDIGO DECIDE TUDO (determinístico, não depende da IA) ──
  // 1. AULA DO DIA: a linha com data EXATAMENTE igual à referência E que tenha matéria.
  let linhaRef = linhas.find(l => l.data.slice(0,5) === refDDMM);
  let aulaSomenteExibicao = false;
  // no formato agrupado (ex: redação "Aulas 18 e 19/06"), a data registrada é a última
  // do par, então pode não bater com hoje. Nesse caso, mostra a aula mais recente até hoje
  // APENAS como conteúdo da aula (sem repetir o dever dela, que já entra nos pendentes).
  if (!linhaRef && formato === 'agrupado') {
    const recentes = linhas.filter(l => l.num <= refNum && l.materia).sort((a,b) => b.num - a.num);
    linhaRef = recentes[0] || null;
    aulaSomenteExibicao = true;
  }
  const aula_hoje = (linhaRef && linhaRef.materia) ? linhaRef.materia : '';

  // 2. DEVERES DESTA AULA: deveres da linha de referência (não duplica quando é só exibição)
  const deveres_aula = (linhaRef && !aulaSomenteExibicao) ? linhaRef.deveres : [];

  // 3. DEVERES PENDENTES: as últimas datas ANTERIORES à referência que têm dever
  let anteriores = linhas
    .filter(l => l.num < refNum && l.deveres.length > 0)
    .sort((a,b) => b.num - a.num); // mais recente primeiro
  // limite de janela temporal (ex: inglês = só deveres de até 14 dias atrás)
  if (maxDiasDever && maxDiasDever > 0) {
    const refData = numParaData(refNum);
    anteriores = anteriores.filter(l => {
      const d = numParaData(l.num);
      if (!refData || !d) return true;
      const diasAtras = Math.floor((refData - d) / 86400000);
      return diasAtras <= maxDiasDever;
    });
  }
  const limiteDeveres = (maxDeveres && maxDeveres > 0) ? maxDeveres : 2;
  const deveres_pendentes = anteriores.slice(0, limiteDeveres).map(l => ({ data: l.data.slice(0,5), deveres: l.deveres }));

  // 4. MATÉRIA DO TESTE: a aula mais recente ATÉ hoje (inclui a de hoje), ignorando
  // eventos e ementas. Inclui hoje porque o teste costuma ser sobre a aula atual
  // (ex: literatura, cuja aula de hoje é o próprio "Testinho: Parnasianismo").
  // linhas que são EMENTA/lista de conteúdo de avaliação, não aula real dada
  // (ex: "Conteúdo do testinho 1: Taxonomia", "Avaliação bimestral", "Conteúdo da avaliação")
  const ehEmenta = (txt) => /conte[úu]do\s+(do|da|de)\s+(testinho|teste|avalia|prova)|mat[ée]ria\s+da\s+(prova|avalia)|avalia[çc][ãa]o\s+bimestral|prova\s+bimestral|conte[úu]do\s+do\s+\d?\s*[º°]?\s*bimestre|revis[ãa]o\s+(para|da)\s+(avalia|prova)|corre[çc][ãa]o\s+(da\s+)?avalia/i.test(txt || '');

  // Para a matéria do teste, normalmente incluímos a aula de HOJE (o teste costuma ser
  // sobre a aula atual, ex: literatura). Mas algumas matérias o teste é sobre a aula
  // ANTERIOR (ex: física) — nesse caso testeAulaAnterior=true exclui hoje.
  const limiteTeste = testeAulaAnterior ? (l => l.num < refNum) : (l => l.num <= refNum);
  const aulasAnteriores = linhas
    .filter(l => limiteTeste(l) && l.materia && !ehEventoEscolar(l.materia) && !ehEmenta(l.materia))
    .sort((a,b) => b.num - a.num);
  const linhaTeste = aulasAnteriores[0] || null;

  // matérias onde o professor MARCA explicitamente o que cai no teste daquele dia
  // (ex: biologia Ulisses: "Conteúdo do testinho 3: Gimnospermas").
  // O blog lista da data MAIS RECENTE para a mais antiga, então o PRIMEIRO
  // "Conteúdo do testinho" que aparece é o da aula atual. É esse que vale.
  let testeMarcadoTexto = '', testeMarcadoData = '';
  if (testeMarcado) {
    const m = (blogText || '').match(/conte[úu]do\s+do\s+testinho\s*\d*\s*:\s*([^.;\n]+)/i);
    if (m && m[1].trim()) {
      testeMarcadoTexto = m[1].trim();
    }
  }

  // decide se mostra teste conforme o tipo
  let tem_avaliacao, materia_teste, materia_teste_data;
  if (tipo === 'soDever') {
    tem_avaliacao = false; materia_teste = ''; materia_teste_data = '';
  } else if (tipo === 'provaFinal') {
    // só mostra teste se houver avaliação com DATA marcada PRÓXIMA da referência.
    let avalValida = false;
    let avalData = '';
    if (tabela.avaliacao && tabela.avaliacao.tem && tabela.avaliacao.data) {
      const avalNum = dataParaNum(tabela.avaliacao.data);
      if (avalNum > 0) {
        if (avalNum >= refNum - 5 && avalNum <= refNum + 12) {
          avalValida = true;
          avalData = tabela.avaliacao.data.slice(0,5);
        }
      }
    }
    tem_avaliacao = avalValida;
    materia_teste = avalValida ? (tabela.avaliacao.sobre || (linhaTeste ? linhaTeste.materia : '')) : '';
    materia_teste_data = avalValida ? avalData : '';
  } else {
    // matéria normal: teste semanal sempre.
    tem_avaliacao = true;
    // PRIORIDADE MÁXIMA: conteúdo marcado explicitamente como teste (ex: Ulisses)
    if (testeMarcado && testeMarcadoTexto) {
      materia_teste = testeMarcadoTexto;
      materia_teste_data = testeMarcadoData;
    } else {
      // senão: se o professor marcou uma tabela de teste com conteúdo, usa esse conteúdo
      // (a menos que a matéria peça para ignorar a avaliação do blog)
      const sobreTabela = (!ignorarAvaliacao && tabela.avaliacao && tabela.avaliacao.sobre && !ehEventoEscolar(tabela.avaliacao.sobre))
        ? tabela.avaliacao.sobre.trim() : '';
      if (sobreTabela) {
        materia_teste = sobreTabela;
        materia_teste_data = (tabela.avaliacao.data || '').slice(0,5);
      } else {
        materia_teste = linhaTeste ? linhaTeste.materia : '';
        materia_teste_data = linhaTeste ? linhaTeste.data.slice(0,5) : '';
      }
    }
  }
  // garante que a matéria do teste nunca seja um evento escolar nem uma ementa
  if (materia_teste && (ehEventoEscolar(materia_teste) || ehEmenta(materia_teste))) {
    // procura a aula real mais recente que não seja evento nem ementa
    const aulaReal = aulasAnteriores.find(l => !ehEmenta(l.materia));
    materia_teste = aulaReal ? aulaReal.materia : '';
    materia_teste_data = aulaReal ? aulaReal.data.slice(0,5) : '';
  }
  // se a matéria do teste contém um marcador explícito de testinho/teste, pega só o
  // tópico que vem depois dele. Ex: "Citoplasma - Atividades. Testinho: Citoplasma" ->
  // "Citoplasma"; "TESTE 4 : COEFICIENTE DE SOLUBILIDADE" -> "COEFICIENTE DE SOLUBILIDADE".
  if (materia_teste) {
    const mMarcador = materia_teste.match(/(?:testinho|teste\s*\d*)\s*:\s*(.+?)(?:[.;]|$)/i);
    if (mMarcador && mMarcador[1].trim().length > 1) {
      materia_teste = mMarcador[1].trim();
    }
  }
  // limpa a matéria do teste: remove sufixos de atividade/tarefa/páginas que não são
  // o CONTEÚDO em si (ex: "Parnasianismo; Atividades da apostila" → "Parnasianismo")
  if (materia_teste) {
    materia_teste = materia_teste
      .split(/[;.]\s*/)
      .filter(parte => parte.trim() && !/^\s*(atividades?|tarefas?|deveres?|exerc[íi]cios?|p[áa]g(\.|inas?)?|atividade complementar)\b/i.test(parte.trim()))
      .join('; ')
      .replace(/[;\s]+$/, '')
      .trim();
  }

  // ETAPA 2: gera resumo + questões só se houver matéria de teste (e a matéria usa teste)
  // RESUMO e SIMULADO agora são gerados SOB DEMANDA (quando o aluno abre a matéria),
  // não no carregamento. Isso deixa a carga do dia quase 2x mais rápida, porque elimina
  // uma chamada de IA por matéria. O front pede o resumo via /api/resumo ao expandir.
  let resumo = '', questoes = [];

  return {
    aula_hoje, aula_data: linhaRef ? linhaRef.data.slice(0,5) : '',
    materia_teste, materia_teste_data,
    deveres_pendentes, deveres_aula,
    tem_avaliacao, resumo, questoes,
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

// ── rota protegida ────────────────────────────────────────────────────────────
// processa um dia inteiro (com cache) e envia via SSE; retorna o offset final de índice
// calcula a data real (DD/MM/AAAA) do próximo dia da semana indicado
// offsetSemana: 0 = esta semana, usado para achar a data correta a partir de hoje
function dataDoDia(dayKey) {
  const dayNum = { seg:1, ter:2, qua:3, qui:4, sex:5 }[dayKey];
  const hoje = new Date();
  const hojeNum = hoje.getDay();
  let diff = dayNum - hojeNum;
  // se o dia já passou nesta semana (ou é fim de semana olhando pra segunda), pega o da próxima ocorrência
  if (diff < 0) diff += 7;
  // caso especial: fim de semana (sáb=6, dom=0) olhando para segunda → próxima segunda
  if ((hojeNum === 6 || hojeNum === 0) && dayKey === 'seg') {
    diff = hojeNum === 6 ? 2 : 1;
  }
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + diff);
  const dd = String(alvo.getDate()).padStart(2,'0');
  const mm = String(alvo.getMonth()+1).padStart(2,'0');
  const aaaa = alvo.getFullYear();
  return `${dd}/${mm}/${aaaa}`;
}

async function processarDia(res, dayKey, ehPrevia, offsetIndex) {
  const materias = GRADE[dayKey];
  const chave = chaveCacheHoje(dayKey);
  const dataRef = dataDoDia(dayKey);
  const labelDia = DIAS_PT[dayKey];

  // cabeçalho da seção do dia
  res.write('data: ' + JSON.stringify({ type:'section', dayKey, dayLabel:DIAS_PT[dayKey], dataRef, ehPrevia, total:materias.length, offset:offsetIndex }) + '\n\n');

  // um item do cache é bom se foi processado sem erro
  function itemBom(item) {
    return item && item.ok !== false && item.processadoOk === true;
  }

  const ehLixoGlobal = (t) => ehEventoEscolar(t) || /enviar por e-?mail|postar no blog|compartilhar (no|com)|marcadores|postagens? (mais|recente)|^in[ií]cio$|assinar|reações|pinterest|facebook|twitter|^x$/i.test((t||'').trim());

  // estado atual do cache deste dia (pode estar parcial)
  const cacheDia = Array.isArray(cache[chave]) ? cache[chave] : null;

  // se TODAS as matérias já estão boas no cache, entrega tudo instantâneo
  if (cacheDia && materias.every((_, i) => itemBom(cacheDia[i]))) {
    materias.forEach((_, i) => {
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:cacheDia[i], ehPrevia, cached:true }) + '\n\n');
    });
    return offsetIndex + materias.length;
  }

  // avisa o frontend que todas estão carregando
  materias.forEach((item, i) => {
    res.write('data: ' + JSON.stringify({ type:'loading', index:offsetIndex+i, materia:item.m, ehPrevia }) + '\n\n');
  });

  // processa uma matéria. O blog é buscado UMA vez (já tenta direto + proxies internamente).
  // Só a chamada de IA tem retry, porque o gargalo lento (fetch com proxies) não deve ser
  // multiplicado pelas tentativas — isso travava o app inteiro.
  async function processarMateria(item) {
    // matéria COMBINADA (ex: "Redação e Literatura" na sexta): processa cada sub-matéria
    // e devolve um resultado com seções separadas, exibidas no mesmo card.
    if (Array.isArray(item.combinar)) {
      const secoes = [];
      for (const sub of item.combinar) {
        try {
          const r = await processarMateria(sub); // reaproveita a lógica normal
          secoes.push({ materia: sub.m, dados: r });
        } catch (e) {
          secoes.push({ materia: sub.m, dados: { ok:false, aula_hoje:'—', materia_teste:'', deveres_pendentes:[], deveres_aula:[] } });
        }
      }
      return Object.assign({}, item, { ok:true, processadoOk:true, combinada:true, secoes,
        aula_hoje:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'', questoes:[] });
    }
    let ultimoErro = '';
    // 1) busca o blog uma vez só
    const blogText = await fetchBlog(item.url);
    if (!blogText || blogText.length < 30) {
      // blog indisponível (ex: Blogspot bloqueando). Não trava: retorna com aviso.
      return Object.assign({}, item, { ok:false, processadoOk:false, aula_hoje:'—', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'Não foi possível carregar o blog desta matéria agora. Recarregue em alguns instantes.', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
    }
    // 2) processa com IA, com até 3 tentativas (resiliente a falhas momentâneas da IA)
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const ai = await processWithAI(item.m, item.p, blogText, item.filtro, dataRef, labelDia, item.tipo, item.maxDeveres, item.maxDiasDever, item.formato, item.ignorarAvaliacao, item.testeAulaAnterior, item.testeMarcado);
        if (Array.isArray(ai.deveres_pendentes)) {
          const limite = (item.maxDeveres && item.maxDeveres > 0) ? item.maxDeveres : 2;
          ai.deveres_pendentes = ai.deveres_pendentes
            .map(g => ({ data: g.data, deveres: (g.deveres || []).filter(d => d && d.trim().length > 0 && !ehLixoGlobal(d)) }))
            .filter(g => g.deveres.length > 0)
            .slice(0, limite);
        }
        if (Array.isArray(ai.deveres_aula)) {
          ai.deveres_aula = ai.deveres_aula.filter(d => d && d.trim().length > 0 && !ehLixoGlobal(d));
        } else {
          ai.deveres_aula = [];
        }
        // dever fixo do bimestre (ex: química do Maurélio: "TC da Frente A" o bimestre todo)
        if (item.deverFixo) {
          const ehDeverFixo = (d) => /tarefas?\s+do\s+\d?\s*bimestre|todas?\s+as?\s+tc\s+da\s+frente/i.test(d);
          // remove qualquer versão que a IA já tenha extraído, de AMBAS as listas (evita duplicar)
          ai.deveres_aula = ai.deveres_aula.filter(d => !ehDeverFixo(d));
          if (Array.isArray(ai.deveres_pendentes)) {
            ai.deveres_pendentes = ai.deveres_pendentes
              .map(g => ({ data: g.data, deveres: (g.deveres || []).filter(d => !ehDeverFixo(d)) }))
              .filter(g => g.deveres.length > 0);
          }
          // descobre a apostila ATUAL: a de maior número mencionada no blog.
          // o professor marca "INÍCIO DA APOSTILA N" quando começa um novo bimestre.
          const apostilas = [...(blogText || '').matchAll(/apostila\s+(\d+)/gi)].map(m => parseInt(m[1],10));
          const apostilaAtual = apostilas.length ? Math.max(...apostilas) : 0;
          // só mostra o dever fixo (em deveres desta aula) enquanto estamos na apostila 2
          if (apostilaAtual === 2) {
            ai.deveres_aula.unshift(item.deverFixo);
          }
        }
        return Object.assign({}, item, ai, { ok: true, processadoOk: true });
      } catch(e) {
        ultimoErro = e.message;
        // espera um pouco antes de tentar de novo (dá tempo da API se recuperar)
        if (tentativa < 3) await new Promise(r => setTimeout(r, 800 * tentativa));
      }
    }
    // falhou nas 3 tentativas
    return Object.assign({}, item, { ok:false, processadoOk:false, aula_hoje:'—', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'Não foi possível carregar agora. Recarregue a página em alguns segundos.', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
  }

  // processa as matérias em PARALELO, mas em lotes de no máximo 3 ao mesmo tempo.
  // Isso é bem mais rápido que uma-por-vez (antes), sem sobrecarregar a IA (o que
  // causava falhas em cascata quando todas rodavam juntas).
  // Matérias que JÁ estão boas no cache são servidas direto (não reprocessam).
  const resultados = new Array(materias.length);
  const LOTE = 2; // matérias simultâneas (2 é seguro p/ não sobrecarregar proxies públicos)

  // primeiro, serve as que já estão boas no cache (instantâneo)
  const aProcessar = [];
  for (let i = 0; i < materias.length; i++) {
    if (cacheDia && itemBom(cacheDia[i])) {
      resultados[i] = cacheDia[i];
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:cacheDia[i], ehPrevia, cached:true }) + '\n\n');
    } else {
      aProcessar.push(i); // precisa processar
    }
  }

  // processa as que faltam, em lotes de LOTE por vez
  for (let inicio = 0; inicio < aProcessar.length; inicio += LOTE) {
    const lote = aProcessar.slice(inicio, inicio + LOTE);
    await Promise.all(lote.map(async (i) => {
      const result = await processarMateria(materias[i]);
      resultados[i] = result;
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:result, ehPrevia }) + '\n\n');
      // salva cada matéria bem-sucedida no cache imediatamente (incremental)
      if (result && result.processadoOk === true) {
        if (!Array.isArray(cache[chave])) cache[chave] = new Array(materias.length);
        cache[chave][i] = result;
        salvarCache();
      }
    }));
  }
  return offsetIndex + materias.length;
}

// ── aluno envia um report de erro ────────────────────────────────────────────
// ── gera o simulado (4 questões) sob demanda, quando o aluno clica ───────────
// economiza tokens: só gera quando o aluno realmente quer revisar
// ── gera o RESUMO da matéria do teste sob demanda (quando o aluno abre a matéria) ──
app.post('/api/resumo', auth, async (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60);
  const assunto = (req.body.assunto || '').slice(0, 300);
  if (!assunto) return res.json({ resumo: '' });
  try {
    const prompt = 'Você é um tutor de ' + materia + ' do ensino médio brasileiro. ' +
      'O aluno tem um teste sobre: "' + assunto + '".\n' +
      'Faça um RESUMO didático de 3-4 parágrafos sobre esse conteúdo, claro e objetivo para revisão.\n' +
      'Responda APENAS JSON sem markdown:\n{"resumo":"texto"}';
    const r = await callAnthropic(prompt, 0);
    res.json({ resumo: r.resumo || '' });
  } catch (e) {
    res.json({ resumo: '' });
  }
});

app.post('/api/simulado', auth, async (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60);
  const materiaTeste = (req.body.materiaTeste || '').slice(0, 300);
  if (!materiaTeste) return res.json({ questoes: [] });
  try {
    const prompt = 'Você é um tutor de ' + materia + ' do ensino médio brasileiro. ' +
      'Crie um simulado sobre: "' + materiaTeste + '".\n' +
      '4 questões de múltipla escolha (A-D), com a resposta correta e uma explicação curta.\n' +
      'Responda APENAS JSON sem markdown:\n' +
      '{"questoes":[{"enunciado":"","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":""}]}';
    const r = await callAnthropic(prompt, 0);
    res.json({ questoes: Array.isArray(r.questoes) ? r.questoes : [] });
  } catch (e) {
    res.json({ questoes: [] });
  }
});

app.post('/api/reportar', auth, (req, res) => {
  const { mensagem, contexto } = req.body;
  if (!mensagem || !mensagem.trim()) return res.json({ error: 'Mensagem vazia' });
  if (mensagem.length > 1000) return res.json({ error: 'Mensagem muito longa' });
  const report = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    user: req.user,
    mensagem: mensagem.trim().slice(0, 1000),
    contexto: (contexto || '').slice(0, 200), // matéria/dia que o aluno estava vendo
    data: new Date().toISOString(),
    resolvido: false
  };
  reports.unshift(report); // mais recente primeiro
  if (reports.length > 200) reports = reports.slice(0, 200); // limita acúmulo
  salvarReports();
  res.json({ ok: true });
});

// ── admin lista os reports ───────────────────────────────────────────────────
app.get('/api/admin/reports', checkAdmin, (req, res) => {
  res.json({
    reports,
    pendentes: reports.filter(r => !r.resolvido).length
  });
});

// ── admin marca um report como resolvido ─────────────────────────────────────
app.post('/api/admin/resolver-report', checkAdmin, (req, res) => {
  const { id } = req.body;
  const r = reports.find(x => x.id === id);
  if (!r) return res.json({ error: 'Report não encontrado' });
  r.resolvido = !r.resolvido; // alterna (permite reabrir)
  salvarReports();
  res.json({ ok: true });
});

// ── admin apaga um report ────────────────────────────────────────────────────
app.post('/api/admin/apagar-report', checkAdmin, (req, res) => {
  const { id } = req.body;
  reports = reports.filter(x => x.id !== id);
  salvarReports();
  res.json({ ok: true });
});

app.get('/api/today', auth, async function(req, res) {
  const dayMap = { 1:'seg', 2:'ter', 3:'qua', 4:'qui', 5:'sex' };
  const ordem = ['seg','ter','qua','qui','sex'];
  const hojeDay = new Date().getDay();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // define o dia principal e o dia da prévia
  let diaPrincipal, diaPrevia;
  if (hojeDay >= 1 && hojeDay <= 5) {
    // dia de semana: hoje + amanhã (se amanhã for dia letivo)
    diaPrincipal = dayMap[hojeDay];
    const idx = ordem.indexOf(diaPrincipal);
    diaPrevia = idx < 4 ? ordem[idx+1] : null; // sexta não tem prévia (sábado não tem aula)
  } else {
    // fim de semana (sábado=6, domingo=0): mostra segunda como prévia, sem dia principal
    diaPrincipal = null;
    diaPrevia = 'seg';
  }

  // calcula o total de matérias para o front montar os placeholders
  const totalMaterias = (diaPrincipal ? GRADE[diaPrincipal].length : 0) + (diaPrevia ? GRADE[diaPrevia].length : 0);

  res.write('data: ' + JSON.stringify({ type:'start', fimDeSemana: !diaPrincipal, dayLabel: diaPrincipal ? DIAS_PT[diaPrincipal] : 'Prévia de segunda', total: totalMaterias }) + '\n\n');

  let offset = 0;
  if (diaPrincipal) {
    offset = await processarDia(res, diaPrincipal, false, offset);
  }
  if (diaPrevia) {
    offset = await processarDia(res, diaPrevia, true, offset);
  }

  // limpa caches de dias muito antigos (mantém os de hoje)
  const hojeISO = new Date().toISOString().slice(0,10);
  Object.keys(cache).forEach(k => {
    if (!k.startsWith(hojeISO)) delete cache[k];
  });
  salvarCache();

  res.write('data: ' + JSON.stringify({ type:'done' }) + '\n\n');
  res.end();
});

// ── página do painel admin ───────────────────────────────────────────────────
// teste da chamada de IA isolada: mostra se a API da Anthropic responde no Railway.
// uso: /api/testar-ia?senha=ADMIN_SENHA
app.get('/api/testar-ia', async (req, res) => {
  if (req.query.senha !== process.env.ADMIN_SENHA) return res.status(401).json({ error: 'senha' });
  const inicio = Date.now();
  const key = process.env.ANTHROPIC_API_KEY || '';
  const temKey = !!key;
  const tamanhoKey = key.length;
  // checa se a chave tem espaços/quebras invisíveis (causa comum de erro de auth)
  const keyTemEspaco = /\s/.test(key);
  const keyComeca = key.slice(0, 7); // ex: "sk-ant-" (não expõe a chave toda)
  // faz a chamada CRUA à API, capturando status e corpo, para diagnóstico completo
  let diagBruto = {};
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key.trim(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role:'user', content:'diga: ok' }] }),
      signal: AbortSignal.timeout(20000)
    });
    const corpo = await r.json();
    diagBruto = { status: r.status, corpo };
  } catch (e) {
    diagBruto = { erroFetch: e.message };
  }
  res.json({ temKey, tamanhoKey, keyTemEspaco, keyComeca, ms: Date.now()-inicio, apiBruta: diagBruto });
});

// ── rota de diagnóstico: mostra o que a IA extrai de um blog ─────────────────
app.get('/api/testar-fetch', async (req, res) => {
  if (req.query.senha !== process.env.ADMIN_SENHA) return res.status(401).json({ error: 'senha' });
  const url = req.query.url || 'https://profsauloanglo.blogspot.com/p/mat-b.html';
  const resultado = { url, estrategias: [] };
  const headersNavegador = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };
  const testes = [
    ['direto', url, { headers: headersNavegador }],
    ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {}],
    ['corsproxy', 'https://corsproxy.io/?url=' + encodeURIComponent(url), { headers: headersNavegador }]
  ];
  for (const [nome, u, opts] of testes) {
    const t0 = Date.now();
    try {
      const r = await fetch(u, Object.assign({ signal: AbortSignal.timeout(12000) }, opts));
      const txt = await r.text();
      resultado.estrategias.push({ nome, status: r.status, tamanho: txt.length, ms: Date.now()-t0, ok: r.ok && txt.length > 400 });
    } catch (e) {
      resultado.estrategias.push({ nome, erro: e.message, ms: Date.now()-t0 });
    }
  }
  res.json(resultado);
});

app.get('/api/diag', async (req, res) => {
  if (!senhaIgual(req.query.senha || '', process.env.ADMIN_SENHA)) {
    return res.status(401).json({ error: 'senha invalida' });
  }
  const nomeMateria = req.query.materia;
  const nomeProf = (req.query.prof || '').toLowerCase();
  let alvo = null;
  let diaDaMateria = 'seg';
  for (const dia of Object.keys(GRADE)) {
    const m = GRADE[dia].find(x => {
      const materiaBate = x.m.toLowerCase() === (nomeMateria||'').toLowerCase();
      const profBate = !nomeProf || (x.p||'').toLowerCase().includes(nomeProf);
      return materiaBate && profBate;
    });
    if (m) { alvo = m; diaDaMateria = dia; break; }
  }
  if (!alvo) return res.json({ error: 'matéria não encontrada', dica: 'use &prof=sobrenome para diferenciar professores', materias: [...new Set(Object.values(GRADE).flat().map(x=>x.m + ' (' + x.p + ')'))] });

  const blogText = await fetchBlog(alvo.url);
  const ref = req.query.ref || dataDoDia(diaDaMateria);

  // mostra também o que a IA extraiu (etapa intermediária) para rotulado
  let etapaExtracao = null;
  if (alvo.formato === 'rotulado') {
    try {
      const temConteudo = blogText && blogText.length > 50;
      const promptDiag = 'Extraia as aulas deste registro de ' + alvo.m + '. Cada aula tem rótulos (CONTEÚDO/MATÉRIA, TAREFA, DATA). A data está como "DATA: DD/MM".\nResponda APENAS JSON: {"linhas":[{"data":"DD/MM","materia":"","deveres":[]}]}\n\nREGISTRO:\n' + (blogText||'');
      etapaExtracao = await callAnthropic(promptDiag, 0);
    } catch(e) { etapaExtracao = { erro: e.message }; }
  }

  let resultadoFinal;
  try {
    resultadoFinal = await processWithAI(alvo.m, alvo.p, blogText, alvo.filtro, ref, 'Hoje', alvo.tipo, alvo.maxDeveres, alvo.maxDiasDever, alvo.formato, alvo.ignorarAvaliacao, alvo.testeAulaAnterior, alvo.testeMarcado);
  } catch(e) { resultadoFinal = { erro: e.message, stack: (e.stack||'').slice(0,300) }; }

  // inspeciona o CACHE: mostra todas as chaves e se mat A/B estão lá (e com que conteúdo)
  const chavesCache = Object.keys(cache);
  const cacheRelacionado = {};
  for (const ch of chavesCache) {
    const lista = cache[ch];
    if (Array.isArray(lista)) {
      const achou = lista.find(it => it && it.m && it.m.toLowerCase() === (nomeMateria||'').toLowerCase());
      if (achou) {
        cacheRelacionado[ch] = {
          processadoOk: achou.processadoOk,
          ok: achou.ok,
          temAula: !!(achou.aula_hoje && achou.aula_hoje.trim().length>1),
          qtdDeveresPend: (achou.deveres_pendentes||[]).length,
          qtdDeveresAula: (achou.deveres_aula||[]).length,
          materia_teste: achou.materia_teste
        };
      }
    }
  }

  res.json({
    materia: alvo.m,
    tipo: alvo.tipo || 'normal',
    formato: alvo.formato || 'tabela',
    diaDaMateria,
    dataReferencia: ref,
    url: alvo.url,
    blogVazio: !blogText || blogText.length < 50,
    tamanhoBlog: (blogText||'').length,
    ETAPA_EXTRACAO_IA: etapaExtracao ? { qtdLinhas: (etapaExtracao.linhas||[]).length, primeiras3: (etapaExtracao.linhas||[]).slice(0,3), erro: etapaExtracao.erro } : 'N/A',
    METODO_DE_BUSCA: ultimaEstrategia || '(nao buscou)',
    TEXTO_DO_BLOG: (blogText||'(vazio)').slice(-2800),
    RESULTADO_FINAL: {
      aula_hoje: resultadoFinal.aula_hoje,
      deveres_pendentes: resultadoFinal.deveres_pendentes,
      deveres_aula: resultadoFinal.deveres_aula,
      materia_teste: resultadoFinal.materia_teste,
      erro: resultadoFinal.erro
    },
    CACHE_VERSAO: CACHE_VERSAO,
    CACHE_DESTA_MATERIA: cacheRelacionado,
    TOTAL_CHAVES_CACHE: chavesCache.length
  });
});

// ── limpa todo o cache manualmente (forçar reprocessamento) ──────────────────
// uso: /api/limpar-cache?senha=ADMIN_SENHA
app.get('/api/limpar-cache', (req, res) => {
  if (!senhaIgual(req.query.senha || '', process.env.ADMIN_SENHA)) {
    return res.status(401).json({ error: 'senha invalida' });
  }
  const qtd = Object.keys(cache).length;
  for (const k of Object.keys(cache)) delete cache[k];
  salvarCache();
  res.json({ ok: true, chavesRemovidas: qtd, mensagem: 'Cache limpo. Recarregue o app para reprocessar.' });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── serve arquivos estáticos só depois das rotas de API ──────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
