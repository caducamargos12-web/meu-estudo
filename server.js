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
  // força o navegador a só acessar via HTTPS por 1 ano (evita downgrade para HTTP).
  // O Railway já serve HTTPS, então isso apenas reforça no navegador.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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

// ── log de segurança ────────────────────────────────────────────────────────
// registra eventos relevantes (logins, falhas, ações admin, rate limit) num arquivo
// no volume persistente. Serve para investigar se alguém tentar invadir. Guarda os
// últimos ~2000 eventos (rotaciona para não crescer sem limite).
const LOG_SEG_FILE = DATA_DIR + '/seguranca.log';
function logSeguranca(evento, detalhes) {
  try {
    const linha = JSON.stringify({ t: new Date().toISOString(), evento, ...detalhes }) + '\n';
    fs.appendFileSync(LOG_SEG_FILE, linha);
    // rotação simples: se passar de ~500KB, mantém só a metade final
    const stat = fs.statSync(LOG_SEG_FILE);
    if (stat.size > 512 * 1024) {
      const conteudo = fs.readFileSync(LOG_SEG_FILE, 'utf8').split('\n');
      fs.writeFileSync(LOG_SEG_FILE, conteudo.slice(Math.floor(conteudo.length / 2)).join('\n'));
    }
  } catch {}
}

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

// SOBRESCRITAS MANUAIS (plano de contingência): se um blog de professor quebrar ou sair
// do ar perto de uma prova, o admin pode digitar o conteúdo manualmente pelo painel. A
// sobrescrita vale por matéria+dia e tem prioridade sobre a leitura do blog (e nem chama
// a IA). Vale até ser removida pelo admin. Chave: "materia|dia" (ex: "Física|sex").
let sobrescritas = {};
const SOBRESCRITAS_FILE = DATA_DIR + '/sobrescritas.json';
function carregarSobrescritas() {
  try { sobrescritas = JSON.parse(fs.readFileSync(SOBRESCRITAS_FILE, 'utf8')); } catch { sobrescritas = {}; }
}
function salvarSobrescritas() {
  try { fs.writeFileSync(SOBRESCRITAS_FILE, JSON.stringify(sobrescritas)); }
  catch (e) { console.log('Erro ao salvar sobrescritas:', e.message); }
}
function chaveSobrescrita(materia, dia) {
  return (materia + '|' + dia).toLowerCase().trim();
}
carregarSobrescritas();

// MIGRAÇÃO ÚNICA (troca dos rótulos das químicas: Gois virou Química B, Maurélio virou
// Química A). A contingência do Gois estava salva como "química a|ter" (terça = dia do Gois);
// como o Gois agora é Química B, a chave migra para "química b|ter". Distingue pelo DIA:
// terça = Gois (vira B), quinta = Maurélio (vira A). Roda uma vez; se já migrou, não faz nada.
(function migrarRotulosQuimica() {
  const MARCA = '__quimica_migrada_v1';
  if (sobrescritas[MARCA]) return; // já migrou
  let mudou = false;
  for (const chave of Object.keys(sobrescritas)) {
    const val = sobrescritas[chave];
    if (!val || typeof val !== 'object' || !val.dia) continue;
    const ehQuimicaA = /^química a\|/i.test(chave);
    const ehQuimicaB = /^química b\|/i.test(chave);
    // Gois (terça) estava como "Química A" -> vira "Química B"
    if (ehQuimicaA && val.dia === 'ter') {
      const nova = chaveSobrescrita('Química B', val.dia);
      val.materia = 'Química B';
      sobrescritas[nova] = val; delete sobrescritas[chave]; mudou = true;
    }
    // Maurélio (quinta) estava como "Química B" -> vira "Química A"
    else if (ehQuimicaB && val.dia === 'qui') {
      const nova = chaveSobrescrita('Química A', val.dia);
      val.materia = 'Química A';
      sobrescritas[nova] = val; delete sobrescritas[chave]; mudou = true;
    }
  }
  sobrescritas[MARCA] = true;
  if (mudou || true) { try { salvarSobrescritas(); console.log('Rótulos de química migrados.'); } catch {} }
})();

// MATERIAIS DE APOIO (links de arquivos por matéria): o admin adiciona links (PDF, Drive,
// etc.) com um texto explicativo, ligados a uma matéria. Aparecem dentro do card da matéria.
// Máximo 3 por matéria. Chave: nome da matéria em minúsculas. Persistido em disco.
let materiais = {};
const MATERIAIS_FILE = DATA_DIR + '/materiais.json';
function carregarMateriais() {
  try { materiais = JSON.parse(fs.readFileSync(MATERIAIS_FILE, 'utf8')); } catch { materiais = {}; }
}
function salvarMateriais() {
  try { fs.writeFileSync(MATERIAIS_FILE, JSON.stringify(materiais)); }
  catch (e) { console.log('Erro ao salvar materiais:', e.message); }
}
function chaveMaterial(materia) {
  return (materia || '').toLowerCase().trim();
}
carregarMateriais();

// JANELA DA AVALIAÇÃO FINAL DO BIMESTRE: o admin define a data de início (semana de RAA)
// e fim (fim da semana de provas). Dentro dessa janela, cada matéria mostra o bloco
// "Avaliação Final do Bimestre" com o conteúdo publicado no blog. Fora, o bloco não aparece.
let janelaAvaliacao = { inicio: '', fim: '' }; // datas ISO 'AAAA-MM-DD'
const JANELA_AVAL_FILE = DATA_DIR + '/janela_avaliacao.json';
function carregarJanelaAvaliacao() {
  try { janelaAvaliacao = JSON.parse(fs.readFileSync(JANELA_AVAL_FILE, 'utf8')); }
  catch { janelaAvaliacao = { inicio: '', fim: '' }; }
}
function salvarJanelaAvaliacao() {
  try { fs.writeFileSync(JANELA_AVAL_FILE, JSON.stringify(janelaAvaliacao)); }
  catch (e) { console.log('Erro ao salvar janela de avaliação:', e.message); }
}
// ── "hoje" efetivo, no fuso de Brasília, com virada às 22:30 ─────────────────
// O servidor pode rodar em qualquer fuso (o Railway usa UTC). Para NÃO depender disso,
// calculamos a hora de Brasília a partir do tempo absoluto (Date.now), deslocando -3h
// (Brasília = UTC-3, sem horário de verão desde 2019) e lendo os campos com getUTC*.
// A partir das 22:30 de Brasília, o app já considera o PRÓXIMO dia.
// Definido AQUI (antes da limpeza de cache do startup) para evitar zona morta do const.
const VIRADA_DIA_MIN = 22 * 60 + 30; // 22:30 (para mudar a hora da virada, mexa só aqui)
function agoraEfetivo() {
  const b = new Date(Date.now() - 3 * 3600 * 1000); // campos UTC de b = relógio de Brasília
  const minutos = b.getUTCHours() * 60 + b.getUTCMinutes();
  if (minutos >= VIRADA_DIA_MIN) b.setUTCDate(b.getUTCDate() + 1); // passou das 22:30 -> vira o dia
  return b;
}
// data efetiva em AAAA-MM-DD (para chaves de cache e janela do admin)
function isoEfetivo() {
  const b = agoraEfetivo();
  return b.getUTCFullYear() + '-' + ('0'+(b.getUTCMonth()+1)).slice(-2) + '-' + ('0'+b.getUTCDate()).slice(-2);
}

// diz se HOJE está dentro da janela configurada
function dentroDaJanelaAvaliacao() {
  if (!janelaAvaliacao.inicio || !janelaAvaliacao.fim) return false;
  const hoje = isoEfetivo();
  return hoje >= janelaAvaliacao.inicio && hoje <= janelaAvaliacao.fim;
}

// ┌─────────────────────────────────────────────────────────────────────────┐
// │ CRONOGRAMA FIXO DE PROVAS (2º bim) — TEMPORÁRIO. Remover após 17/07/2026.  │
// │ Mapeia a matéria para a data da prova, só para exibir "(DD/MM)" no bloco   │
// │ de avaliação. Só tem efeito dentro da janela do admin. Para desativar,     │
// │ basta esvaziar DATAS_PROVA e DATAS_PROVA_POR_DIA ({}).                      │
// └─────────────────────────────────────────────────────────────────────────┘
const DATAS_PROVA = {
  'matemática b': '14/07', 'química b': '14/07', 'geografia': '14/07',
  'linguística': '15/07', 'inglês': '15/07', 'química a': '15/07',
  'literatura': '16/07', 'história': '16/07', 'matemática a': '16/07',
  'biologia': '17/07',
};
// casos em que a data depende do DIA (ex: Redação aparece quinta E sexta com datas
// diferentes). Chave: "matéria|dia". Tem prioridade sobre DATAS_PROVA.
const DATAS_PROVA_POR_DIA = {
  'redação|qui': '09/07',
  'redação|sex': '10/07',
};
function dataProvaDe(materia, dia) {
  const m = (materia || '').toLowerCase().trim();
  const porDia = DATAS_PROVA_POR_DIA[m + '|' + (dia || '')];
  if (porDia) return porDia;
  return DATAS_PROVA[m] || '';
}

carregarJanelaAvaliacao();
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

// tokens expiram em 30 dias. Depois disso, o aluno faz login de novo. Isso evita que um
// token capturado valha para sempre (antes não havia expiração).
const TOKEN_VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
function validarToken(token) {
  try {
    const [b64, assinatura] = token.split('.');
    const payload = Buffer.from(b64, 'base64').toString();
    const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (assinatura !== esperado) return null;
    const [user, device, ts, pv] = payload.split('|');
    // token expirado? (ts é o horário de emissão em ms)
    const emitido = parseInt(ts, 10);
    if (!emitido || (Date.now() - emitido) > TOKEN_VALIDADE_MS) return null;
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
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido').split(',')[0].trim();
    logSeguranca('admin_senha_incorreta', { ip, rota: req.path });
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
      dispositivos: devs.map(d => ({ id: d.id, aparelho: d.aparelho || 'Desconhecido', data: d.data || '-' })),
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

// ── rate limiting GERAL (anti-abuso das rotas de dados) ─────────────────────
// limita cada IP a 60 requisições por minuto nas rotas protegidas. Uso normal (abrir o
// app, abrir matérias) fica MUITO abaixo disso; só barra quem fica recarregando em massa
// (que geraria custo de IA e carga desnecessária).
const requisicoesPorIp = {}; // ip -> { count, reset }
const LIMITE_GERAL = 60;
function rateLimitGeral(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido').split(',')[0].trim();
  const agora = Date.now();
  const reg = requisicoesPorIp[ip];
  if (!reg || agora > reg.reset) {
    requisicoesPorIp[ip] = { count: 1, reset: agora + 60000 };
    return next();
  }
  if (reg.count >= LIMITE_GERAL) {
    res.setHeader('Retry-After', '60');
    logSeguranca('rate_limit_geral', { ip, rota: req.path });
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
  }
  reg.count++;
  next();
}
setInterval(() => {
  const agora = Date.now();
  Object.keys(requisicoesPorIp).forEach(ip => {
    if (agora > requisicoesPorIp[ip].reset) delete requisicoesPorIp[ip];
  });
}, 300000);

// ── rota de login ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido';
  if (!checarRateLimit(ip)) {
    logSeguranca('login_bloqueado_ratelimit', { ip });
    return res.json({ error: 'Muitas tentativas. Aguarde 1 minuto e tente de novo.' });
  }
  const { user, pass, device } = req.body;
  if (!user || !pass || !device) return res.json({ error: 'Dados incompletos' });
  const registro = alunos[user];
  if (!registro || !bcrypt.compareSync(pass, registro.hash)) {
    registrarFalha(ip);
    logSeguranca('login_falha', { ip, user: user || '(vazio)' });
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
  logSeguranca('login_sucesso', { user, ip });
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
    { m:'Filosofia',      p:'Sandra Maisa',    url:'https://profsandracnsanglo.blogspot.com/p/3-ano-filosofia.html', tipo:'provaFinal', maxDiasDever:14, avaliacaoPorData:true, avisoAvaliacao:'Prova com consulta à apostila. Estude as páginas indicadas.' },
    { m:'Geografia',      p:'Gabriel Fonseca', url:'https://profgabrielcnsanglo.blogspot.com/p/3-ano-geografia.html', ignorarAvaliacao:true, testeAulaAnterior:true, maxDiasDever:14 },
    { m:'Prog. Lidere',   p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-lidere.html', tipo:'soDever', maxDiasDever:14 },
  ],
  ter: [
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'História', tipo:'acumulativo' },
    { m:'Química B',      p:'Washington Gois', url:'https://profwashingtonanglo.blogspot.com/p/3-ano.html', formato:'testesPorData' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, formato:'fisica', aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
  qua: [
    { m:'Linguística',    p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-gramatica.html', formato:'duasAulas' },
    { m:'Matemática A',   p:'Tiago Santos',    url:'https://professoratiagocnsanglo.blogspot.com/p/3-ano-em-matematica-a_27.html', formato:'rotulado' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Inglês',         p:'Jully Alvim',     url:'https://profjullycnsanglo.blogspot.com/p/3ano-em.html', tipo:'provaFinal', maxDiasDever:14 },
  ],
  qui: [
    { m:'Biologia',       p:'Angelita Pimenta',url:'https://profangelitacnsanglo.blogspot.com/p/3-ano.html', ignorarAvaliacao:true, testeNoDiaExato:true, maxDiasDever:14 },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Química A',      p:'Maurélio',        url:'https://maureliopereiral.blogspot.com/p/3-ano.html', maxDiasDever:14, ignorarAvaliacao:true, testeNoDiaExato:true, deverFixo:'TAREFAS DO 2º BIMESTRE: todas as TC da Frente A', aviso:'O professor marcou no blog a data da prova final do bimestre, mas essa data está incorreta e deve ser ajustada por ele. A prova não é nesta data. Considere abaixo apenas a matéria do teste mais recente.' },
    { m:'Redação',        p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14, ignorarAvaliacao:true, avaliacaoFixa:'Redação estilo ENEM' },
  ],
  sex: [
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html', maxDiasDever:14, testeMarcado:true, ignorarAvaliacao:true },
    { m:'Redação e Literatura', p:'Fábio', combinar:[
      { m:'Redação',    p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14, ignorarAvaliacao:true, avaliacaoFixa:'Redação estilo ENEM' },
      { m:'Literatura', p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Literatura', ignorarAvaliacao:true, interpretacaoComAnterior:true, maxDiasDever:14 },
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
  const hoje = isoEfetivo();
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
  const dia = isoEfetivo(); // AAAA-MM-DD (com virada às 22:30)
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

// limpa o HTML do blog e devolve texto. removerBlocos=true tira widgets de compartilhamento,
// rodapé e <nav>. Em páginas com HTML MUITO aninhado (ex: Mat A), essas remoções de bloco
// às vezes engolem o corpo inteiro junto; por isso existe o modo suave (false), que só tira
// <script>/<style> e preserva o conteúdo. fetchBlog usa os dois e escolhe (ver salvaguarda).
function limparHtmlBlog(html, removerBlocos) {
  let texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  if (removerBlocos) {
    texto = texto
      .replace(/<div[^>]*class=['"][^'"]*sharing[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class=['"][^'"]*post-share-buttons[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class=['"][^'"]*social[^'"]*['"][\s\S]*?<\/div>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '');
  }
  texto = texto
    // PRESERVA A ESTRUTURA DA TABELA: cada <tr> vira uma linha, cada <td>/<th> separada por " | ".
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')   // linha que só tem espaços vira quebra pura...
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')     // ...e quebras seguidas colapsam numa só
    .replace(/ \| (?= \| )/g, '')
    .trim();
  // ENXUGA: corta tudo a partir do rodapé/menu/sidebar do Blogspot. Esses marcadores são
  // inequívocos (nunca aparecem em conteúdo de aula), então o que vem depois é lixo (bio do
  // professor, "Escolha a turma", "Arquivo do blog", etc.). Reduz bastante o texto pra IA.
  const iRodape = texto.search(/\b(?:Postagens?\s*\(Atom\)|ESCOLHA A TURMA|Pesquisar este blog|Quem sou eu|Arquivo do blog|Ver meu perfil|Denunciar abuso|Tecnologia do Blogger|Fornecido pelo Blogger)/i);
  if (iRodape > 100) texto = texto.slice(0, iRodape).trim(); // >100: nunca zera o conteúdo por engano
  // remove linhas que são claramente botões de compartilhar/navegação do Blogspot
  const lixo = /^(enviar por e-?mail|postar no blog|compartilhar (no|com)|marcadores|postagens? (mais|mais antiga|recente)|in[ií]cio|assinar|comentários|nenhum comentário|reações|um blog|tecnologia do blogger|página inicial|ver vers[aã]o|seguir)/i;
  return texto.split('\n').filter(l => !lixo.test(l.trim())).join('\n');
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
    // limpa em modo agressivo (tira widgets/rodapé/nav)
    let texto = limparHtmlBlog(html, true);
    // SALVAGUARDA: em páginas com HTML muito aninhado (ex: Mat A), a remoção de blocos pode
    // engolir o corpo inteiro e sobrar quase nada. Nesse caso, o modo suave preserva o corpo.
    // Só troca para o suave quando ele recupera MUITO mais texto (evita mexer no que já funciona).
    const textoSuave = limparHtmlBlog(html, false);
    if (textoSuave.length > texto.length * 3 && textoSuave.length > 500) {
      texto = textoSuave;
    }
    // Mantém as aulas RECENTES tanto se o blog lista do mais novo pro velho (recentes no
    // TOPO, ex: Tiago/Saulo) quanto do mais velho pro novo (recentes no FIM). O corte antigo
    // guardava só o FIM: num blog grande com o novo no topo (Mat A), isso jogava fora a aula
    // de hoje e mantinha as de fevereiro. Agora, se o texto for grande, guarda as DUAS pontas.
    let textoFinal;
    if (texto.length <= 12000) {
      textoFinal = texto; // cabe inteiro: manda tudo, seja qual for a ordem
    } else {
      textoFinal = texto.slice(0, 5000) + '\n__________ (corte do meio) __________\n' + texto.slice(-7000);
    }
    // guarda no cache: o texto CORTADO (pra IA) e o COMPLETO (pra extração da avaliação, que
    // é feita por código e precisa do INÍCIO do blog, onde alguns professores põem a prova).
    blogCache[url] = { texto: textoFinal, textoCompleto: texto, ts: Date.now() };
    return textoFinal;
  } catch { return null; }
}
// retorna o texto COMPLETO do blog (sem o corte de 7000). Usado só pela extração da
// avaliação final (Filosofia/Inglês põem a prova no início do blog). Cai no cache de fetchBlog.
async function fetchBlogCompleto(url) {
  const cached = blogCache[url];
  if (cached && (Date.now() - cached.ts) < BLOG_CACHE_MS && cached.textoCompleto) {
    return cached.textoCompleto;
  }
  await fetchBlog(url); // popula o cache (incl. textoCompleto)
  const c = blogCache[url];
  return (c && c.textoCompleto) ? c.textoCompleto : (c ? c.texto : null);
}

function hojeStr() {
  const b = agoraEfetivo();
  return ('0'+b.getUTCDate()).slice(-2) + '/' + ('0'+(b.getUTCMonth()+1)).slice(-2) + '/' + b.getUTCFullYear();
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

// filtro padrão dos DEVERES PENDENTES em todas as matérias: mantém só os deveres dos
// últimos `janelaDias` dias (padrão 14 = 2 semanas) e no máximo `maxItens` (padrão 2),
// sempre os mais recentes. Recebe lista de {data:'DD/MM', num, ...} e a data de referência.
function filtrarPendentes(lista, refNum, janelaDias, maxItens) {
  const janela = (janelaDias && janelaDias > 0) ? janelaDias : 14;
  const limite = (maxItens && maxItens > 0) ? maxItens : 2;
  const refData = numParaData(refNum);
  return (lista || [])
    .filter(l => {
      if (!l || !l.num) return false;
      const d = numParaData(l.num);
      if (!d || !refData) return false;
      const diasAtras = Math.floor((refData - d) / 86400000);
      return diasAtras >= 0 && diasAtras <= janela;
    })
    .sort((a, b) => b.num - a.num)
    .slice(0, limite);
}

// remove deveres repetidos da lista de pendentes: se o MESMO dever aparece mais de uma vez
// (em datas diferentes ou na mesma data), mantem so a primeira ocorrencia (a mais recente,
// porque filtrarPendentes ja ordena do mais novo para o mais antigo). Entrada de data que
// fica sem nenhum dever depois da limpeza e descartada.
function dedupDeveres(lista) {
  if (!Array.isArray(lista)) return lista;
  const vistos = new Set();
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const out = [];
  for (const entry of lista) {
    if (!entry || !Array.isArray(entry.deveres)) { out.push(entry); continue; }
    const deveres = [];
    for (const d of entry.deveres) {
      const k = norm(d);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      deveres.push(d);
    }
    if (deveres.length) out.push(Object.assign({}, entry, { deveres }));
  }
  return out;
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
  let deveres_pendentes = filtrarPendentes(
    (dados.deveres_pendentes || [])
      .map(g => ({ data: (g.data||'').slice(0,5), num: dataParaNum(g.data), deveres: (g.deveres||[]).filter(d => d && d.trim() && !ehLixo(d)) }))
      .filter(g => g.deveres.length > 0),
    refNum, 14, 2
  ).map(g => ({ data: g.data, deveres: g.deveres }));

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
  // item 5: quando a aula do dia é CORREÇÃO de RAA/avaliação, não faz sentido gerar resumo
  // (não é conteúdo de matéria). Marca a flag para o front não mostrar o botão de resumo.
  const ehCorrecaoRAA = /corre[çc][ãa]o\s+d[eao]s?\s+(raa|avalia[çc][õãa]o|avalia[çc][õo]es)/i.test(aula_hoje);

  return {
    aula_hoje,
    aula_data: aula_hoje ? refDDMM : '',
    deveres_pendentes, deveres_aula,
    // campos específicos de história
    historia: true,
    sem_resumo: ehCorrecaoRAA,
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
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  const ehLixo = (t) => ehEventoEscolar(t) || /postagens?|^páginas$|^in[ií]cio$|pesquisar este blog|ver meu perfil|denunciar|arquivo do blog/i.test((t||'').trim());

  // ── EXTRAÇÃO POR CÓDIGO (regex) ────────────────────────────────────────────
  // O blog do Lenon é MUITO regular: "AULA N DATA: DD/MM/AAAA <descrição> <atividades>".
  // Extrair por código é estável (a IA às vezes retornava vazio) e custa zero. Usa o blog
  // COMPLETO (não o cortado em 7000), para nunca perder as aulas mais recentes.
  const parseAulasRegex = (texto) => {
    if (!texto) return [];
    const re = /AULA\s+(\d{1,3})\s+DATA:\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*([\s\S]*?)(?=AULA\s+\d{1,3}\s+DATA:|_{5,}|$)/gi;
    const out = [];
    let m;
    while ((m = re.exec(texto)) !== null) {
      const numero = parseInt(m[1],10);
      const dataFull = m[2];
      let corpo = (m[3]||'').replace(/_{3,}/g,' ').replace(/\s+/g,' ').trim();
      // corta rodapé/menu do Blogger quando ele gruda na ÚLTIMA aula (não há próxima "AULA N"
      // nem "_____" para o lookahead parar). Só frases inequívocas de chrome do blog, que
      // nunca aparecem numa descricao de aula (evita cortar conteudo legitimo).
      const iRodape = corpo.search(/\s*(?:Postagens?\s*\(Atom\)|Postagem mais (?:recente|antiga)|P[áa]gina inicial|Arquivo do blog|Pesquisar este blog|Denunciar abuso|Quem sou eu|Ver meu perfil(?:\s+completo)?|Tecnologia do Blogger|Fornecido pelo Blogger|ESCOLHA A TURMA)/i);
      if (iRodape >= 0) corpo = corpo.slice(0, iRodape).trim();
      // extrai atividades SEM mutilar a descrição (preferência: manter o texto inteiro).
      // 1) padrão "Atividade(s) na apostila/complementar/páginas: ..." → vira dever e sai da descrição.
      // 2) se a aula menciona "RAA" (nome e/ou link do arquivo do RAA), registra "RAA" como
      //    dever, mas MANTÉM a descrição completa (não remove nenhum RAA do texto).
      let atividades = [];
      const mAtiv = corpo.match(/atividades?\s+(?:na\s+apostila|complementar|das?\s+p[áa]ginas?)[^]*$/i);
      if (mAtiv) {
        atividades = [mAtiv[0].trim()];
        corpo = corpo.slice(0, corpo.indexOf(mAtiv[0])).trim();
      } else if (/\bRAA\b/.test(corpo)) {
        atividades = ['RAA'];
        // descrição permanece inteira (não corta o RAA do nome nem o do link)
      }
      corpo = corpo.replace(/\s+/g,' ').trim();
      atividades = atividades.filter(d => d && d.trim() && !ehLixo(d));
      out.push({ numero, data: dataFull.slice(0,5), num: dataParaNum(dataFull), descricao: corpo, tema: '', atividades });
    }
    return out;
  };

  // extrai as aulas por código (regex), a partir do texto do blog recebido.
  let aulas = parseAulasRegex(blogText).filter(a => a.num > 0);

  // ── RESERVA: se o regex não achou aulas (formato mudou), cai na IA ──────────
  if (aulas.length === 0) {
    const temConteudo = blogText && blogText.length > 50;
    const prompt = 'Você extrai dados do registro de aulas de ' + materia + ', professor ' + professor + '.' +
      '\nAs aulas são numeradas: "AULA 7", "AULA 8"... Cada uma tem "DATA: DD/MM/AAAA" e descrição.' +
      '\nExtraia TODAS as aulas com data. Para cada uma: numero, data (DD/MM), descricao, tema (tópico curto), atividades (lista).' +
      '\nIGNORE rodapé do Blogspot e eventos da escola. NÃO invente.' +
      '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
      '\n\nResponda APENAS JSON: {"aulas":[{"numero":9,"data":"DD/MM","descricao":"","tema":"","atividades":[]}]}';
    let dados;
    try { dados = await callAnthropic(prompt, 0); } catch (e) { dados = { aulas: [] }; }
    aulas = (dados.aulas || [])
      .map(a => ({
        numero: a.numero, data: (a.data||'').slice(0,5), num: dataParaNum(a.data),
        descricao: (a.descricao||'').trim(), tema: (a.tema||'').trim(),
        atividades: (a.atividades||[]).filter(d => d && d.trim() && !ehLixo(d))
      }))
      .filter(a => a.num > 0);
  }

  // aulas do dia de referência (pode ter 2). Compara por NÚMERO da data.
  const aulasDoDia = aulas.filter(a => a.num === refNum).sort((x,y) => (x.numero||0) - (y.numero||0));

  // monta "aula de hoje" mostrando as aulas do dia
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

  // deveres pendentes = atividades das últimas datas ANTERIORES ao dia que tenham atividade
  const limite = (maxDeveres && maxDeveres > 0) ? maxDeveres : 2;
  const anteriores = aulas
    .filter(a => a.num < refNum && a.atividades.length > 0)
    .sort((a,b) => b.num - a.num);
  const pendPorData = {};
  for (const a of anteriores) {
    if (!pendPorData[a.data]) pendPorData[a.data] = [];
    pendPorData[a.data].push(...a.atividades);
  }
  const deveres_pendentes = filtrarPendentes(
    Object.keys(pendPorData).map(data => ({ data, num: dataParaNum(data), deveres: pendPorData[data] })),
    refNum, 14, limite
  ).map(g => ({ data: g.data, deveres: g.deveres }));

  // MATÉRIA DO TESTE: a PRIMEIRA aula do dia da referência (menor número). Se não houver aula
  // hoje, usa a aula mais recente até hoje.
  const aulasDoDiaRef = aulas
    .filter(a => a.descricao && a.descricao.length > 3 && a.num === refNum)
    .sort((a,b) => (a.numero||0) - (b.numero||0));
  let linhaTeste = aulasDoDiaRef[0] || null;
  if (!linhaTeste) {
    const recentes = aulas
      .filter(a => a.num <= refNum && a.descricao && a.descricao.length > 3)
      .sort((a,b) => (b.numero||0) - (a.numero||0) || b.num - a.num);
    linhaTeste = recentes[0] || null;
  }
  let materia_teste = linhaTeste ? (linhaTeste.tema || linhaTeste.descricao) : '';
  const materia_teste_data = linhaTeste ? linhaTeste.data : '';

  if (materia_teste && linhaTeste && !linhaTeste.tema) {
    let t = materia_teste;
    const mApos = t.match(/(?:em\s+seguida|na\s+sequ[êe]ncia|posteriormente)\s*,?\s*(aula\s+expositiva[^]*)/i);
    if (mApos) t = mApos[1];
    t = t.split(/\.\s*(?:posteriormente|por\s+fim|em\s+seguida|ao\s+final|os\s+alunos\s+realizaram|atividades?\s+de\s+fixa|atividade\s+complementar)/i)[0];
    t = t.replace(/,?\s*com\s+exemplos?(\s+e\s+explica[çc][õo]es?)?\.?\s*$/i, '');
    materia_teste = t.replace(/[.;\s]+$/,'').trim();
  }

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
    '\n1. "deveres": lista de TAREFAS. Para cada "TAREFA DD/MM X", extraia {data:"DD/MM", dever:"X (texto completo)", tema:"assunto principal, curto, sem números de página nem palavras como PAGINA/QUESTOES"}.' +
    '\n   Ex: "TAREFA 30/6 PAGINA 41 CONSERVAÇÃO DE ENERGIA PAGINA 42 QUESTOES 1 A 10" -> {data:"30/6", dever:"Página 41 conservação de energia; Página 42 questões 1 a 10", tema:"conservação de energia"}.' +
    '\n   Ex: "TAREFA 19/6 TRABALHO E POTENCIA" -> {data:"19/6", dever:"Trabalho e potência", tema:"trabalho e potência"}.' +
    '\n2. "testes": lista de TESTES. Para cada "TESTE DD/MM X" ou "CONTEUDO DO TESTE DD/MM X", extraia {data:"DD/MM", conteudo:"X"}.' +
    '\nIGNORE eventos da escola (olimpíadas, copaanglo, gincana) e rodapé do blog (Postagens, perfil, Escolha a turma, Atom).' +
    '\nNÃO invente. Extraia só o que está escrito. Use o ano 2026 para todas as datas.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"deveres":[{"data":"DD/MM","dever":"texto","tema":"assunto curto"}],"testes":[{"data":"DD/MM","conteudo":"texto"}]}';

  let dados;
  try { dados = await callAnthropic(prompt, 0); } catch (e) { dados = { deveres: [], testes: [] }; }

  const ehLixo = (t) => ehEventoEscolar(t) || /postagens?|^páginas$|^in[ií]cio$|pesquisar este blog|ver meu perfil|denunciar|escolha a turma|fevereiro 20/i.test((t||'').trim());

  // deveres (tarefas) com data <= hoje, mais recentes primeiro. Guarda texto completo E tema.
  const deveres = (dados.deveres || [])
    .map(d => ({
      data: (d.data||'').slice(0,5),
      num: dataParaNum(d.data),
      dever: (d.dever||'').trim(),
      tema: (d.tema||'').trim() || (d.dever||'').trim()
    }))
    .filter(d => d.num > 0 && d.dever && !ehLixo(d.dever))
    .sort((a,b) => b.num - a.num);

  // testes/conteúdos de teste com data, mais recentes primeiro
  const testes = (dados.testes || [])
    .map(t => ({ data: (t.data||'').slice(0,5), num: dataParaNum(t.data), conteudo: (t.conteudo||'').trim() }))
    .filter(t => t.num > 0 && t.conteudo && !ehLixo(t.conteudo))
    .sort((a,b) => b.num - a.num);

  // a TAREFA mais recente até hoje é a "desta aula" (para deveres). A matéria dela NÃO é mais
  // usada como "aula de hoje" automaticamente: a aula de hoje só existe se houver TAREFA na
  // DATA EXATA de referência (senão fica "sem registro"), igual às demais matérias.
  const deveresAteHoje = deveres.filter(d => d.num <= refNum);
  const deverRecente = deveresAteHoje[0] || null;

  // AULA DE HOJE = tema da TAREFA cuja data é EXATAMENTE a de referência. Se não houver
  // registro nessa data, aula_hoje fica vazio (sem registro).
  const deverDoDia = deveres.find(d => d.num === refNum) || null;
  const aula_hoje = deverDoDia ? deverDoDia.tema : '';

  // DEVERES DESTA AULA = o dever da DATA EXATA de referência (mesma regra da aula de hoje).
  // Dia sem aula (sem tarefa nessa data) = sem deveres desta aula.
  const deveres_aula = deverDoDia ? [deverDoDia.dever] : [];

  // DEVERES PENDENTES = tarefas ANTERIORES à data de hoje. Filtro: 14 dias, máx 2.
  // (continua aparecendo mesmo em dia sem aula, para o aluno não perder um dever em aberto.)
  const deveres_pendentes = filtrarPendentes(
    deveresAteHoje.filter(d => d.num < refNum),
    refNum, 14, 2
  ).map(d => ({ data: d.data, deveres: [d.dever] }));

  // MATÉRIA DO TESTE: se houver "CONTEUDO DO TESTE"/"TESTE" até hoje, usa o mais recente.
  // Se NÃO houver nenhum, usa o TEMA do dever mais recente (ex: "conservação de energia").
  const testesAteHoje = testes.filter(t => t.num <= refNum);
  const ultimoTeste = testesAteHoje[0] || null;
  let materia_teste = '', materia_teste_data = '';
  if (ultimoTeste && ultimoTeste.conteudo) {
    materia_teste = ultimoTeste.conteudo;
    materia_teste_data = ultimoTeste.data;
  } else if (deverRecente && deverRecente.tema) {
    materia_teste = deverRecente.tema;
    materia_teste_data = deverRecente.data;
  }

  let resumo = ''; // resumo gerado sob demanda (ao abrir a matéria)

  return {
    aula_hoje,
    aula_data: deverDoDia ? deverDoDia.data : '',
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
async function processarRotulosSaulo(materia, professor, blogText, dataRef, labelDia) {
  const ref = dataRef || hojeStr();
  const refNum = dataParaNum(ref);
  const refDDMM = ref.slice(0,5);

  // limpa lixo: underscores de separação, espaços sobrando, e marcadores vazios
  const limpar = (t) => (t || '')
    .replace(/_{2,}/g, ' ')      // tira as linhas de underscores separadoras
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-*]+|[\s\-*]+$/g, '')
    .trim();

  // extrai cada bloco DATA/MATÉRIA/TAREFA
  const re = /DATA:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:M[ÓO]DULO:\s*\d+\s*)?MAT[ÉE]RIA:\s*(.+?)\s*(?:PAG\.?:\s*.+?\s*)?TAREFA:\s*(.+?)(?=\s*DATA:|$)/gi;
  const linhas = [...(blogText || '').matchAll(re)]
    .map(m => ({
      data: m[1].slice(0,5),
      num: dataParaNum(m[1]),
      materia: limpar(m[2]),
      tarefa: limpar(m[3])
    }))
    .filter(l => l.num > 0 && l.materia && !ehEventoEscolar(l.materia));

  // AULA DE HOJE: SÓ a linha com data EXATAMENTE igual à referência. Se o blog não tem
  // registro para hoje, aula de hoje e dever desta aula ficam vazios (sem registro).
  const linhaHoje = linhas.find(l => l.num === refNum) || null;
  const aula_hoje = linhaHoje ? linhaHoje.materia : '';

  // DEVER DESTA AULA: a TAREFA da linha de hoje (se não for "testinho"/"teste").
  const deveres_aula = [];
  if (linhaHoje && linhaHoje.tarefa && !/testinho|teste\b/i.test(linhaHoje.tarefa)) {
    deveres_aula.push(linhaHoje.tarefa);
  }

  // DEVERES PENDENTES: tarefas das aulas ANTERIORES a hoje. Quando não há aula hoje, a
  // tarefa da última aula (ex: 01/07) entra aqui como pendente. Filtro: últimos 14 dias, máx 2.
  const ateHoje = linhas.filter(l => l.num <= refNum).sort((a,b) => b.num - a.num);
  const candidatos = [];
  for (const l of ateHoje) {
    if (l.num === refNum) continue; // a de hoje (se existir) não é pendente
    if (l.tarefa && !/testinho|teste\b/i.test(l.tarefa)) {
      candidatos.push({ data: l.data, num: l.num, deveres: [l.tarefa] });
    }
  }
  const pendentes = filtrarPendentes(candidatos, refNum, 14, 2).map(p => ({ data: p.data, deveres: p.deveres }));

  // MATÉRIA DO TESTE: o Saulo aplica teste na QUINTA (na quarta nunca tem, então esconde).
  // Na quinta: se houver "testinho" marcado no blog (no campo matéria OU tarefa), usa a
  // matéria dessa aula. Se não houver testinho, usa a matéria da aula mais recente.
  let materia_teste = '', materia_teste_data = '';
  const ehQuinta = /quinta/i.test(labelDia || '');
  if (ehQuinta) {
    const temTestinho = (l) => /testinho|teste\b/i.test(l.materia) || /testinho/i.test(l.tarefa);
    const comTestinho = ateHoje.filter(temTestinho);
    if (comTestinho.length) {
      // limpa: corta em "DATA:" (evita invadir a próxima aula), tira o marcador TESTINHO,
      // e remove descrições longas de "aula destinada a...". Fica só o conteúdo/tema.
      let txt = comTestinho[0].materia
        .split(/\s*DATA:/i)[0]                              // não invade a próxima aula
        .replace(/\s*aula\s+destinada.*$/i, '')            // tira "Aula destinada ao esclarecimento..."
        .replace(/\s*testinho\s*/gi, ' ')                  // tira a palavra TESTINHO
        .replace(/\s*corre[çc][ãa]o\s+da\s+pag.*$/i, '')   // tira "correção da pág..."
        .replace(/\s+/g, ' ').trim();
      materia_teste = txt;
      materia_teste_data = comTestinho[0].data;
    } else if (ateHoje.length) {
      materia_teste = ateHoje[0].materia.split(/\s*DATA:/i)[0].replace(/\s+/g, ' ').trim();
      materia_teste_data = ateHoje[0].data;
    }
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

  // AULA DE HOJE: mostra o que o blog registrou EXATAMENTE na data de referência, seja teste,
  // PROVA BIMESTRAL, RAA, revisão ou um tópico simples. Antes só reconhecia "TESTE N"; agora
  // reconhece qualquer entrada "DD/MM - ...". A matéria do teste (acima) continua usando só os
  // testes, para não misturar prova/RAA no conteúdo de estudo.
  const todasEntradas = [...(blogText || '').matchAll(/(\d{1,2}\/\d{1,2})\s*[-–]\s*(.+?)(?=\s+\d{1,2}\/\d{1,2}\s*[-–]|$)/g)]
    .map(m => ({ data: m[1], num: dataParaNum(m[1]), conteudo: m[2].trim().replace(/\s+/g,' ') }))
    .filter(e => e.num > 0 && e.conteudo);
  const entradaHoje = todasEntradas.find(e => e.num === refNum);
  let aula_hoje = '', aula_data = '';
  if (entradaHoje) {
    const mTeste = entradaHoje.conteudo.match(/^TESTE\s+[IVXLC0-9]+\s*[-–]\s*(.+)$/i);
    aula_hoje = mTeste ? ('Teste: ' + mTeste[1].trim()) : entradaHoje.conteudo;
    aula_data = entradaHoje.data;
  }

  let resumo = ''; // resumo gerado sob demanda (ao abrir a matéria)

  return {
    aula_hoje,
    aula_data,
    deveres_pendentes: [], deveres_aula: [],
    tem_avaliacao: !!materia_teste, materia_teste, materia_teste_data,
    resumo, questoes: [],
    proxima_aula:'', proxima_resumo:'', proxima_deveres:[]
  };
}

async function processWithAI(materia, professor, blogText, filtro, dataRef, labelDia, tipo, maxDeveres, maxDiasDever, formato, ignorarAvaliacao, testeAulaAnterior, testeMarcado, interpretacaoComAnterior, testeNoDiaExato) {
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
    return processarRotulosSaulo(materia, professor, blogText, dataRef, labelDia);
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
    '\n"Aulas X e Y" é UMA aula só que acontece em DOIS dias (X e Y). NUNCA repita o mesmo dever em datas diferentes.' +
    '\n\n*** O QUE EXTRAIR (só ' + (filtro||'REDAÇÃO') + ') ***' +
    '\n- "data": última data do grupo (DD/MM).' +
    '\n- "data_inicio": a PRIMEIRA data do par (DD/MM). Para "Aulas 25 e 26/06", data_inicio="25/06" e data="26/06". Para "Aula 17/04" (uma só), data_inicio e data são iguais ("17/04").' +
    '\n- "materia": disciplina + tema curto.' +
    '\n- "deveres": pela regra acima (um item, ou []).' +
    '\n\nIGNORE rodapé do Blogspot (Postagens, Páginas, Arquivo do blog, perfil, Atom) e eventos da escola (excursão, recesso, feriado, etc.).' +
    '\nNÃO invente. Extraia só o que está escrito.' +
    '\n\n' + (temConteudo ? 'REGISTRO:\n' + blogText : 'Sem conteúdo.') +
    '\n\nResponda APENAS JSON sem markdown:' +
    '\n{"linhas":[{"data":"DD/MM","data_inicio":"DD/MM","materia":"texto","deveres":["tarefa"]}],"avaliacao":{"tem":false,"data":"","sobre":""}}';

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
      const doDia = testesQuadro.find(t => t.num === refN);
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
      dataInicio: (l.data_inicio||l.data||'').trim(), // primeira data do par (agrupado)
      num: dataParaNum(l.data),
      numInicio: dataParaNum(l.data_inicio||l.data),
      materia: (l.materia||'').trim(),
      deveres: (l.deveres||[]).filter(d => d && d.trim() && !ehLixo(d))
    }))
    .filter(l => l.num > 0);

  // FALLBACK DETERMINÍSTICO (rotulado): a aula de hoje não pode depender só da IA.
  // Se a IA não devolveu uma linha com a data de referência mas o texto TEM um bloco
  // "DATA: <ref> CONTEÚDO: ...", extraímos por regex e injetamos a linha. Mesmo padrão
  // adotado na Linguística: código decide, IA é reserva. Decodifica entidades (&#176; -> °).
  if (formato === 'rotulado' && !linhas.some(l => l.num === refNum)) {
    const decodeEnt = (s) => (s||'').replace(/&#(\d+);/g, (_,n) => String.fromCharCode(parseInt(n,10))).replace(/&nbsp;/g,' ').trim();
    const blocosData = [...(blogText||'').matchAll(/DATA:\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*([\s\S]*?)(?=DATA:\s*\d{1,2}\/|Teste\s+\d+\s*\||Avalia[çc][ãa]o\s*\||$)/gi)];
    for (const b of blocosData) {
      const numB = dataParaNum(b[1]);
      if (numB !== refNum) continue;
      let corpoB = decodeEnt(b[2]).replace(/_{3,}/g,' ').replace(/\s+/g,' ').trim();
      let materiaB = corpoB;
      const mC = corpoB.match(/(?:CONTE[ÚU]DO|MAT[ÉE]RIA)\s*:\s*(.+)$/i);
      if (mC) materiaB = mC[1];
      let deveresB = [];
      const mT = materiaB.match(/^(.*?)\s*TAREFA(?:\s+PARA\s+[\d\/]+)?\s*:\s*(.+)$/i);
      if (mT) { materiaB = mT[1].trim(); const t = mT[2].trim(); if (t && t !== '*') deveresB = [t]; }
      materiaB = materiaB.replace(/\s*PLURALL\s*:.*/i,'').replace(/\s*P[ÁA]GINA\s*:\s*/i,' (pág. ').trim();
      if (materiaB.includes('(pág. ') && !materiaB.endsWith(')')) materiaB += ')';
      if (materiaB && !ehEventoEscolar(materiaB) && !ehLixo(materiaB)) {
        linhas.push({ data: b[1].slice(0,5), dataInicio: b[1].slice(0,5), num: numB, numInicio: numB, materia: materiaB, deveres: deveresB });
      }
      break;
    }
  }

  // ── O CÓDIGO DECIDE TUDO (determinístico, não depende da IA) ──
  // 1. AULA DO DIA: a linha cuja data bate com a referência. No formato agrupado, a aula
  // "Aulas 25 e 26/06" vale para OS DOIS dias (25 e 26), então bate se a referência for
  // qualquer uma das duas datas do par. Assim quinta (25) e sexta (26) mostram o mesmo.
  let linhaRef = linhas.find(l => l.num === refNum || (l.numInicio && l.numInicio === refNum));
  let aulaSomenteExibicao = false;
  // se mesmo assim não achou (data fora do par), mostra a aula mais recente até hoje
  // APENAS como conteúdo (sem repetir o dever, que já entra nos pendentes).
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

  // REGRA "teste no dia exato" (ex: Biologia Angelita, Química A Maurélio): a matéria do
  // teste só usa um testinho/teste se ele estiver marcado na data EXATA de hoje. Se não
  // houver teste hoje, cai no comportamento padrão (matéria da última aula).
  let testeExatoTexto = '', testeExatoData = '';
  if (testeNoDiaExato) {
    // procura a aula com data igual a hoje que mencione "testinho:" ou "teste N:"
    const linhaHojeTeste = linhas.find(l => l.num === refNum && /testinho|teste\s*\d*\s*:/i.test(l.materia));
    if (linhaHojeTeste) {
      // extrai o conteúdo após o marcador (ex: "TESTE 4 : COEFICIENTE" -> "COEFICIENTE")
      const mm = linhaHojeTeste.materia.match(/(?:testinho|teste\s*\d*)\s*:\s*(.+?)(?:[.;]|$)/i);
      testeExatoTexto = (mm && mm[1].trim()) ? mm[1].trim() : linhaHojeTeste.materia;
      testeExatoData = linhaHojeTeste.data.slice(0,5);
    }
  }

  // decide se mostra teste conforme o tipo
  let tem_avaliacao, materia_teste, materia_teste_data;
  if (ignorarAvaliacao && !interpretacaoComAnterior && !testeNoDiaExato && !testeMarcado) {
    // matérias sem teste (ex: Redação): nunca mostra matéria do teste, seja qual for o tipo.
    // (Literatura usa ignorarAvaliacao MAS tem interpretacaoComAnterior, então não cai aqui.)
    tem_avaliacao = false; materia_teste = ''; materia_teste_data = '';
  } else if (tipo === 'soDever') {
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
    } else if (testeNoDiaExato) {
      // regra "teste no dia exato": se há teste hoje, usa ele. Senão, a matéria da última aula.
      if (testeExatoTexto) {
        materia_teste = testeExatoTexto;
        materia_teste_data = testeExatoData;
      } else {
        materia_teste = linhaTeste ? linhaTeste.materia : '';
        materia_teste_data = linhaTeste ? linhaTeste.data.slice(0,5) : '';
      }
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

  // REGRA ESPECIAL (Literatura): o testinho de "interpretação de texto" cobra o conteúdo
  // das aulas anteriores. A regra só se aplica quando o testinho é do DIA ATUAL.
  // Casos:
  //  A) HOJE tem testinho e é "interpretação de texto" -> "interpretação de texto, <último teste anterior não-interpretação>".
  //  B) HOJE tem testinho normal -> vale o padrão (já definido acima).
  //  C) HOJE não tem testinho, e o ÚLTIMO teste registrado foi "interpretação de texto" ->
  //     matéria do teste = primeira parte da aula de hoje + a matéria da última aula, com aviso.
  if (interpretacaoComAnterior) {
    const ehInterpretacao = (t) => /interpreta[çc][ãa]o\s+de\s+texto/i.test(t || '');
    // pega os testinhos COM data, direto das linhas (materia contém "Testinho: X")
    const extrairTestinho = (txt) => {
      const m = (txt || '').match(/testinho:\s*([^;.\n]+)/i);
      return m ? m[1].trim() : '';
    };
    const linhasComTestinho = linhas
      .map(l => ({ num: l.num, data: l.data.slice(0,5), testinho: extrairTestinho(l.materia), materia: l.materia }))
      .filter(l => l.testinho)
      .sort((a,b) => a.num - b.num); // mais antigo -> mais novo

    // testinho do DIA ATUAL (se houver)
    const testinhoHoje = linhasComTestinho.find(l => l.num === refNum);

    if (testinhoHoje && ehInterpretacao(testinhoHoje.testinho)) {
      // CASO A: interpretação de texto hoje -> junta com o último teste anterior não-interpretação
      let anterior = '';
      const idx = linhasComTestinho.indexOf(testinhoHoje);
      for (let k = idx - 1; k >= 0; k--) {
        if (!ehInterpretacao(linhasComTestinho[k].testinho)) { anterior = linhasComTestinho[k].testinho; break; }
      }
      materia_teste = anterior ? ('interpretação de texto, ' + anterior) : 'interpretação de texto';
      materia_teste_data = testinhoHoje.data;
      tem_avaliacao = true;
    } else if (!testinhoHoje) {
      // CASO C: HOJE não tem testinho. Olha o último teste registrado até hoje.
      const ultimoTeste = linhasComTestinho.filter(l => l.num <= refNum).slice(-1)[0] || null;
      if (ultimoTeste && ehInterpretacao(ultimoTeste.testinho)) {
        // primeira parte da aula de hoje (antes de ";" ou "."), limpa de termos sem nexo? NÃO:
        // a primeira parte da aula de hoje é o que o professor deu hoje (ex: "Resolução do
        // simulado"), então entra como está.
        const primeiraParteAula = (aula_hoje || '').split(/[;.]/)[0].trim();
        // matéria da última aula ANTERIOR a hoje. Precisa ser MATÉRIA REAL: remove qualquer
        // "Testinho: X" e depois os termos sem nexo (revisão, resolução de simulado, etc.).
        // Só entra no "vamos estudar isso também" se sobrar um assunto de verdade.
        const ultimaAula = linhas
          .filter(l => l.num < refNum && l.materia && l.materia.trim())
          .sort((a,b) => b.num - a.num)[0] || null;
        let materiaUltimaAula = '';
        if (ultimaAula) {
          const semTestinho = ultimaAula.materia.replace(/testinho:\s*[^;.\n]+/gi, '').trim();
          materiaUltimaAula = assuntoAvaliavel(semTestinho); // vazio se só sobrar coisa sem nexo
        }
        const partes = [];
        if (primeiraParteAula) partes.push(primeiraParteAula);
        if (materiaUltimaAula) partes.push('vamos estudar isso também: ' + materiaUltimaAula);
        materia_teste = partes.join('; ');
        materia_teste_data = linhaRef ? linhaRef.data.slice(0,5) : refDDMM;
        tem_avaliacao = !!materia_teste;
      }
    }
    // CASO B (testinho normal hoje): não faz nada, mantém o que o padrão já definiu.
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
  const hoje = agoraEfetivo();
  const hojeNum = hoje.getUTCDay();
  let diff = dayNum - hojeNum;
  // se o dia já passou nesta semana (ou é fim de semana olhando pra segunda), pega o da próxima ocorrência
  if (diff < 0) diff += 7;
  // caso especial: fim de semana (sáb=6, dom=0) olhando para segunda → próxima segunda
  if ((hojeNum === 6 || hojeNum === 0) && dayKey === 'seg') {
    diff = hojeNum === 6 ? 2 : 1;
  }
  const alvo = new Date(hoje);
  alvo.setUTCDate(hoje.getUTCDate() + diff);
  const dd = String(alvo.getUTCDate()).padStart(2,'0');
  const mm = String(alvo.getUTCMonth()+1).padStart(2,'0');
  const aaaa = alvo.getUTCFullYear();
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

  // se TODAS as matérias já estão boas no cache, entrega tudo instantâneo.
  // IMPORTANTE: aplica comMateriais também aqui, senão as regras que dependem da leitura
  // (janela de avaliação, semana de provas, materiais) seriam ignoradas ao servir do cache,
  // fazendo o card "mudar" ao atualizar a página (bug de cache cru).
  if (cacheDia && materias.every((_, i) => itemBom(cacheDia[i]))) {
    materias.forEach((item, i) => {
      const pronto = comMateriais(cacheDia[i], item);
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:pronto, ehPrevia, cached:true }) + '\n\n');
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
  // aplica uma sobrescrita PARCIAL sobre o resultado do blog: só os campos preenchidos
  // pelo admin substituem o que veio do blog. Campo em branco = mantém o do blog.
  // Campo com "-" ou "nenhum" = esvazia de propósito.
  function aplicarSobrescrita(resultado, sobre) {
    if (!sobre) return resultado;
    const r = Object.assign({}, resultado);
    const preenchido = (v) => v && v.trim().length > 0;
    const querEsvaziar = (v) => /^(-|nenhum|nenhuma|vazio)$/i.test((v||'').trim());
    // aula de hoje
    if (querEsvaziar(sobre.aula_hoje)) r.aula_hoje = '';
    else if (preenchido(sobre.aula_hoje)) r.aula_hoje = sobre.aula_hoje.trim();
    // matéria do teste
    if (querEsvaziar(sobre.materia_teste)) { r.materia_teste = ''; r.tem_avaliacao = false; }
    else if (preenchido(sobre.materia_teste)) { r.materia_teste = sobre.materia_teste.trim(); r.tem_avaliacao = true; r.materia_teste_data = ''; }
    // deveres pendentes
    if (querEsvaziar(sobre.deveres_pendentes)) r.deveres_pendentes = [];
    else if (preenchido(sobre.deveres_pendentes)) {
      const lista = sobre.deveres_pendentes.split('\n').map(d => d.trim()).filter(Boolean);
      r.deveres_pendentes = lista.length ? [{ data: 'Anotado', deveres: lista }] : [];
    }
    // deveres desta aula
    if (querEsvaziar(sobre.deveres_aula)) r.deveres_aula = [];
    else if (preenchido(sobre.deveres_aula)) {
      r.deveres_aula = sobre.deveres_aula.split('\n').map(d => d.trim()).filter(Boolean);
    }
    // avaliação final MANUAL: guarda o texto para o comMateriais COMPLEMENTAR a do blog
    // (mostra as duas juntas) e aplicar a janela. "-" esvazia (não mostra manual).
    if (querEsvaziar(sobre.avaliacao_manual)) r.avaliacao_manual = '';
    else if (preenchido(sobre.avaliacao_manual)) r.avaliacao_manual = sobre.avaliacao_manual.trim();
    r.manual = true; // marca que teve intervenção manual
    return r;
  }

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
          secoes.push({ materia: sub.m, dados: { ok:false, aula_hoje:'-', materia_teste:'', deveres_pendentes:[], deveres_aula:[] } });
        }
      }
      return Object.assign({}, item, { ok:true, processadoOk:true, combinada:true, secoes,
        aula_hoje:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'', questoes:[] });
    }
    let ultimoErro = '';
    // 0) SOBRESCRITA MANUAL (contingência): guardada para aplicar DEPOIS de processar o
    // blog. Assim a correção é PARCIAL: só os campos preenchidos substituem o blog, o resto
    // continua vindo do blog normalmente. (A aplicação acontece no fim, antes de retornar.)
    const ckSobre = chaveSobrescrita(item.m, dayKey);
    const sobre = sobrescritas[ckSobre] || null;

    // 1) busca o blog uma vez só
    const blogText = await fetchBlog(item.url);
    if (!blogText || blogText.length < 30) {
      // blog indisponível (ex: Blogspot bloqueando). Se houver sobrescrita manual, usa ela
      // (o admin pode ter preenchido tudo). Senão, retorna com aviso, sem travar.
      if (sobre) {
        return aplicarSobrescrita(Object.assign({}, item, { ok:true, processadoOk:true, aula_hoje:'', materia_teste_data:'', materia_teste:'', tem_avaliacao:false, deveres_pendentes:[], deveres_aula:[], resumo:'', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] }), sobre);
      }
      return Object.assign({}, item, { ok:false, processadoOk:false, aula_hoje:'-', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'Não foi possível carregar o blog desta matéria agora. Recarregue em alguns instantes.', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
    }
    // 2) processa com IA, com até 3 tentativas (resiliente a falhas momentâneas da IA)
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const ai = await processWithAI(item.m, item.p, blogText, item.filtro, dataRef, labelDia, item.tipo, item.maxDeveres, item.maxDiasDever, item.formato, item.ignorarAvaliacao, item.testeAulaAnterior, item.testeMarcado, item.interpretacaoComAnterior, item.testeNoDiaExato);
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
        // extrai a AVALIAÇÃO FINAL do blog (conteúdo/matérias da prova). Usa o blog COMPLETO
        // (não o cortado em 7000), porque Filosofia/Inglês põem a prova no INÍCIO do blog.
        // A DECISÃO de exibir (janela ou por data) é feita fora do cache, em comMateriais.
        if (item.avaliacaoFixa) {
          ai.avaliacao_final = item.avaliacaoFixa;
        } else {
          const blogCompleto = await fetchBlogCompleto(item.url);
          ai.avaliacao_final = extrairAvaliacaoFinal(blogCompleto || blogText, item.filtro, item.m, dataRef);
        }
        // VERIFICAÇÃO DE EXTRAÇÃO VAZIA (só formato duasAulas = Linguística): se a IA não
        // trouxe NADA (sem aula, sem deveres, sem teste, sem avaliação) e o blog claramente
        // tinha conteúdo, provavelmente foi uma falha momentânea da IA. Tenta de novo antes de
        // aceitar. Restrito a duasAulas para não gastar chamadas extras em matérias que podem
        // ter dias legitimamente sem aula (ex: Física em dia sem tarefa).
        const resultadoVazio =
          (!ai.aula_hoje || !ai.aula_hoje.trim()) &&
          (!Array.isArray(ai.deveres_aula) || ai.deveres_aula.length === 0) &&
          (!Array.isArray(ai.deveres_pendentes) || ai.deveres_pendentes.length === 0) &&
          (!ai.materia_teste || !ai.materia_teste.trim()) &&
          (!ai.avaliacao_final || !ai.avaliacao_final.trim());
        const blogTinhaConteudo = blogText && blogText.length > 200;
        if (item.formato === 'duasAulas' && resultadoVazio && blogTinhaConteudo && tentativa < 3) {
          // não aceita ainda: espera e tenta de novo (pode ser falha momentânea da IA)
          await new Promise(r => setTimeout(r, 800 * tentativa));
          continue;
        }
        return aplicarSobrescrita(Object.assign({}, item, ai, { ok: true, processadoOk: true }), sobre);
      } catch(e) {
        ultimoErro = e.message;
        // espera um pouco antes de tentar de novo (dá tempo da API se recuperar)
        if (tentativa < 3) await new Promise(r => setTimeout(r, 800 * tentativa));
      }
    }
    // falhou nas 3 tentativas. Se houver sobrescrita, usa ela para não deixar a matéria vazia.
    if (sobre) {
      return aplicarSobrescrita(Object.assign({}, item, { ok:true, processadoOk:true, aula_hoje:'', materia_teste_data:'', materia_teste:'', tem_avaliacao:false, deveres_pendentes:[], deveres_aula:[], resumo:'', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] }), sobre);
    }
    return Object.assign({}, item, { ok:false, processadoOk:false, aula_hoje:'-', materia_teste_data:'', materia_teste:'', deveres_pendentes:[], deveres_aula:[], resumo:'Não foi possível carregar agora. Recarregue a página em alguns segundos.', questoes:[], proxima_aula:'', proxima_resumo:'', proxima_deveres:[] });
  }

  // processa as matérias em PARALELO, mas em lotes de no máximo 3 ao mesmo tempo.
  // Isso é bem mais rápido que uma-por-vez (antes), sem sobrecarregar a IA (o que
  // causava falhas em cascata quando todas rodavam juntas).
  // Matérias que JÁ estão boas no cache são servidas direto (não reprocessam).
  const resultados = new Array(materias.length);
  const LOTE = 3; // matérias simultâneas. O fetch é direto e cacheado, e o cache de blog
  // evita downloads repetidos, então 3 é seguro e mais rápido. Há retry p/ rate limit.

  // anexa os materiais de apoio (links) da matéria ao resultado. Feito FORA do cache,
  // para os links refletirem sempre o estado atual (adicionar/remover aparece na hora).
  function comMateriais(result, item) {
    if (!result) return result;
    const ck = chaveMaterial(item.m);
    const lista = Array.isArray(materiais[ck]) ? materiais[ck] : [];
    const naJanela = dentroDaJanelaAvaliacao();
    // Filosofia (avaliacaoPorData) tem regra PRÓPRIA por data: a extração já decidiu se
    // mostra (comparando a dataRef com a data da prova), então NÃO depende da janela do admin.
    const porData = !!item.avaliacaoPorData;
    const podeExibir = porData ? true : naJanela;
    // COMPLEMENTAR: junta a avaliação do blog com a manual (contingência). Anexa a DATA da
    // prova (cronograma fixo temporário) no início, se houver, dentro da janela.
    const dataProva = naJanela ? dataProvaDe(item.m, dayKey) : '';
    const montarAval = (doBlog, manual) => {
      if (!podeExibir) return '';
      const partes = [];
      if (doBlog && doBlog.trim().length > 3) partes.push(doBlog.trim());
      if (manual && manual.trim().length > 0) partes.push(manual.trim());
      if (!partes.length) return '';
      return partes.join('\n');
    };
    // REGRAS DA SEMANA DE PROVAS (dentro da janela do admin):
    //  - esconde a matéria do testinho (item some do card)
    //  - NÃO gera resumo nem simulado; mostra aviso "Semana de provas (bora estudar!!)"
    const aplicarRegrasProva = (r) => {
      if (!naJanela) return r;
      return Object.assign({}, r, {
        materia_teste: '',            // esconde testinho
        tem_avaliacao: false,
        resumo: '',                   // sem resumo
        questoes: [],                 // sem simulado
        proxima_resumo: '',
        semana_provas: true,          // frontend mostra o aviso "bora estudar"
        data_prova: dataProva || ''   // data da prova (cronograma fixo), se houver
      });
    };
    // card combinado (ex: Redação e Literatura): aplica em CADA seção interna.
    if (result.combinada && Array.isArray(result.secoes)) {
      const secoes = result.secoes.map(sec => {
        const dataProvaSec = naJanela ? dataProvaDe(sec.materia, dayKey) : '';
        let dados = Object.assign({}, sec.dados, {
          avaliacao_final: montarAval(sec.dados && sec.dados.avaliacao_final, sec.dados && sec.dados.avaliacao_manual),
          data_prova: dataProvaSec || ''
        });
        if (naJanela) dados = Object.assign({}, dados, { materia_teste:'', tem_avaliacao:false, resumo:'', questoes:[], semana_provas:true });
        dados = Object.assign({}, dados, { deveres_pendentes: dedupDeveres(dados.deveres_pendentes) });
        return Object.assign({}, sec, { dados });
      });
      let base = Object.assign({}, result, { materiais: lista, secoes });
      if (naJanela) base = Object.assign({}, base, { semana_provas:true });
      return base;
    }
    // card normal
    let base = Object.assign({}, result, {
      materiais: lista,
      avaliacao_final: montarAval(result.avaliacao_final, result.avaliacao_manual)
    });
    // aviso fixo da avaliação (ex: Filosofia = prova com consulta), só quando há avaliação
    if (item.avisoAvaliacao && base.avaliacao_final && base.avaliacao_final.trim()) {
      base.aviso_avaliacao = item.avisoAvaliacao;
    }
    base = aplicarRegrasProva(base);
    base.deveres_pendentes = dedupDeveres(base.deveres_pendentes);
    return base;
  }

  // primeiro, serve as que já estão boas no cache (instantâneo)
  const aProcessar = [];
  for (let i = 0; i < materias.length; i++) {
    if (cacheDia && itemBom(cacheDia[i])) {
      resultados[i] = comMateriais(cacheDia[i], materias[i]);
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:resultados[i], ehPrevia, cached:true }) + '\n\n');
    } else {
      aProcessar.push(i); // precisa processar
    }
  }

  // processa as que faltam, em lotes de LOTE por vez
  for (let inicio = 0; inicio < aProcessar.length; inicio += LOTE) {
    const lote = aProcessar.slice(inicio, inicio + LOTE);
    await Promise.all(lote.map(async (i) => {
      const result = await processarMateria(materias[i]);
      resultados[i] = comMateriais(result, materias[i]);
      res.write('data: ' + JSON.stringify({ type:'result', index:offsetIndex+i, item:resultados[i], ehPrevia }) + '\n\n');
      // salva cada matéria bem-sucedida no cache imediatamente (incremental).
      // guarda SEM os materiais (eles são anexados na leitura, sempre atuais).
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
// cache compartilhado de resumos e simulados, por assunto. O assunto do teste é o mesmo
// para todos os alunos, então geramos UMA vez e reusamos. Isso evita pagar o mesmo
// resumo/simulado várias vezes (um por aluno). Persistido em disco.
const RESUMO_CACHE_FILE = DATA_DIR + '/resumo_cache.json';
let resumoCache = {};
try { resumoCache = JSON.parse(fs.readFileSync(RESUMO_CACHE_FILE, 'utf8')); } catch { resumoCache = {}; }
function salvarResumoCache() {
  try { fs.writeFileSync(RESUMO_CACHE_FILE, JSON.stringify(resumoCache)); } catch {}
}
function chaveAssunto(tipo, materia, assunto) {
  return (tipo + '|' + materia + '|' + assunto).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 250);
}

// Decide se dá para gerar um SIMULADO de questões sobre a matéria do teste. Alguns
// "assuntos" não são avaliáveis (não dá pra fazer questões sobre eles): revisão,
// resolução/correção de simulado ou prova, interpretação de texto, e o aviso "vamos
// estudar isso também". A regra: remove esses termos; se sobrar um assunto real, o
// EXTRAI a AVALIAÇÃO FINAL do 2º bimestre do blog de uma matéria. Retorna o conteúdo/matérias
// da prova, ou '' se o professor ainda não publicou. Ignora avaliações do 1º bimestre.
function extrairAvaliacaoFinal(blogText, filtro, materia, dataRef) {
  if (!blogText) return '';
  // no blog do Fábio (Redação+Literatura), a avaliação é de LITERATURA. Se o filtro for
  // Redação, não retorna nada. Se for Literatura (ou sem filtro), usa o texto.
  if (filtro && /reda[çc][ãa]o/i.test(filtro)) return '';

  const limpa = (t) => (t || '')
    .replace(/&#\d+;/g, ' ')       // entidades html (ex: &#8211;)
    .replace(/&nbsp;/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ') // remove qualquer URL (link do Drive, etc.) do texto
    .replace(/^[\s\-–:•]+/, '')
    .replace(/[\s\-–:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const m = (materia || '').toLowerCase();

  // corta o texto no primeiro link/marcador de fim, ANTES de qualquer extração específica.
  // (protege contra blogs que colam o link do Drive logo após o conteúdo da avaliação.)
  const cortarNoLink = (t) => (t || '').split(/https?:\/\//i)[0];

  // ── INGLÊS: "Matérias para 2° bim: Simple past, Past Continuous e Past Perfect."
  if (/ingl[êe]s/.test(m)) {
    // corta tudo a partir do primeiro link, para o Drive nunca entrar na avaliação.
    const base = cortarNoLink(blogText);
    const r = base.match(/mat[ée]rias?\s+para\s+2[º°o]?\s*bim[^:]*:\s*([^_\n]{5,180}?)(?:\s+revis[ãa]o|\s+JULHO|\s+JULY|$)/i);
    return r ? limpa(r[1]) : '';
  }

  // ── GEOGRAFIA: pega a ÚLTIMA "MATÉRIA: Revisão para avaliação / PÁGINAS: X"
  // (a última é a do 2º bimestre; a primeira é do 1º).
  if (/geografia/.test(m)) {
    const todas = [...blogText.matchAll(/mat[ée]ria:\s*revis[ãa]o\s+para\s+avalia[çc][ãa]o\s*(?:p[áa]ginas?:\s*([^_\n]{3,120}?))?(?:tarefa|material|_|$)/gi)];
    if (todas.length) {
      const ultima = todas[todas.length - 1];
      const paginas = ultima[1] ? limpa(ultima[1]) : '';
      return paginas ? ('Revisão para avaliação: ' + paginas) : 'Revisão para avaliação';
    }
    return '';
  }

  // ── FILOSOFIA: regra PRÓPRIA por data (ignora a janela do admin). Cada avaliação aparece
  // quando a data de referência do app (dataRef, que na prévia de fim de semana já aponta
  // para a segunda seguinte) é IGUAL à data da avaliação. Como as provas caem na segunda e a
  // prévia de sáb/dom já mira a segunda, a avaliação aparece sáb+dom+segunda e some depois.
  if (/filosofia/.test(m)) {
    const refNum = dataParaNum(dataRef || '');
    // pega só o topo (antes do "1º Bimestre", que é o histórico do 1º bim)
    const topo = blogText.split(/1[º°o]?\s*bimestre/i)[0] || blogText;
    const pedacos = topo.split(/(?=data:\s*\d{1,2}\/\d{1,2})/i);
    const achados = [];
    for (const p of pedacos) {
      const md = p.match(/data:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      const mc = p.match(/atividade\s+avaliativa\s*(?:valor:\s*[\d,]+\s*)?conte[úu]do:\s*([^_\n]{5,180})/i);
      if (md && mc) achados.push({ num: dataParaNum(md[1]), conteudo: limpa(mc[1]) });
    }
    if (!achados.length) return '';
    // mostra SÓ a avaliação cuja data é igual à dataRef (o app já resolve a prévia).
    const doDia = achados.find(a => a.num === refNum);
    return doDia ? doDia.conteudo : '';
  }

  // ── LITERATURA (blog do Fábio): "Conteúdo da avaliação bimestral: ... conteúdos: X"
  if (filtro && /literatura/i.test(filtro)) {
    const r = blogText.match(/conte[úu]do\s+d[ae]\s+avalia[çc][ãa]o\s+bimestral\s*:\s*(?:[^:_\n]*?conte[úu]dos?\s*:\s*)?([^_\n]{5,220})/i);
    if (r && r[1]) {
      let c = limpa(r[1]).replace(/^a\s+sua\s+avalia[çc][ãa]o.*?conte[úu]dos?\s*:?\s*/i, '').trim();
      return c.length >= 5 ? c : '';
    }
    return '';
  }

  // ── DEMAIS MATÉRIAS: padrão genérico do 2º bimestre (Química B Gois, etc.).
  // IMPORTANTE: exige menção ao 2º bimestre para NÃO pegar avaliação do 1º (ex: Biologia,
  // que só tem "avaliação bimestral" do 1º no histórico -> não retorna nada).
  const padroes = [
    /avalia[çc][ãa]o[^:_\n]*?\b2[º°o]?\s*bimestre\s*:?\s*([^_\n]{5,220})/i,
    /conte[úu]do[^:_\n]*?avalia[çc][ãa]o[^:_\n]*?\b2[º°o]?\s*bim[^:_\n]*?:\s*([^_\n]{5,220})/i,
  ];
  for (const re of padroes) {
    const mm = blogText.match(re);
    if (mm && mm[1]) {
      let conteudo = mm[1]
        .replace(/bons\s+estudos.*$/i, '')
        .replace(/\baula\s+\d+.*$/i, '')
        .replace(/\b\d{1,2}\/\d{1,2}\b.*$/i, '')
        .replace(/\bteste\s*\d+.*$/i, '');
      conteudo = limpa(conteudo);
      if (conteudo.length >= 5) return conteudo;
    }
  }
  return '';
}

// simulado é gerado SOBRE ESSE ASSUNTO limpo. Se não sobrar nada, retorna '' (sem simulado).
// O resumo NÃO usa isso: ele sempre aparece.
function assuntoAvaliavel(materiaTeste) {
  if (!materiaTeste) return '';
  // Uma parte é "sem nexo" (não avaliável) quando COMEÇA com um destes termos e NÃO é
  // seguida de um conectivo (de/da/do/sobre) que ligue a uma matéria real.
  // Ex: "Revisão" ou "Resolução do simulado Somos" -> sem nexo (bloqueia).
  //     "Revisão de Parnasianismo" -> tem conectivo + matéria -> avaliável (gera).
  // Termos que, se vierem sozinhos ou com lixo solto, bloqueiam o simulado:
  const termosSemNexo = [
    /^revis[ãa]o(\s+geral)?\b/i,
    /^resolu[çc][ãa]o\s+d[eo]\s+(simulado|prova|avalia[çc][ãa]o|teste)s?\b/i,
    /^corre[çc][ãa]o\s+d[eo]\s+(simulado|prova|avalia[çc][ãa]o|teste)s?\b/i,
    /^interpreta[çc][ãa]o\s+de\s+texto\b/i,
    /^simulad[oa]s?\b/i,
  ];
  // conectivo que indica "tem matéria real depois" (ex: "revisão DE Parnasianismo")
  const temConectivoComMateria = (p) => /\b(de|da|do|dos|das|sobre)\s+\S{3,}/i.test(p);

  const ehSemNexo = (parte) => {
    const p = parte.trim();
    // "interpretação de texto" tem "de", mas é sempre sem nexo (o "texto" não é matéria).
    if (/^interpreta[çc][ãa]o\s+de\s+texto\b/i.test(p)) return true;
    for (const re of termosSemNexo) {
      if (re.test(p)) {
        // começa com termo sem nexo. Remove o termo e vê se sobra "conectivo + matéria".
        // Ex: "Revisão de Parnasianismo" -> resto "de Parnasianismo" -> tem matéria -> avaliável.
        //     "Resolução do simulado Somos" -> resto "Somos" -> sem conectivo -> sem nexo.
        const resto = p.replace(re, '').trim();
        return !temConectivoComMateria(resto);
      }
    }
    return false; // não começa com termo sem nexo -> é matéria normal
  };

  const partes = materiaTeste
    .split(/\s*[;,.]\s*|\s*\bvamos estudar isso também:\s*/i)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.replace(/^vamos\s+estudar\s+isso\s+tamb[ée]m\s*:?\s*/i, '').trim())
    .filter(Boolean)
    .filter(p => !ehSemNexo(p));
  return partes.join('; ').trim();
}

app.post('/api/resumo', rateLimitGeral, auth, async (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60);
  const assunto = (req.body.assunto || '').slice(0, 300);
  if (!assunto) return res.json({ resumo: '' });
  const ck = chaveAssunto('resumo', materia, assunto);
  // já tem no cache compartilhado? devolve sem gastar IA
  if (resumoCache[ck]) return res.json({ resumo: resumoCache[ck], cached: true });
  try {
    const prompt = 'Você é um tutor de ' + materia + ' do ensino médio brasileiro. ' +
      'O aluno tem um teste sobre: "' + assunto + '".\n' +
      'Faça um RESUMO didático de 3-4 parágrafos sobre esse conteúdo, claro e objetivo para revisão.\n' +
      'Responda APENAS JSON sem markdown:\n{"resumo":"texto"}';
    const r = await callAnthropic(prompt, 0);
    const resumo = r.resumo || '';
    if (resumo) { resumoCache[ck] = resumo; salvarResumoCache(); }
    res.json({ resumo });
  } catch (e) {
    res.json({ resumo: '' });
  }
});

app.post('/api/simulado', rateLimitGeral, auth, async (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60);
  const materiaTeste = (req.body.materiaTeste || '').slice(0, 300);
  if (!materiaTeste) return res.json({ questoes: [] });
  // filtra conteúdo não-avaliável (revisão, resolução de simulado, interpretação de texto).
  // Gera o simulado só sobre o assunto real que sobrar.
  const assunto = assuntoAvaliavel(materiaTeste);
  if (!assunto) return res.json({ questoes: [], semSimulado: true });
  const ck = chaveAssunto('simulado', materia, assunto);
  if (resumoCache[ck]) return res.json({ questoes: resumoCache[ck], cached: true });
  try {
    const prompt = 'Você é um tutor de ' + materia + ' do ensino médio brasileiro. ' +
      'Crie um simulado sobre: "' + assunto + '".\n' +
      '4 questões de múltipla escolha (A-D), com a resposta correta e uma explicação curta.\n' +
      'Responda APENAS JSON sem markdown:\n' +
      '{"questoes":[{"enunciado":"","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":""}]}';
    const r = await callAnthropic(prompt, 0);
    const questoes = Array.isArray(r.questoes) ? r.questoes : [];
    if (questoes.length) { resumoCache[ck] = questoes; salvarResumoCache(); }
    res.json({ questoes });
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

// ── SOBRESCRITAS MANUAIS (contingência) ──────────────────────────────────────
// lista as matérias disponíveis (matéria + dia) para o admin escolher, e as sobrescritas ativas
app.get('/api/admin/materias', checkAdmin, (req, res) => {
  const lista = [];
  for (const dia of Object.keys(GRADE)) {
    for (const m of GRADE[dia]) {
      lista.push({ materia: m.m, professor: m.p, dia, chave: chaveSobrescrita(m.m, dia) });
    }
  }
  res.json({ materias: lista, sobrescritas });
});

// cria ou atualiza uma sobrescrita manual
app.post('/api/admin/sobrescrever', checkAdmin, (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60).trim();
  const dia = (req.body.dia || '').slice(0, 3).trim();
  const aula_hoje = (req.body.aula_hoje || '').slice(0, 2500).trim();
  const materia_teste = (req.body.materia_teste || '').slice(0, 1000).trim();
  const deveres_pendentes = (req.body.deveres_pendentes || '').slice(0, 2000).trim();
  const deveres_aula = (req.body.deveres_aula || '').slice(0, 2000).trim();
  const avaliacao_manual = (req.body.avaliacao_manual || '').slice(0, 1500).trim();
  if (!materia || !dia) return res.json({ error: 'Informe matéria e dia.' });
  if (!aula_hoje && !materia_teste && !deveres_pendentes && !deveres_aula && !avaliacao_manual) return res.json({ error: 'Preencha ao menos um campo.' });
  const chave = chaveSobrescrita(materia, dia);
  sobrescritas[chave] = {
    materia, dia, aula_hoje, materia_teste, deveres_pendentes, deveres_aula, avaliacao_manual,
    criadoEm: new Date().toISOString()
  };
  salvarSobrescritas();
  // limpa o cache do dia para a sobrescrita valer já
  for (const k of Object.keys(cache)) { if (k.endsWith('_' + dia)) delete cache[k]; }
  salvarCache();
  res.json({ ok: true, mensagem: 'Sobrescrita salva. Os alunos já verão o conteúdo manual.' });
});

// remove uma sobrescrita (volta a ler o blog normalmente)
app.post('/api/admin/remover-sobrescrita', checkAdmin, (req, res) => {
  const chave = (req.body.chave || '').toLowerCase().trim();
  if (sobrescritas[chave]) {
    const dia = sobrescritas[chave].dia;
    delete sobrescritas[chave];
    salvarSobrescritas();
    for (const k of Object.keys(cache)) { if (k.endsWith('_' + dia)) delete cache[k]; }
    salvarCache();
    return res.json({ ok: true, mensagem: 'Sobrescrita removida. Voltou a ler o blog.' });
  }
  res.json({ error: 'Sobrescrita não encontrada.' });
});

// ── LOG DE SEGURANÇA (ver últimos eventos) ───────────────────────────────────
app.get('/api/admin/seguranca', checkAdmin, (req, res) => {
  try {
    if (!fs.existsSync(LOG_SEG_FILE)) return res.json({ eventos: [] });
    const linhas = fs.readFileSync(LOG_SEG_FILE, 'utf8').split('\n').filter(Boolean);
    // devolve os últimos 100 eventos, mais recentes primeiro
    const eventos = linhas.slice(-100).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ eventos });
  } catch (e) { res.json({ eventos: [], erro: e.message }); }
});

// ── AVALIAÇÃO FINAL DO BIMESTRE (janela de exibição) ─────────────────────────
app.get('/api/admin/janela-avaliacao', checkAdmin, (req, res) => {
  res.json({ janela: janelaAvaliacao, ativaHoje: dentroDaJanelaAvaliacao() });
});
app.post('/api/admin/definir-janela-avaliacao', checkAdmin, (req, res) => {
  const inicio = (req.body.inicio || '').trim();
  const fim = (req.body.fim || '').trim();
  const valida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!valida(inicio) || !valida(fim)) return res.json({ error: 'Datas inválidas. Use o seletor de data.' });
  if (fim < inicio) return res.json({ error: 'A data final não pode ser antes da inicial.' });
  janelaAvaliacao = { inicio, fim };
  salvarJanelaAvaliacao();
  res.json({ ok: true, mensagem: 'Janela da avaliação final definida.', janela: janelaAvaliacao });
});
app.post('/api/admin/limpar-janela-avaliacao', checkAdmin, (req, res) => {
  janelaAvaliacao = { inicio: '', fim: '' };
  salvarJanelaAvaliacao();
  res.json({ ok: true, mensagem: 'Janela removida. O bloco de avaliação não aparece mais.' });
});

// ── MATERIAIS DE APOIO (links de arquivos por matéria) ───────────────────────
// lista todos os materiais cadastrados (agrupados por matéria)
app.get('/api/admin/materiais', checkAdmin, (req, res) => {
  res.json({ materiais });
});

// adiciona um link de material a uma matéria (máximo 3 por matéria)
app.post('/api/admin/adicionar-material', checkAdmin, (req, res) => {
  const materia = (req.body.materia || '').slice(0, 60).trim();
  const url = (req.body.url || '').slice(0, 500).trim();
  const descricao = (req.body.descricao || '').slice(0, 200).trim();
  if (!materia) return res.json({ error: 'Escolha a matéria.' });
  if (!url) return res.json({ error: 'Informe o link do arquivo.' });
  if (!/^https?:\/\//i.test(url)) return res.json({ error: 'O link deve começar com http:// ou https://' });
  const ck = chaveMaterial(materia);
  if (!Array.isArray(materiais[ck])) materiais[ck] = [];
  if (materiais[ck].length >= 3) return res.json({ error: 'Máximo de 3 arquivos por matéria. Remova um antes de adicionar outro.' });
  materiais[ck].push({ id: Date.now().toString(36), materia, url, descricao: descricao || 'Material de apoio' });
  salvarMateriais();
  res.json({ ok: true, mensagem: 'Material adicionado.' });
});

// remove um material específico pelo id
app.post('/api/admin/remover-material', checkAdmin, (req, res) => {
  const materia = (req.body.materia || '').trim();
  const id = (req.body.id || '').trim();
  const ck = chaveMaterial(materia);
  if (Array.isArray(materiais[ck])) {
    materiais[ck] = materiais[ck].filter(m => m.id !== id);
    if (!materiais[ck].length) delete materiais[ck];
    salvarMateriais();
    return res.json({ ok: true, mensagem: 'Material removido.' });
  }
  res.json({ error: 'Material não encontrado.' });
});

app.get('/api/today', rateLimitGeral, auth, async function(req, res) {
  const dayMap = { 1:'seg', 2:'ter', 3:'qua', 4:'qui', 5:'sex' };
  const ordem = ['seg','ter','qua','qui','sex'];
  const hojeDay = agoraEfetivo().getUTCDay();

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
  const hojeISO = isoEfetivo();
  Object.keys(cache).forEach(k => {
    if (!k.startsWith(hojeISO)) delete cache[k];
  });
  salvarCache();

  res.write('data: ' + JSON.stringify({ type:'done' }) + '\n\n');
  res.end();
});

// ── limpa todo o cache manualmente (forçar reprocessamento) ──────────────────
// uso: /api/limpar-cache?senha=ADMIN_SENHA
app.get('/api/limpar-cache', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido';
  if (!checarRateLimit(ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
  }
  if (!senhaIgual(req.query.senha || '', process.env.ADMIN_SENHA)) {
    registrarFalha(ip);
    return res.status(401).json({ error: 'senha invalida' });
  }
  const qtd = Object.keys(cache).length;
  for (const k of Object.keys(cache)) delete cache[k];
  salvarCache();
  res.json({ ok: true, chavesRemovidas: qtd, mensagem: 'Cache limpo. Recarregue o app para reprocessar.' });
});

// ── DIAGNÓSTICO: mostra o texto CRU que o app leu de cada blog, para depurar
// quando uma matéria não puxa a aula/dever (ex: o professor mudou o formato do blog).
// Protegido pela senha de admin (mesmo padrão do /api/limpar-cache). Uso:
//   /diag?senha=ADMIN_SENHA                       -> lista os dias e as matérias
//   /diag?senha=ADMIN_SENHA&dia=ter               -> todas as matérias de terça
//   /diag?senha=ADMIN_SENHA&dia=ter&materia=quim  -> só a que casar com "quim"
//   /diag?senha=ADMIN_SENHA&materia=historia      -> busca em todos os dias
app.get('/diag', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecido';
  if (!checarRateLimit(ip)) {
    return res.status(429).type('text/plain; charset=utf-8').send('Muitas tentativas. Aguarde 1 minuto.');
  }
  if (!senhaIgual(req.query.senha || '', process.env.ADMIN_SENHA)) {
    registrarFalha(ip);
    return res.status(401).type('text/plain; charset=utf-8').send('senha invalida');
  }
  res.type('text/plain; charset=utf-8');

  const normalizar = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const dia = (req.query.dia || '').toString().trim().toLowerCase();
  const materiaFiltro = (req.query.materia || '').toString().trim();

  // sem filtro: mostra o menu do que dá para pedir
  if (!dia && !materiaFiltro) {
    let menu = 'DIAG - o que inspecionar\n\n';
    menu += 'Uso: /diag?senha=SUA_SENHA&dia=DIA&materia=PARTE_DO_NOME\n';
    menu += '(dia e materia sao opcionais; materia casa por pedaco do nome, sem acento)\n\n';
    for (const dk of Object.keys(GRADE)) {
      const nomes = (GRADE[dk]||[]).flatMap(it => Array.isArray(it.combinar) ? it.combinar.map(s=>s.m) : [it.m]);
      menu += dk + ': ' + nomes.join(', ') + '\n';
    }
    return res.send(menu);
  }

  // coleta os itens que casam com o filtro
  const alvos = [];
  const dias = dia ? [dia] : Object.keys(GRADE);
  for (const dk of dias) {
    for (const it of (GRADE[dk] || [])) {
      const subs = Array.isArray(it.combinar) ? it.combinar : [it];
      for (const s of subs) {
        if (materiaFiltro && !normalizar(s.m).includes(normalizar(materiaFiltro))) continue;
        alvos.push({ dia: dk, item: s });
      }
    }
  }
  if (!alvos.length) {
    return res.send('Nada encontrado para dia="' + dia + '" materia="' + materiaFiltro + '".\nChame /diag?senha=... sem filtros para ver o menu.');
  }

  const SEP = '==================================================';
  const sub = '--------------------------------------------------';
  const modoRaw = /^(1|true|sim|yes)$/i.test((req.query.raw || '').toString().trim());
  const linhas = [];
  for (const { dia: dk, item } of alvos) {
    const dataRef = dataDoDia(dk);
    linhas.push(SEP);
    linhas.push('MATERIA: ' + item.m + '  (' + (item.p || '?') + ')  [dia: ' + dk + ']');
    linhas.push('URL: ' + item.url);
    linhas.push('formato/tipo: ' + (item.formato || item.tipo || 'padrao'));
    linhas.push('Hoje (efetivo): ' + hojeStr() + '   |   Data de referencia desta materia (' + dk + '): ' + dataRef);
    linhas.push(sub);
    if (modoRaw) {
      // modo raw: mostra o HTML CRU que o app recebe, ANTES da limpeza. Serve para
      // descobrir se o conteudo esta no HTML (limpeza comendo) ou vem por fora (iframe/JS).
      let html = null;
      try { html = await obterHtml(item.url); } catch (e) { linhas.push('ERRO obterHtml: ' + (e && e.message ? e.message : e)); }
      if (!html) {
        linhas.push('(obterHtml nao retornou nada - todas as estrategias falharam)');
      } else {
        linhas.push('Estrategia que funcionou: ' + ultimaEstrategia);
        linhas.push('Tamanho do HTML cru: ' + html.length + ' chars');
        const iframes = [...html.matchAll(/<iframe[^>]*\ssrc=["']([^"']+)["']/gi)].map(m => m[1]);
        linhas.push('iframes/embeds encontrados: ' + iframes.length);
        iframes.slice(0, 10).forEach(s => linhas.push('  - ' + s));
        const tem = (re) => re.test(html) ? 'SIM' : 'NAO';
        linhas.push('conteudo no HTML cru?  "Data:"=' + tem(/Data:/i) + '  "Aula:"=' + tem(/Aula:/i) + '  "Prova"=' + tem(/Prova/i) + '  "Materia"=' + tem(/Mat[ée]ria/i));
        linhas.push(sub);
        linhas.push('TRECHO DO HTML CRU (~6000 chars a partir do conteudo):');
        let alvoIdx = html.search(/Data:\s*\d|Aula:\s*\d|Prova\s+Bimestral/i);
        if (alvoIdx < 0) { const b = html.search(/<body/i); alvoIdx = b >= 0 ? b : 0; }
        const ini = Math.max(0, alvoIdx - 500);
        linhas.push(html.slice(ini, ini + 6000));
      }
      linhas.push(SEP);
      linhas.push('');
      continue;
    }
    let cortado = null, completo = null;
    try {
      cortado = await fetchBlog(item.url);
      completo = await fetchBlogCompleto(item.url);
    } catch (e) {
      linhas.push('ERRO ao buscar o blog: ' + (e && e.message ? e.message : e));
    }
    if (!cortado && !completo) {
      linhas.push('(blog nao retornou texto - todas as estrategias de busca falharam)');
    } else {
      linhas.push('TEXTO CRU (cortado - o que o parser de aula ve, ultimos 7000 chars):');
      linhas.push(cortado || '(vazio)');
      linhas.push(sub);
      if (completo && completo !== cortado) {
        linhas.push('TEXTO CRU (completo):');
        linhas.push(completo);
      } else {
        linhas.push('TEXTO CRU (completo): igual ao cortado.');
      }
    }
    linhas.push(SEP);
    linhas.push('');
  }
  res.send(linhas.join('\n'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── serve arquivos estáticos só depois das rotas de API ──────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Rodando na porta ' + PORT); });
