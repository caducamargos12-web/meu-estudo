# Bugs resolvidos - Meu Estudo

Este arquivo registra bugs já investigados e resolvidos para evitar repetir investigação.

## 1. Comparação de data por string

Problema: blogs escrevem datas como `8/07` e `08/07`. Comparação por string falhava.

Solução: usar `dataParaNum` e `.num` em comparações.

## 2. Corte de footer da Linguística

Problema: `parseAulasRegex` incluía lixo de rodapé/menu do Blogger no corpo da última aula.

Solução: cortar rodapé adequadamente antes de processar.

## 3. Deveres duplicados

Problema: deveres apareciam duplicados por matéria.

Solução: `dedupDeveres` remove duplicatas.

## 4. Virada de dia no fuso errado

Problema: Railway usa UTC. Leituras de "hoje" dependiam do relógio do servidor e viravam errado.

Solução: `agoraEfetivo()` e `isoEfetivo()` viram o dia às 22:30 no horário de Brasília.

## 5. Falta de ferramenta de diagnóstico

Problema: era difícil depurar blogs sem acesso direto ao conteúdo real.

Solução: criação da rota protegida `/diag`.

## 6. Corte do texto mantinha só final

Problema: `fetchBlog` mantinha só os últimos 7000 caracteres, assumindo conteúdo novo no fim. Blogs como Tiago/Saulo colocam conteúdo novo no topo.

Solução: se texto ≤ 12000 caracteres, manter tudo. Se maior, manter primeiros 5000 + últimos 7000.

## 7. Limpeza agressiva apagava corpo da Matemática A

Problema: a página da Matemática A tem HTML muito aninhado. A limpeza agressiva estava removendo o corpo inteiro.

Solução: `limparHtmlBlog(html, removerBlocos)` compara modo agressivo e suave. Se o suave for muito maior, usa o suave.

## 8. Parser de Química B reconhecia só TESTE

Problema: `processarTestesPorData` só reconhecia entradas como `DD/MM - TESTE N`, ignorando PROVA BIMESTRAL, RAA e tópicos simples.

Solução: parser ampliado para reconhecer qualquer entrada com data. A matéria do teste continua olhando apenas testes para não misturar prova/RAA.

## 9. Linhas em branco excessivas

Problema: HTML aninhado gerava dezenas de linhas vazias, aumentando custo e ruído para IA.

Solução: colapso de linhas em branco na limpeza.

## 10. Rodapé/menu do Blogspot enviado para IA

Problema: trechos como `Postagens (Atom)`, `Arquivo do blog`, `Pesquisar este blog` e outros eram enviados para IA.

Solução: cortar no primeiro marcador inequívoco de rodapé, com trava de segurança para não cortar cedo demais.

## 11. Matemática A dependia demais da IA

Problema: a IA falhava ao transformar texto correto da Matemática A em dados estruturados.

Solução: fallback determinístico por regex extrai bloco `DATA: <ref> CONTEÚDO: ...`, decodifica entidades HTML, trata TAREFA/PÁGINA/PLURALL, ignora eventos escolares e lixo.

Pendente: após validação real em tela, considerar tornar esse parser determinístico o caminho primário, não apenas fallback.

## Diagnósticos por matéria

### Matemática A

Causas acumuladas já resolvidas:

- Limpeza apagava corpo.
- Corte descartava topo.
- IA falhava na extração.

Texto confirmado correto via `/diag`, mas aula de hoje em tela ainda precisa ser confirmada pelo usuário.

### Química B

Blog lia corretamente. Problema era parser estreito demais. Confirmar em tela em agosto, quando houver conteúdo real com PROVA/RAA.

### História

Problema temporário veio do próprio blog do professor vazio. Depois ele recolocou o conteúdo. Nenhum fix de código foi necessário.

Atenção: História usa a URL `https://profgustavocnsanglo.blogspot.com/p/9-ano.html`. Não confundir com `_4.html`.
