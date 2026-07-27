---
name: decidir-workflow-meu-estudo
description: Use no início de qualquer tarefa do Meu Estudo para decidir se precisa de worktree, sub-agentes, loop de revisão, skill específica, validação pesada ou fluxo simples.
---

# Decidir Workflow - Meu Estudo

Use esta skill antes de começar qualquer tarefa no Meu Estudo.

## Objetivo

Escolher o fluxo certo antes de mexer no projeto, evitando excesso de processo em tarefa simples e evitando risco em tarefa grande.


## Aplicação automática

Carlos não precisa copiar um prompt longo toda vez. Ao receber qualquer pedido no Meu Estudo, aplique automaticamente este checklist antes de trabalhar:

```text
Tarefa: [pedido de Carlos]

Antes de implementar, responder:
1. Classificação da tarefa
2. Worktree: SIM/NÃO
3. Sub-agentes: SIM/NÃO
4. Loop: qual tipo
5. Skills necessárias
6. Risco principal
7. Plano curto

Só implementar depois que Carlos aprovar o plano, exceto documentação simples.
```

Se Carlos pedir algo como "faça", "implemente", "corrija", "arrume", "adicione" ou "altere", não pule esta etapa.

## Classificação da tarefa

### Categoria A: conversa ou planejamento sem código

Exemplos: explicar arquitetura, discutir preço, avaliar ideia nova, criar roteiro de teste, escrever orientação sem criar arquivo.

Workflow: worktree NÃO; sub-agentes NÃO, salvo análise com vários ângulos; loop simples; commit NÃO.

### Categoria B: documentação ou skill

Exemplos: atualizar `CLAUDE.md`, criar arquivo em `docs/`, criar skill em `.claude/skills/`.

Workflow: worktree opcional; sub-agentes normalmente NÃO; revisar coerência e duplicidade; pode ir direto para `main` se estiver revisado; Limpar cache: NÃO.

### Categoria C: mudança pequena no frontend

Exemplos: texto visual, CSS simples, ajuste pequeno de layout, ajuste simples em overlay.

Workflow: worktree recomendado se mexer em JavaScript; sub-agentes NÃO; validar scripts do `index.html` se houver JavaScript; main só se Carlos autorizar e validação passar; Limpar cache: normalmente NÃO.

### Categoria D: bug ou parser de matéria

Exemplos: matéria vazia, dever duplicado, data errada, blog não lido, parser de Matemática A, Química B, História, Linguística ou outra matéria.

Workflow: worktree SIM obrigatório; sub-agentes opcionais se causa for incerta ou envolver várias camadas; loop de diagnóstico com dado real; skills `debugar-materia-diag`, `validar-entrega-meu-estudo`, `entrega-git-meu-estudo`; Limpar cache: geralmente SIM.

### Categoria E: feature nova média

Exemplos: melhorar Correção de Redação, novo endpoint simples, nova interface no frontend, nova lógica com IA limitada.

Workflow: worktree SIM obrigatório; sub-agentes opcionais se houver risco técnico/custo/negócio; loop de design, aprovação, implementação pequena, validação e revisão; skills `design-feature-nova`, `revisar-custo-ia` se usar IA, `validar-entrega-meu-estudo`, `entrega-git-meu-estudo`; push em branch por padrão.

### Categoria F: mudança grande ou estrutural

Exemplos: multi-turma, refatoração do `server.js`, alteração de auth, alteração de cache, mudança no modelo de dados, qualquer alteração que pode quebrar o 3º ano atual.

Workflow: worktree SIM obrigatório; sub-agentes SIM obrigatório; loop de plano, revisão, implementação em etapas, validação por etapa e revisão final; push em branch, nunca direto na `main` por padrão; merge só depois de revisão do Carlos.

## Decisão sobre worktree

Use worktree quando mexer em `server.js`, parser, cache, IA, auth, `GRADE`, JavaScript relevante no `index.html`, tarefa de mais de 30 minutos, feature nova, multi-turma ou algo que possa quebrar produção.

Não use worktree quando for só conversa, documentação pequena, typo sem impacto, diagnóstico sem alterar arquivo ou quando Carlos pedir explicitamente para não criar branch/worktree.

## Decisão sobre sub-agentes

Use sub-agentes quando a análise tiver ângulos diferentes como segurança, custo, negócio, arquitetura e testes; quando o arquivo for grande; quando a mudança for estrutural; quando a decisão errada gerar retrabalho grande; ou quando a feature precisar de decisão construir/não construir/validar antes.

Não use sub-agentes para alteração pequena e óbvia, problema localizado em função pequena, rodar comando, validar sintaxe, commit/push, ajustar texto/CSS ou quando o custo da análise paralela for maior que a tarefa.

## Saída obrigatória antes de começar

Antes de implementar, responda:

```text
Classificação: A/B/C/D/E/F
Worktree: SIM/NÃO
Sub-agentes: SIM/NÃO
Loop: simples/diagnóstico/implementação/revisão pesada
Skills necessárias: [lista]
Risco principal: [curto]
Plano curto: [3-5 passos]
```

Se for categoria D, E ou F, não implementar direto sem plano curto.
