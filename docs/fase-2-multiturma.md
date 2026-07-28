# Fase 2 - Arquitetura Multi-Turma

Status: Fase 2A implementada na branch `feature/multiturma-arquitetura` em 2026-07-28. Ainda não mergeada na `main` neste documento.

## Contexto

Carlos quer levar o Meu Estudo para todas as 7 turmas da manhã.

Estado antes da Fase 2A:

- O app era single-turma.
- A `GRADE` era fixa no código.
- Todo aluno via a mesma grade.
- Não existia conceito de aluno pertencer a uma turma.
- Não existia grade por turma.

Estado após a Fase 2A:

- A grade atual foi separada como `GRADE_3_ANO`.
- Existe `TURMA_PADRAO = '3-ano'`.
- Existe `TURMAS` inline em `server.js`, com apenas `3-ano`.
- Existem helpers para validar turma e resolver grade.
- `/api/today` usa a grade resolvida pela turma do aluno.
- `cacheDia` usa `turmaId` na chave.
- O admin cadastra e lista turma do aluno.
- O SSE `start` envia `turmaId` e `turmaNome`.
- O frontend guarda a turma atual em memória.

Nenhuma turma piloto foi adicionada ainda.

## Fatos conhecidos

- As outras 6 turmas têm professores diferentes.
- As outras 6 turmas têm blogs diferentes.
- Todos os professores usam Blogspot.
- Pode haver mais de 60 blogs novos para mapear.
- O padrão geral é parecido, mas parsers podem quebrar por formato de blog diferente.

## Risco de subestimar

Não é copiar e colar.

Para cada turma nova será necessário:

1. Levantar blogs por professor e matéria.
2. Montar grade da turma.
3. Confirmar formato do blog.
4. Testar se parser atual reconhece.
5. Criar ajuste específico quando necessário.
6. Validar em tela com dados reais.

## Fases acordadas

### Fase 1: Estabilizar base do 3º ano

Status: concluída o suficiente para iniciar a arquitetura multi-turma.

Observação: ainda existem validações pontuais do 3º bimestre para agosto, como Matemática A, Química B com PROVA/RAA e História, mas elas não bloqueiam a arquitetura da Fase 2A.

### Fase 2A: Preparar arquitetura multi-turma

Status: implementada na branch `feature/multiturma-arquitetura`.

Objetivo:

- Separar a grade atual como `GRADE_3_ANO`.
- Criar `TURMAS` e helpers de turma.
- Garantir fallback para `3-ano`.
- Fazer `/api/today` usar grade resolvida pela turma.
- Separar cache diário por turma.
- Adicionar turma no cadastro/listagem do admin.
- Enviar `turmaId` e `turmaNome` no SSE `start`.
- Não mudar localStorage nem chaves `chk_*`.

Commits principais da Fase 2A:

```text
refactor(turmas): extrair GRADE_3_ANO sem mudar comportamento
refactor(turmas): adicionar TURMAS e helpers com fallback 3-ano
refactor(turmas): resolver grade no fluxo principal
feat(cache): incluir turma na chave do cache diário
feat(admin): adicionar turma no cadastro de aluno
feat(turmas): expor turma atual no carregamento do dia
```

Limites da Fase 2A:

- Não adiciona turma piloto.
- Não adiciona blogs novos.
- Não altera parsers por turma nova.
- Não cria endpoint `/api/admin/trocar-turma`.
- Não altera `localStorage` nem chaves `chk_*`.
- Não altera Central de Deveres.

### Fase 3: Adicionar uma turma piloto

Status: não iniciada.

Objetivo:

- Mapear uma única turma nova.
- Testar fluxo ponta a ponta.
- Ver quais parsers quebram.
- Criar processo replicável.

Pré-requisitos da Fase 3:

1. Carlos escolher a turma piloto.
2. Obter a grade real da turma piloto.
3. Levantar professores e blogs reais.
4. Coletar dados reais ou criar fixtures em `test-fixtures/`.
5. Validar o formato dos blogs antes de mexer em parser.
6. Definir plano de rollback.

A Fase 3 depende de dados reais/fixtures da turma piloto. Não deve ser feita só com suposição.

### Fase 4: Expandir para as demais turmas

Status: não iniciada.

Objetivo:

- Replicar processo validado na turma piloto.
- Adicionar as outras turmas progressivamente.

## Design implementado na Fase 2A

### Modelo de dados

```js
const TURMA_PADRAO = '3-ano';
const TURMAS = {
  '3-ano': {
    id: '3-ano',
    nome: '3º ano',
    ativa: true,
    grade: GRADE_3_ANO,
  },
};
```

### Usuário com turma

Novos alunos criados pelo admin passam a salvar:

```js
alunos[user] = {
  hash,
  criadoEm,
  turma: '3-ano'
};
```

Alunos antigos sem `turma` continuam válidos e caem no fallback.

### Seleção de grade

Helpers usados:

```js
function getTurmaIdDoUsuario(user) {
  if (typeof user === 'string') return TURMA_PADRAO;
  return turmaValida(user?.turma) ? user.turma : TURMA_PADRAO;
}

function getGradeDoUsuario(user) {
  return getGradePorId(getTurmaIdDoUsuario(user));
}
```

No fluxo principal, `/api/today` resolve o aluno, a turma e a grade antes de processar o dia.

### Cache por turma

A chave do cache diário passou a usar:

```text
YYYY-MM-DD_turmaId_dayKey
```

Exemplo:

```text
2026-07-28_3-ano_ter
```

Isso evita misturar resultados de turmas diferentes quando a Fase 3 adicionar uma grade nova.

### Frontend

O evento SSE `start` envia:

```js
turmaId
turmaNome
```

O frontend guarda em memória:

```js
window._turmaAtual = { id: msg.turmaId, nome: msg.turmaNome };
```

Não houve mudança visual e não houve alteração nas chaves de dever feito.

## O que NÃO fazer

- Não adicionar todas as turmas de uma vez.
- Não mexer em parser e arquitetura multi-turma ao mesmo tempo, se puder evitar.
- Não remover a grade atual sem fallback.
- Não depender de dados perfeitos dos blogs novos.
- Não assumir que todos os blogs seguem formato igual.
- Não criar endpoint de troca de turma antes de haver necessidade operacional real.
- Não alterar `localStorage`/`chk_*` sem preservar compatibilidade com o 3º ano.

## Prompt recomendado para Fase 3

```text
Use orquestrar-multiturma-meu-estudo.

Quero iniciar a Fase 3 com uma turma piloto.
Antes de implementar, inspecione:
1. Qual turma será piloto.
2. Grade real da turma.
3. Blogs dos professores.
4. Quais matérias reutilizam parsers existentes.
5. Quais fixtures reais precisamos criar.
6. Riscos para o 3º ano.

Não altere parsers nem adicione a turma antes de consolidar o plano e pedir aprovação.
```
