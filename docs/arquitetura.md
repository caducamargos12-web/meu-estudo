# Arquitetura - Meu Estudo

## Visão geral

Meu Estudo é um micro-SaaS em Node.js/Express que agrega blogs Blogspot de professores do CNS Anglo e transforma conteúdo disperso em uma visão diária de estudo para alunos.

A arquitetura atual está preparada para multi-turma na Fase 2A. A única turma cadastrada ainda é o `3-ano`, mas o fluxo principal já resolve a grade pela turma do aluno com fallback seguro.

## Backend

Arquivo principal: `server.js`.

Responsabilidades:

- Servir frontend e rotas administrativas.
- Buscar HTML dos blogs dos professores.
- Limpar HTML do Blogspot.
- Processar conteúdo por matéria.
- Chamar IA quando necessário.
- Fazer cache por dia, turma e assunto.
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
- Guardar em memória a turma atual recebida no evento SSE `start`.

## Turmas e grade

A grade original do 3º ano foi separada como `GRADE_3_ANO`.

A Fase 2A adicionou em `server.js`:

- `TURMA_PADRAO = '3-ano'`.
- `TURMAS` inline, inicialmente com apenas `3-ano`.
- Helpers de turma e grade:
  - `turmaValida(turmaId)`.
  - `getTurmaPorId(turmaId)`.
  - `getGradePorId(turmaId)`.
  - `getTurmaIdDoUsuario(user)`.
  - `getGradeDoUsuario(user)`.

Regra de compatibilidade:

- Usuário antigo sem campo `turma` cai em `3-ano`.
- Turma ausente ou inválida cai em `3-ano`.
- Nenhuma turma piloto foi adicionada na Fase 2A.

## Fluxo de leitura de matéria

1. `/api/today` autentica o aluno e lê `req.user`.
2. O backend busca o registro em `alunos[req.user]`.
3. `getTurmaIdDoUsuario(aluno)` resolve a turma com fallback para `3-ano`.
4. `getGradePorId(turmaId)` resolve a grade.
5. `processarDia(res, grade, turmaId, dayKey, ehPrevia, offsetIndex)` processa o dia usando a grade resolvida.
6. Cada item da grade define matéria, professor, URL, formato e filtros.
7. `fetchBlog(url)` busca o HTML.
8. `obterHtml()` tenta acesso direto e proxies.
9. `limparHtmlBlog(html, removerBlocos)` remove ruído do Blogspot.
10. O texto é cortado com estratégia topo+fim quando grande demais.
11. O resultado entra no cache de blog.
12. O processador específico da matéria extrai aula, dever e datas.
13. `comMateriais` aplica regras universais de exibição.
14. O frontend recebe por SSE e renderiza.

O evento SSE `start` agora inclui:

- `turmaId`.
- `turmaNome`.

O frontend guarda esses dados em `window._turmaAtual`, sem alterar visual, `localStorage`, chaves `chk_*` ou Central de Deveres.

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

- `blogCache`: cache de blog por URL em memória. Pode ser compartilhado entre turmas quando a URL é a mesma.
- `cacheDia`: cache de extração por dia e turma, chave baseada em `isoEfetivo()+turmaId+dayKey`.
- `resumoCache`: cache de resumo/simulado por assunto.
- Redação tem cache próprio por hash de texto.

Formato do `cacheDia` após a Fase 2A:

```text
YYYY-MM-DD_turmaId_dayKey
```

Exemplo:

```text
2026-07-28_3-ano_ter
```

Cache reduz custo de IA porque a extração principal roda aproximadamente uma vez por dia por matéria e turma, não uma vez por aluno.

## Admin e alunos

Os alunos ficam persistidos em `alunos.json`.

O admin agora:

- Mostra `turma` e `turmaNome` na listagem de alunos.
- Aceita `turma` ao criar aluno.
- Valida a turma contra `TURMAS`.
- Salva a turma no registro de novos alunos.
- Usa fallback `3-ano` para alunos antigos sem turma.

Ainda não existe endpoint `/api/admin/trocar-turma`. Ele só deve ser criado quando houver necessidade real de mover alunos entre turmas.

## Diagnóstico

Rota crítica:

`/diag?senha=SENHA&dia=DIA&materia=SUBSTR&raw=1`

Uso:

- Ver texto cru/limpo de uma matéria.
- Confirmar se o blog chegou vazio.
- Confirmar se a limpeza removeu conteúdo demais.
- Confirmar se o parser recebeu conteúdo suficiente.

Regra de segurança: nunca colar link com `senha=` no chat. Apagar a senha antes.
