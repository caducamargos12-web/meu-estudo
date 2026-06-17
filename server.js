const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

app.use(express.json());

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
    { m:'Geografia',      p:'Gabriel Fonseca', url:'https://profgabrielcnsanglo.blogspot.com/p/3-ano-geografia.html' },
    { m:'Prog. Lidere',   p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-lidere.html', tipo:'soDever' },
  ],
  ter: [
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'História', tipo:'acumulativo' },
    { m:'Química A',      p:'Washington Gois', url:'https://profwashingtonanglo.blogspot.com/p/3-ano.html' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
  qua: [
    { m:'Linguística',    p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-gramatica.html' },
    { m:'Matemática A',   p:'Tiago Santos',    url:'https://professoratiagocnsanglo.blogspot.com/p/3-ano-em-matematica-a_27.html' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulado' },
    { m:'Inglês',         p:'Jully Alvim',     url:'https://profjullycnsanglo.blogspot.com/p/3ano-em.html', tipo:'provaFinal', maxDiasDever:14 },
  ],
  qui: [
    { m:'Biologia',       p:'Angelita Pimenta',url:'https://profangelitacnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulado' },
    { m:'Química B',      p:'Maurélio',        url:'https://maureliopereiral.blogspot.com/p/3-ano.html' },
    { m:'Redação',        p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal' },
  ],
  sex: [
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Literatura',     p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Literatura' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
};
const DIAS_PT = { seg:'Segunda', ter:'Terça', qua:'Quarta', qui:'Quinta', sex:'Sexta' };
const MODELS = ['claude-haiku-4-5-20251001','claude-sonnet-4-6','claude-sonnet-4-5-20250929','claude-opus-4-8'];

// ════════════════════════════════════════════════════════════════════════════
// CACHE DE 24H — processa cada matéria 1x por dia, salva em disco
// ════════════════════════════════════════════════════════════════════════════
const CACHE_VERSAO = 'v23';
const CACHE_FILE = DATA_DIR + '/cache_estudo.json';
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
// limpa do disco qualquer cache que não seja da versão atual (evita servir dados velhos após deploy)
(function limparCacheAntigo(){
  let mudou = false;
  Object.keys(cache).forEach(k => {
    if (!k.endsWith('_' + CACHE_VERSAO)) { delete cache[k]; mudou = true; }
  });
  if (mudou) {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); console.log('Cache antigo limpo (versão != ' + CACHE_VERSAO + ').'); } catch {}
  }
})();
function salvarCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
}
// versão do cache: mudar este número invalida todo o cache antigo no próximo deploy
function chaveCacheHoje(dayKey) {
  const d = new Date();
  const dia = d.toISOString().slice(0,10); // AAAA-MM-DD
  return `${dia}_${dayKey}_${CACHE_VERSAO}`;
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
    return texto.length > 14000 ? texto.slice(texto.length - 14000) : texto;
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

// detecta textos que são eventos/atividades da escola, NÃO matéria nem dever
// (ex: copaanglo, gincana, olimpíadas, feira, festa junina, simulado de evento)
function ehEventoEscolar(texto) {
  const t = (texto || '').toLowerCase();
  return /copa\s*anglo|copaanglo|gincana|olimp[ií]ada|festa\s*junina|feira\s*de|feira\s*cultural|festival|interclasse|recesso|feriado|reuni[ãa]o de pais|conselho de classe|sábado letivo|s[áa]bado letivo|semana de avalia|jogos? (internos|escolares)|excurs[ãa]o|passeio|formatura|ensaio/i.test(t);
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

  // gera um resumo pequeno de cada matéria que sobrou (uma chamada só, para economizar)
  let materiasComResumo = [];
  if (sobraram.length > 0) {
    const lista = sobraram.map((m,i) => (i+1) + '. ' + m.materia).join('\n');
    const promptResumos = 'Para cada matéria de História abaixo, escreva um resumo MUITO curto (1-2 frases) do que se trata, para revisão de teste.\n\nMATÉRIAS:\n' + lista +
      '\n\nResponda APENAS JSON sem markdown: {"resumos":[{"materia":"nome exato como veio","resumo":"1-2 frases"}]}';
    try {
      const r = await callAnthropic(promptResumos, 0);
      const mapa = {};
      (r.resumos || []).forEach(x => { if (x.materia) mapa[x.materia.toLowerCase().trim()] = x.resumo; });
      materiasComResumo = sobraram.map(m => ({
        data: (m.data||'').slice(0,5),
        materia: m.materia,
        resumo: mapa[m.materia.toLowerCase().trim()] || ''
      }));
    } catch (e) {
      materiasComResumo = sobraram.map(m => ({ data:(m.data||'').slice(0,5), materia:m.materia, resumo:'' }));
    }
  }

  const aula_hoje = (dados.aula_hoje && dados.aula_hoje.trim().length > 1) ? dados.aula_hoje.trim() : '';

  return {
    aula_hoje,
    aula_data: aula_hoje ? refDDMM : '',
    deveres_pendentes, deveres_aula,
    // campos específicos de história
    historia: true,
    materias_teste: materiasComResumo, // lista das que podem cair, com resumo
    // campos padrão zerados (história não usa o bloco de teste comum)
    tem_avaliacao: false, materia_teste: '', materia_teste_data: '',
    resumo: '', questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

async function processWithAI(materia, professor, blogText, filtro, dataRef, labelDia, tipo, maxDeveres, maxDiasDever, formato) {
  // história tem lógica acumulativa própria
  if (tipo === 'acumulativo') {
    return processarHistoria(materia, professor, blogText, filtro, dataRef);
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
    '\n- "deveres": TODOS os deveres daquela data (última coluna). Se for "—" ou vazio, use []. Liste cada dever como um item separado.' +
    '\n\nIGNORE textos de navegação do Blogspot (Enviar por e-mail, Postar no blog, Compartilhar, Marcadores, Início, Assinar, Comentários, Reações). Nunca os inclua.' +
    '\nIGNORE TAMBÉM eventos e atividades da escola que NÃO são matéria nem dever: CopaAnglo, gincana, olimpíadas, feira cultural, festa junina, festival, interclasse, recesso, feriado, sábado letivo, semana de avaliações, ensaios, excursões, formatura. Esses NUNCA são deveres nem conteúdo de aula.' +
    '\nNÃO invente linhas nem datas. Extraia só o que está escrito.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown, no formato:' +
    '\n{"linhas":[{"data":"DD/MM","materia":"texto ou vazio","deveres":["dever1"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}' +
    '\nNo campo "avaliacao": "tem"=true só se o registro mencionar explicitamente TESTE/PROVA/AVALIAÇÃO/SIMULADO com data; "data"=quando; "sobre"=o conteúdo que cai.';

  // formato "rotulado": blogs que usam etiquetas (MÓDULO:, MATÉRIA:, TAREFA:, DATA:)
  // com a DATA no FIM da linha, em vez de tabela com colunas. Ex: prof. de Matemática B.
  const promptRotulado = 'Você extrai dados de um registro de aulas de ' + materia + ', professor ' + professor + '.' + instrucaoFiltro +
    '\n\n*** FORMATO DESTE REGISTRO ***' +
    '\nCada aula é uma linha com CAMPOS ROTULADOS. A DATA aparece com "DATA: DD/MM/AAAA" (geralmente no FIM da linha, não no começo).' +
    '\nOs rótulos comuns são: "MÓDULO:", "MATÉRIA:", "PAG.:" (páginas), "TAREFA:" (o dever), "DATA:" (a data da aula).' +
    '\nExemplo de linha: "MÓDULO: 3 MATÉRIA: PORCENTAGEM PAG.: 161, 162 E 163 - EXERCÍCIOS 3 E 4 TAREFA: TC DAS AULAS 1, 2, 3, 4 E 5 (PARA DIA 18/03) DATA: 16/03/2026"' +
    '\nNessa linha: data=16/03, materia="Módulo 3 - Porcentagem (pág. 161-163)", dever="TC das aulas 1,2,3,4 e 5 (para dia 18/03)".' +
    '\n\n*** O QUE EXTRAIR ***' +
    '\nPara CADA aula (cada bloco que tenha "DATA:"):' +
    '\n- "data": o valor após "DATA:" no formato DD/MM.' +
    '\n- "materia": junte MÓDULO + MATÉRIA + PAG. num texto curto (ex: "Módulo 3 - Porcentagem (pág. 161-163)").' +
    '\n- "deveres": o que vem após "TAREFA:". Esse é o DEVER do aluno. Inclua o "(PARA DIA XX/XX)" se houver. Se a tarefa for "*" ou vazia, use [].' +
    '\n\nIGNORE rodapé do Blogspot (Postagens, Páginas, perfil, "Ver meu perfil", nome do professor solto, Atom, novembro, etc.) e eventos da escola (CopaAnglo, gincana, festa junina, etc.).' +
    '\nNÃO invente. Extraia só o que está escrito. Cada dever pertence à data da SUA própria linha.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"linhas":[{"data":"DD/MM","materia":"texto","deveres":["tarefa"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}';

  const promptEscolhido = (formato === 'rotulado') ? promptRotulado : promptTabela;

  let tabela;
  try {
    const raw = await callAnthropic(promptEscolhido, 0);
    tabela = (raw && Array.isArray(raw.linhas)) ? raw : { linhas: [], avaliacao:{tem:false} };
  } catch (e) {
    tabela = { linhas: [], avaliacao:{tem:false} };
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
  // 1. AULA DO DIA: só a linha com data EXATAMENTE igual à referência E que tenha matéria
  const linhaRef = linhas.find(l => l.data.slice(0,5) === refDDMM);
  const aula_hoje = (linhaRef && linhaRef.materia) ? linhaRef.materia : '';

  // 2. DEVERES DESTA AULA: deveres da linha de referência
  const deveres_aula = linhaRef ? linhaRef.deveres : [];

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

  // 4. MATÉRIA DO TESTE: a aula COM matéria imediatamente anterior à referência
  const aulasAnteriores = linhas
    .filter(l => l.num < refNum && l.materia)
    .sort((a,b) => b.num - a.num);
  const linhaTeste = aulasAnteriores[0] || null;

  // decide se mostra teste conforme o tipo
  let tem_avaliacao, materia_teste, materia_teste_data;
  if (tipo === 'soDever') {
    tem_avaliacao = false; materia_teste = ''; materia_teste_data = '';
  } else if (tipo === 'provaFinal') {
    // só mostra teste se houver avaliação com DATA marcada PRÓXIMA da referência.
    // Isso evita ativar por textos genéricos antigos ("estudar para atividade avaliativa").
    let avalValida = false;
    let avalData = '';
    if (tabela.avaliacao && tabela.avaliacao.tem && tabela.avaliacao.data) {
      const avalNum = dataParaNum(tabela.avaliacao.data);
      if (avalNum > 0) {
        const diff = avalNum - refNum; // diferença em "AAAAMMDD" (aprox dias dentro do mês)
        // janela: avaliação de até ~10 dias à frente ou ~5 dias atrás da referência
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
    // matéria normal: teste semanal sempre
    tem_avaliacao = true;
    materia_teste = linhaTeste ? linhaTeste.materia : '';
    materia_teste_data = linhaTeste ? linhaTeste.data.slice(0,5) : '';
  }

  // ETAPA 2: gera resumo + questões só se houver matéria de teste (e a matéria usa teste)
  let resumo = '', questoes = [];
  const precisaResumo = (tipo !== 'soDever') && tem_avaliacao && materia_teste;
  if (precisaResumo) {
    const promptResumo = 'Você é um tutor de ' + materia + ' do ensino médio brasileiro. ' +
      'O aluno tem um teste sobre: "' + materia_teste + '".\n' +
      'Faça:\n1. RESUMO didático de 3-4 parágrafos sobre esse conteúdo, claro e objetivo para revisão.\n' +
      '2. QUESTÕES: 4 questões de múltipla escolha (A-D) sobre o conteúdo, com a resposta correta e explicação.\n' +
      '\nResponda APENAS JSON sem markdown:\n' +
      '{"resumo":"texto","questoes":[{"enunciado":"","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":""}]}';
    try {
      const r = await callAnthropic(promptResumo, 0);
      resumo = r.resumo || '';
      questoes = Array.isArray(r.questoes) ? r.questoes : [];
    } catch (e) { resumo = ''; questoes = []; }
  } else if (tipo !== 'soDever') {
    // sem avaliação: um resumo curto da aula do dia, se houver
    if (aula_hoje) {
      try {
        const r = await callAnthropic('Resuma em 2-3 frases, de forma didática, o conteúdo desta aula de ' + materia + ': "' + aula_hoje + '". Responda APENAS JSON: {"resumo":"texto"}', 0);
        resumo = r.resumo || '';
      } catch(e){ resumo=''; }
    }
  }

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

  // cache pronto: entrega instantâneo
  if (cache[chave]) {
    cache[chave].forEach((item, i) => {
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item, ehPrevia, cached:true }) + '\n\n');
    });
    return offsetIndex + materias.length;
  }

  // sem cache: processa e salva
  const resultados = [];
  for (let i = 0; i < materias.length; i++) {
    const item = materias[i];
    res.write('data: ' + JSON.stringify({ type:'loading', index:offsetIndex+i, materia:item.m, ehPrevia }) + '\n\n');
    const blogText = await fetchBlog(item.url);
    try {
      const ai = await processWithAI(item.m, item.p, blogText, item.filtro, dataRef, labelDia, item.tipo, item.maxDeveres, item.maxDiasDever, item.formato);
      // termos de botões de compartilhar do Blogspot que não são deveres
      const ehLixo = (t) => ehEventoEscolar(t) || /enviar por e-?mail|postar no blog|compartilhar (no|com)|marcadores|postagens? (mais|recente)|^in[ií]cio$|assinar|reações|pinterest|facebook|twitter|^x$/i.test((t||'').trim());
      // remove grupos de deveres pendentes que estão vazios (data sem nenhum dever)
      if (Array.isArray(ai.deveres_pendentes)) {
        const limite = (item.maxDeveres && item.maxDeveres > 0) ? item.maxDeveres : 2;
        ai.deveres_pendentes = ai.deveres_pendentes
          .map(g => ({ data: g.data, deveres: (g.deveres || []).filter(d => d && d.trim().length > 0 && !ehLixo(d)) }))
          .filter(g => g.deveres.length > 0)
          .slice(0, limite);
      }
      // remove deveres desta aula vazios ou que sejam botões de compartilhar
      if (Array.isArray(ai.deveres_aula)) {
        ai.deveres_aula = ai.deveres_aula.filter(d => d && d.trim().length > 0 && !ehLixo(d));
      }
      const result = Object.assign({}, item, ai, { ok: true });
      resultados.push(result);
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:result, ehPrevia }) + '\n\n');
    } catch(e) {
      const result = Object.assign({}, item, { ok:false, aula_hoje:'—', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'Erro: '+e.message, questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
      resultados.push(result);
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:result, ehPrevia }) + '\n\n');
    }
  }
  cache[chave] = resultados;
  salvarCache();
  return offsetIndex + materias.length;
}

// ── aluno envia um report de erro ────────────────────────────────────────────
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
// ── rota de diagnóstico: mostra o que a IA extrai de um blog ─────────────────
// uso: /api/diag?senha=ADMIN_SENHA&materia=Matemática A
app.get('/api/diag', async (req, res) => {
  if (!senhaIgual(req.query.senha || '', process.env.ADMIN_SENHA)) {
    return res.status(401).json({ error: 'senha invalida' });
  }
  const nomeMateria = req.query.materia;
  let alvo = null;
  for (const dia of Object.keys(GRADE)) {
    const m = GRADE[dia].find(x => x.m.toLowerCase() === (nomeMateria||'').toLowerCase());
    if (m) { alvo = m; break; }
  }
  if (!alvo) return res.json({ error: 'matéria não encontrada', materias: [...new Set(Object.values(GRADE).flat().map(x=>x.m))] });

  const blogText = await fetchBlog(alvo.url);
  const ref = req.query.ref || dataDoDia('seg');
  let resultadoFinal;
  try {
    resultadoFinal = await processWithAI(alvo.m, alvo.p, blogText, alvo.filtro, ref, 'Segunda', alvo.tipo, alvo.maxDeveres, alvo.maxDiasDever, alvo.formato);
  } catch(e) { resultadoFinal = { erro: e.message }; }

  res.json({
    materia: alvo.m,
    tipo: alvo.tipo || 'normal',
    url: alvo.url,
    blogVazio: !blogText || blogText.length < 50,
    tamanhoBlog: (blogText||'').length,
    textoDoBlog: (blogText||'(VAZIO - não conseguiu ler o blog)').slice(-2500),
    RESULTADO_FINAL: {
      aula_hoje: resultadoFinal.aula_hoje,
      deveres_pendentes: resultadoFinal.deveres_pendentes,
      deveres_aula: resultadoFinal.deveres_aula,
      materia_teste: resultadoFinal.materia_teste
    }
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── serve arquivos estáticos só depois das rotas de API ──────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
