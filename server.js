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
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html' },
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
    { m:'Práticas/Red.',  p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html' },
  ],
  sex: [
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Literatura',     p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html' },
    { m:'Sociologia',     p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html' },
  ],
};

const DIAS_PT = { seg:'Segunda', ter:'Terça', qua:'Quarta', qui:'Quinta', sex:'Sexta' };

// ── busca blog ──────────────────────────────────────────────────────────────
async function fetchBlog(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudyBot/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s{3,}/g, '\n').trim()
      .slice(0, 3000);
  } catch { return null; }
}

// ── chama Anthropic API ─────────────────────────────────────────────────────
async function processWithAI(materia, professor, blogText) {
  const temConteudo = blogText && blogText.length > 50;
  const prompt = `Você é um tutor do ensino médio brasileiro. Analise o conteúdo do blog do professor ${professor} de ${materia}.

${temConteudo ? `CONTEÚDO DO BLOG:\n${blogText}` : `Sem conteúdo disponível. Use conhecimento geral de ${materia} para o 3º ano do EM.`}

Responda APENAS JSON válido sem markdown:
{
  "ultima_aula": "data e conteúdo da última aula em 1-2 linhas",
  "deveres": ["dever 1", "dever 2"],
  "resumo": "resumo didático da última aula em 3-4 parágrafos para estudar para o teste",
  "questoes": [
    {"enunciado":"texto","opcoes":{"A":"","B":"","C":"","D":""},"correta":"A","explicacao":"texto"}
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await res.json();
  const raw = data.content?.map(i => i.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── rota API – streaming de resultados ───────────────────────────────────────
app.get('/api/today', async (req, res) => {
  const dayMap = { 1:'seg', 2:'ter', 3:'qua', 4:'qui', 5:'sex' };
  const dayKey = req.query.day || dayMap[new Date().getDay()] || 'seg';
  const materias = GRADE[dayKey];
  if (!materias) return res.json({ error: 'Dia inválido' });

  // SSE para enviar cada matéria conforme fica pronta
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write(`data: ${JSON.stringify({ type:'start', day:dayKey, dayLabel:DIAS_PT[dayKey], total:materias.length })}\n\n`);

  for (let i = 0; i < materias.length; i++) {
    const item = materias[i];
    res.write(`data: ${JSON.stringify({ type:'loading', index:i, materia:item.m })}\n\n`);
    const blogText = await fetchBlog(item.url);
    try {
      const ai = await processWithAI(item.m, item.p, blogText);
      res.write(`data: ${JSON.stringify({ type:'result', index:i, item:{ ...item, ...ai, ok:true } })}\n\n`);
    } catch {
      res.write(`data: ${JSON.stringify({ type:'result', index:i, item:{ ...item, ok:false, ultima_aula:'—', deveres:[], resumo:'Erro ao processar.', questoes:[] } })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ type:'done' })}\n\n`);
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
