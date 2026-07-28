# ADR 003 - Multi-turma Fase 2A

## Status

Aceito na branch `feature/multiturma-arquitetura` em 2026-07-28.

## Contexto

O Meu Estudo nasceu single-turma, com uma grade fixa para o 3º ano. Para expandir para outras turmas sem quebrar a operação atual, a arquitetura precisa separar aluno, turma, grade e cache antes de cadastrar qualquer turma nova.

## Decisão

Implementar a Fase 2A como preparação arquitetural, mantendo apenas a turma atual `3-ano`.

A Fase 2A define:

- `GRADE_3_ANO` como a grade atual do 3º ano.
- `TURMA_PADRAO = '3-ano'`.
- `TURMAS` inline em `server.js`, inicialmente com apenas `3-ano`.
- Helpers de turma e grade:
  - `turmaValida(turmaId)`
  - `getTurmaPorId(turmaId)`
  - `getGradePorId(turmaId)`
  - `getTurmaIdDoUsuario(user)`
  - `getGradeDoUsuario(user)`
- `/api/today` resolvendo a turma do aluno autenticado e usando a grade correspondente.
- Fallback obrigatório para `3-ano` quando o aluno antigo não tiver `turma`.
- Cache diário de extração separado por turma, no formato `YYYY-MM-DD_turmaId_dayKey`.
- Admin com campo de turma no cadastro e listagem de alunos.
- Evento SSE `start` expondo `turmaId` e `turmaNome` para o frontend.

## O que não foi feito nesta fase

- Nenhuma turma piloto foi adicionada.
- Nenhum blog novo foi cadastrado.
- Nenhum parser foi alterado por causa de turmas novas.
- Nenhum endpoint `/api/admin/trocar-turma` foi criado.
- O frontend ainda não altera chaves `chk_*` de dever feito.
- O frontend ainda não usa `turmaId` no `localStorage`.
- A Central de Deveres não mudou.

## Consequências

Benefícios:

- O 3º ano continua sendo o fallback seguro.
- Usuários antigos sem `turma` continuam funcionando.
- A grade do fluxo principal já pode variar por turma quando uma turma nova for cadastrada.
- O cache diário não mistura resultados entre turmas.
- O admin já registra turma em novos alunos.
- O frontend já recebe a turma atual em memória, sem mudar estado local.

Trade-offs:

- Ainda não há edição de turma para aluno existente.
- Como só existe `3-ano`, o select do admin tem apenas uma opção.
- A próxima turma real ainda exigirá levantamento de blogs, montagem de grade e validação de parsers com dados reais.

## Próxima fase

A Fase 3 deve adicionar uma turma piloto apenas depois de Carlos ter dados reais suficientes:

1. Grade da turma piloto.
2. Lista de professores e blogs.
3. Amostras reais ou fixtures de matérias.
4. Validação de quais parsers atuais funcionam sem ajuste.
5. Plano de rollback caso uma turma nova quebre leitura, cache ou exibição.
