# Arquitetura - Meu Estudo

## Visão geral

Meu Estudo é um micro-SaaS em Node.js/Express que agrega blogs Blogspot de professores do CNS Anglo e transforma conteúdo disperso em uma visão diária de estudo para alunos.

O app hoje é single-turma. A `GRADE` é fixa no código e todos os alunos veem a mesma grade.

## Backend

Arquivo principal: `server.js`.

Responsabilidades:

- Servir frontend e rotas administrativas.
- Buscar HTML dos blogs dos professores.
- Limpar HTML do Blogspot.
- Processar conteúdo por matéria.
- Chamar IA quando necessário.
- Fazer cache por dia e por assunto.
- Expor endpoints como `/api/redacao`, `/api/resumo`, `/api/simulado`, `/diag`.

## Frontend

Arquivo principal: `index.html`.

Responsabilidades:

- Renderizar visão diária das aulas.
- Receber resultados via SSE.
- Exibir cards de matérias, deveres, prévias e materiais.
- Salvar estado de dever feito no `localStorage`.
- Exibir Central de Deveres.
- Exibir overlays, como reporte de erro e correção de redação.

## Fluxo de leitura de matéria

1. A `GRADE` define matéria, professor, URL, formato e filtros.
2. `fetchBlog(url)` busca o HTML.
3. `obterHtml()` tenta acesso direto e proxies.
4. `limparHtmlBlog(html, removerBlocos)` remove ruído do Blogspot.
5. O texto é cortado com estratégia topo+fim quando grande demais.
6. O resultado entra no cache de blog.
7. O processador específico da matéria extrai aula, dever e datas.
8. `comMateriais` aplica regras universais de exibição.
9. O frontend recebe por SSE e renderiza.

## Limpeza de HTML

A função `limparHtmlBlog` tem dois modos:

- Modo agressivo: remove blocos de compartilhamento, rodapé, menu e ruído.
- Modo suave: remove apenas script/style e preserva mais conteúdo.

Regra crítica: se o agressivo devolver muito menos texto que o suave, usar o suave para evitar apagar o corpo inteiro do blog.

## Corte de texto

Regra atual:

- Se texto limpo ≤ 12000 caracteres: manter tudo.
- Se passar disso: manter primeiros 5000 + últimos 7000.

Motivo: alguns blogs colocam conteúdo novo no topo, outros no fim. Cortar só o fim pode apagar o que importa.

## Processadores por matéria

### IA como principal

- História: `processarHistoria`.
- Física: `processarFisica`.
- Redação: formato agrupado.
- Geografia, Biologia, Química A e Literatura: formato tabela/padrão.

### Regex como principal, IA como reserva

- Linguística: `processarDuasAulas` com `parseAulasRegex`.
- Matemática A: formato `rotulado`, com fallback determinístico já testado.

### Regex puro

- Química B: `processarTestesPorData`.
- Matemática B: `rotulosSaulo`.
- Filosofia e Inglês: `provaFinal`.
- Programação Lidere: `soDever`.

## Datas

`dataParaNum('DD/MM')` transforma datas em número AAAAMMDD. Isso evita bug com `8/07` vs `08/07`.

`agoraEfetivo()` e `isoEfetivo()` fazem a virada do dia às 22:30 no horário de Brasília, independentemente do fuso da Railway.

## Cache

- `blogCache`: cache de blog por cerca de 10 minutos.
- `cacheDia`: cache de extração por dia, chave baseada em `isoEfetivo()+dayKey`.
- `resumoCache`: cache de resumo/simulado por assunto.
- Redação tem cache próprio por hash de texto.

Cache reduz custo de IA porque a extração principal roda aproximadamente uma vez por dia por matéria, não uma vez por aluno.

## Diagnóstico

Rota crítica:

`/diag?senha=SENHA&dia=DIA&materia=SUBSTR&raw=1`

Uso:

- Ver texto cru/limpo de uma matéria.
- Confirmar se o blog chegou vazio.
- Confirmar se a limpeza removeu conteúdo demais.
- Confirmar se o parser recebeu conteúdo suficiente.

Regra de segurança: nunca colar link com `senha=` no chat. Apagar a senha antes.
