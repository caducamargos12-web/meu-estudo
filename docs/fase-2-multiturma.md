# Fase 2 - Arquitetura Multi-Turma

Status: planejada, não iniciada.

## Contexto

Carlos quer levar o Meu Estudo para todas as 7 turmas da manhã.

Estado atual:

- O app é single-turma.
- A `GRADE` é fixa no código.
- Todo aluno vê a mesma grade.
- Não existe conceito de aluno pertencer a uma turma.
- Não existe grade por turma.

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

Status: em andamento.

Carlos ainda precisa especificar quais ajustes quer fazer antes de partir para multi-turma.

### Fase 2: Construir arquitetura multi-turma

Status: próxima fase após ajustes.

Objetivo:

- Aluno pertence a uma turma.
- Grade é selecionada pela turma.
- Frontend carrega dados da turma correta.
- Backend processa matéria baseado na grade correta.

Essa fase é trabalho de código puro e não depende de aulas acontecendo.

### Fase 3: Adicionar uma turma piloto

Status: não iniciada.

Objetivo:

- Mapear uma única turma nova.
- Testar fluxo ponta a ponta.
- Ver quais parsers quebram.
- Criar processo replicável.

### Fase 4: Expandir para as demais turmas

Status: não iniciada.

Objetivo:

- Replicar processo validado na turma piloto.
- Adicionar as outras turmas progressivamente.

## Design inicial sugerido

### Modelo de dados

Opção simples:

```js
const TURMAS = {
  "3-ano": {
    nome: "3º ano",
    grade: GRADE_3_ANO
  },
  "2-ano-a": {
    nome: "2º ano A",
    grade: GRADE_2_ANO_A
  }
};
```

### Usuário com turma

Cada aluno precisa ter um campo de turma.

Exemplo conceitual:

```js
user.turma = "3-ano";
```

A fonte exata depende do sistema atual de auth/admin.

### Seleção de grade

Em vez de usar `GRADE` global diretamente, criar helper:

```js
function getGradeDoUsuario(user) {
  const turma = user?.turma || "3-ano";
  return TURMAS[turma]?.grade || TURMAS["3-ano"].grade;
}
```

### Compatibilidade

Regra importante: 3º ano atual deve continuar funcionando mesmo se usuário não tiver turma definida.

Fallback obrigatório: `3-ano`.

## Plano de implementação sugerido

1. Mapear onde `GRADE` é usada diretamente.
2. Criar `GRADE_3_ANO` sem mudar comportamento atual.
3. Criar `TURMAS` com `3-ano` apontando para `GRADE_3_ANO`.
4. Criar helper `getGradeDoUsuario(req.user)`.
5. Trocar usos diretos de `GRADE` por grade resolvida pelo usuário.
6. Adicionar campo de turma no cadastro/admin, se necessário.
7. Garantir fallback para `3-ano`.
8. Rodar testes locais e validações de sintaxe.
9. Só depois adicionar turma piloto.

## O que NÃO fazer

- Não adicionar todas as turmas de uma vez.
- Não mexer em parser e arquitetura multi-turma ao mesmo tempo, se puder evitar.
- Não remover a grade atual sem fallback.
- Não depender de dados perfeitos dos blogs novos.
- Não assumir que todos os blogs seguem formato igual.

## Prompt recomendado com sub-agentes

```text
Use 3 sub-agentes para desenhar a Fase 2 multi-turma do Meu Estudo.

Sub-agente 1: modelo de dados.
Analise como representar aluno, turma e grade, mantendo compatibilidade com o 3º ano atual.

Sub-agente 2: mudanças em server.js.
Mapeie onde a GRADE global provavelmente é usada e proponha como trocar por grade resolvida por turma sem quebrar o app.

Sub-agente 3: plano de teste.
Crie plano de validação para garantir que o 3º ano atual continua funcionando e que uma turma piloto pode ser adicionada com risco controlado.

Depois consolide em um plano de implementação passo a passo, com riscos e rollback.
```
