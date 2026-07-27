# Workflow Git, Worktrees, Sub-agentes e Loops - Meu Estudo

## Objetivo

Padronizar como o Meu Estudo deve ser alterado usando Claude Code no VS Code sem colocar produção em risco.

## Regra principal

A `main` representa produção. Não usar a `main` como ambiente de teste para mudanças com risco.

## Fluxo seguro padrão

```text
1. Classificar tarefa com a skill decidir-workflow-meu-estudo
2. Criar worktree se necessário
3. Abrir worktree no VS Code
4. Claude Code lê CLAUDE.md + docs
5. Planejar antes de implementar
6. Usar sub-agentes se a tarefa for grande
7. Implementar em ciclos pequenos
8. Rodar loop de revisão
9. Validar com validar-entrega-meu-estudo
10. Commitar com entrega-git-meu-estudo
11. Push para branch ou main conforme risco
12. Carlos revisa GitHub/Railway
13. Testar em aba anônima
```

## Estrutura recomendada no Windows

Clone principal atual:

```text
C:\Users\Carl\projects\meu-estudo
```

Worktrees como pastas irmãs:

```text
C:\Users\Carl\projects\meu-estudo
C:\Users\Carl\projects\meu-estudo-fix-mat-a
C:\Users\Carl\projects\meu-estudo-redacao
C:\Users\Carl\projects\meu-estudo-multiturma
```

## Criar worktree

A partir da pasta principal:

```powershell
cd C:\Users\Carl\projects\meu-estudo
git pull
git worktree add ..\meu-estudo-fix-nome -b fix/nome-da-correcao
cd ..\meu-estudo-fix-nome
code .
```

## Exemplo: bug em matéria

```powershell
cd C:\Users\Carl\projects\meu-estudo
git pull
git worktree add ..\meu-estudo-fix-mat-a -b fix/mat-a-vazia
cd ..\meu-estudo-fix-mat-a
code .
```

Prompt:

```text
Use a skill decidir-workflow-meu-estudo.
Problema: Matemática A aparece vazia.
Classifique a tarefa, diga se precisa worktree/sub-agente/loop e depois use debugar-materia-diag.
Não implemente antes de me pedir os dados reais do /diag.
```

## Exemplo: feature de redação

```powershell
git worktree add ..\meu-estudo-redacao-feedback -b feature/redacao-feedback
cd ..\meu-estudo-redacao-feedback
code .
```

Prompt:

```text
Use decidir-workflow-meu-estudo.
Quero melhorar a Correção de Redação sem aumentar muito custo.
Use revisar-custo-ia e design-feature-nova antes de implementar.
Use loop-revisao-meu-estudo se eu aprovar implementação.
```

## Exemplo: multi-turma

```powershell
git worktree add ..\meu-estudo-multiturma -b feature/multiturma-arquitetura
cd ..\meu-estudo-multiturma
code .
```

Prompt:

```text
Use decidir-workflow-meu-estudo.
Leia docs/fase-2-multiturma.md.
Use sub-agentes para planejar a arquitetura multi-turma.
Não implemente nada até consolidar o plano.
```

## Quando usar worktree

Use worktree quando mexer em `server.js`, parser, cache, IA, auth, `GRADE`, JavaScript relevante no `index.html`, feature nova, multi-turma ou qualquer mudança que pode quebrar produção.

## Quando não usar worktree

Não precisa worktree quando for conversa, documentação pequena, ajuste de skill, diagnóstico sem alterar arquivo ou correção de typo sem impacto no app.

## Quando usar sub-agentes

Use sub-agentes quando a tarefa tiver ângulos diferentes, como segurança, arquitetura, custo, negócio e testes; quando o arquivo for grande; quando a mudança for estrutural; quando a decisão errada gerar retrabalho grande; ou quando a feature precisar de decisão construir/não construir/validar antes.

## Quando não usar sub-agentes

Não use sub-agentes para correção pequena, sintaxe, commit/push, texto, CSS ou problema já localizado.

## Quando usar loops

Use loops quando houver risco de produção ou mudança em código. O loop mínimo é:

```text
planejar → implementar pequeno → validar → revisar diff → corrigir → validar de novo → entregar Git
```

Para parser ou matéria, o loop precisa incluir dado real via `/diag` ou conteúdo real de blog.

## Prompt mestre para iniciar qualquer tarefa

```text
Use a skill decidir-workflow-meu-estudo.

Tarefa:
[descreva aqui]

Antes de implementar, responda:
1. Classificação da tarefa
2. Worktree: SIM/NÃO
3. Sub-agentes: SIM/NÃO
4. Loop: qual tipo
5. Skills necessárias
6. Risco principal
7. Plano curto

Só implemente depois que eu aprovar o plano, exceto se for documentação simples.
```

## Prompt para entrega com Git

```text
Use validar-entrega-meu-estudo, loop-revisao-meu-estudo e depois entrega-git-meu-estudo.

Revise as mudanças, rode as validações necessárias, confira se não há segredos e prepare commit.
Se estiver tudo OK, faça commit e push conforme o risco da branch.
No final diga:
- branch
- commit
- arquivos alterados
- validações feitas
- próximo passo
- Limpar cache: SIM/NÃO
```

## Política recomendada de push

Documentação e skills podem ir direto para `main`, desde que revisadas.

Código simples pode ir direto para `main` só com autorização explícita do Carlos.

Parser, cache, IA, auth e multi-turma devem ir para branch/worktree e revisão antes da `main`.

## Por que não fazer tudo automático na main

Railway pode redeployar automaticamente quando a `main` muda. Se a IA der push direto na `main` com erro em `server.js`, produção pode quebrar.

Por isso, o fluxo mais seguro é:

```text
IA faz commit/push na branch
Carlos revisa no GitHub
Carlos faz merge
Railway deploya
Carlos testa
```

## Regra final

Para o Meu Estudo, velocidade importa, mas estabilidade importa mais. O app já está monetizado e em produção.

## Padrão automático para Carlos não precisar copiar prompts

A partir de agora, o `CLAUDE.md` e as skills locais dizem ao Claude Code para aplicar dois comportamentos automaticamente.

### Início de tarefa

Sempre que Carlos pedir uma tarefa, Claude Code deve aplicar `decidir-workflow-meu-estudo` e responder antes de implementar:

```text
Classificação: A/B/C/D/E/F
Worktree: SIM/NÃO
Sub-agentes: SIM/NÃO
Loop: simples/diagnóstico/implementação/revisão pesada
Skills necessárias: [lista]
Risco principal: [curto]
Plano curto: [3-5 passos]
```

Só documentação simples pode ir direto sem pedir aprovação do plano.

### Final de tarefa

Quando uma alteração terminar, Claude Code deve aplicar `validar-entrega-meu-estudo`, `loop-revisao-meu-estudo` quando necessário e `entrega-git-meu-estudo`.

Fluxo obrigatório:

```text
1. Rodar git status
2. Separar arquivos por tipo: app, docs, skills, config e temporários
3. Não usar git add . por padrão
4. Adicionar apenas arquivos relacionados à tarefa
5. Rodar validações obrigatórias
6. Mostrar resumo do commit planejado
7. Pedir aprovação de Carlos
8. Só depois rodar git commit e git push
```

### Regra sobre `git add`

Não existe um único comando universal.

Para workflow/documentação, usar algo como:

```powershell
git add CLAUDE.md docs\workflow-git-worktrees-subagentes.md .claude\skills\decidir-workflow-meu-estudo .claude\skills\entrega-git-meu-estudo .claude\skills\loop-revisao-meu-estudo
```

Para app:

```powershell
git add server.js index.html
```

Para skill específica:

```powershell
git add .claude\skills\nome-da-skill\SKILL.md
```

Só usar `git add .` se `git status` mostrar que todas as mudanças pertencem claramente à mesma tarefa e não há arquivos temporários, cache ou mudanças de outra sessão.

## Recuperação automática de erros Git

Quando ocorrer erro de Git, Claude Code deve usar a skill `recuperar-git-meu-estudo` antes de pedir ajuda a Carlos.

### Erros que Claude Code pode tentar resolver sozinho

```text
index.lock
push rejected por fetch first
stash no PowerShell com aspas
pull --rebase com working tree limpa
separação de arquivos misturados por tipo
```

### Erros em que Claude Code deve parar e pedir aprovação

```text
conflito em server.js ou index.html
conflito após rebase ou stash pop
necessidade de git reset --hard
git clean -fd
git push --force
segredo no diff
push direto na main com código sensível
```

### Protocolo automático resumido

```text
1. Rodar git status
2. Identificar erro
3. Usar recuperar-git-meu-estudo
4. Aplicar apenas correção segura
5. Parar se houver conflito ou risco
6. Mostrar estado final e próximo passo
```

### Prompt curto de emergência

Se Carlos vir erro de Git, pode pedir:

```text
Use recuperar-git-meu-estudo e resolva esse erro com segurança. Não use comandos destrutivos sem minha aprovação.
```

## Etapa preparatória profissional antes da multi-turma

Antes de implementar multi-turma, manter estas estruturas ativas:

```text
scripts/validate-index-scripts.js
scripts/test-parser.js
test-fixtures/
.github/PULL_REQUEST_TEMPLATE.md
docs/decisions/
.gitignore
```

### Validações padronizadas

Se `server.js` mudar:

```powershell
npm run check:server
```

Se `index.html` mudar:

```powershell
npm run check:index
```

Se parser/matéria mudar, usar dado real salvo em `test-fixtures/` sem senha.

### Regra de PR

Para branches de código, usar o template em `.github/PULL_REQUEST_TEMPLATE.md` antes de merge para `main`.

### Regra de decisões

Para decisões grandes, criar ADR em `docs/decisions/`, especialmente multi-turma, mudanças de IA, cache, auth e integrações.

## Plano de entrada na multi-turma

### Passo 1: criar worktree

```powershell
cd C:\Users\Carl\projects\meu-estudo
git status
git pull
git worktree add ..\meu-estudo-multiturma -b feature/multiturma-arquitetura
cd ..\meu-estudo-multiturma
code .
```

Só seguir se `git status` estiver limpo antes.

### Passo 2: prompt inicial de multi-turma

```text
Siga o workflow obrigatório do CLAUDE.md.

Tarefa:
Planejar a arquitetura multi-turma do Meu Estudo.

Contexto:
O app hoje é single-turma. A GRADE é fixa no server.js. Quero expandir para as 7 turmas da manhã, mas sem quebrar o 3º ano atual, que já está em produção e monetizado.

Leia obrigatoriamente:
- CLAUDE.md
- docs/arquitetura.md
- docs/fase-2-multiturma.md
- docs/workflow-git-worktrees-subagentes.md
- docs/bugs-resolvidos.md
- docs/operacao.md
- docs/seguranca.md
- docs/decisions/001-workflow-producao.md
- docs/decisions/002-multiturma-gradual.md

Use sub-agentes antes de propor qualquer implementação:

Sub-agente 1: arquitetura de dados e auth.
Analise como representar turma, aluno, fallback para 3º ano, compatibilidade com usuários atuais e impacto no admin.

Sub-agente 2: backend/server.js.
Mapeie onde a GRADE global provavelmente é usada, como trocar por grade resolvida por turma, como preservar caches, parsers e /diag.

Sub-agente 3: frontend/index.html.
Analise impactos em SSE, localStorage, Central de Deveres, checkboxes, sessão do aluno e renderização por turma.

Sub-agente 4: parsers e blogs.
Analise como adicionar uma turma piloto sem quebrar parsers existentes, como coletar fixtures reais via /diag e como testar blogs novos.

Sub-agente 5: testes, rollback e operação.
Crie plano de validação, ordem de commits, riscos, rollback, necessidade de limpar cache e testes em aba anônima.

Não implemente nada.
Consolide um plano de arquitetura com:
1. Decisão recomendada
2. Alternativas descartadas
3. Arquivos impactados
4. Ordem de implementação
5. Commits pequenos sugeridos
6. Validações obrigatórias
7. Riscos principais
8. Plano de rollback
9. O que depende de dados reais das turmas novas
```

### Ordem de implementação recomendada

1. Preparar `GRADE_3_ANO`, `TURMAS` e fallback sem mudar comportamento.
2. Trocar usos diretos de `GRADE` por grade resolvida pelo usuário.
3. Adicionar campo de turma no usuário/admin, se necessário.
4. Preparar estrutura para turma piloto.
5. Adicionar dados reais da turma piloto.
6. Expandir gradualmente só depois da turma piloto funcionar.

### Commits pequenos sugeridos

```text
refactor(turmas): preparar grade do 3 ano para multi-turma
refactor(turmas): resolver grade pelo usuário autenticado
feat(admin): adicionar turma ao cadastro de aluno
feat(turmas): adicionar estrutura para turma piloto
feat(turmas): adicionar primeira matéria da turma piloto
fix(parser): adaptar parser para blog da turma piloto
```

### Loop obrigatório da multi-turma

```text
planejar → aprovar → implementar pequena etapa → validar sintaxe → validar comportamento antigo → revisar diff → corrigir → validar de novo → commit pequeno → próxima etapa
```

Nunca implementar multi-turma inteira em um único commit.

### Prompt para finalizar cada etapa

```text
Finalize esta etapa seguindo o workflow obrigatório do CLAUDE.md.

Use validar-entrega-meu-estudo, loop-revisao-meu-estudo e entrega-git-meu-estudo.

Antes de commit/push:
1. Rode git status
2. Separe arquivos por tipo
3. Não use git add .
4. Valide server.js com npm run check:server se mudou
5. Valide index.html com npm run check:index se mudou
6. Verifique segredos no diff
7. Diga se precisa limpar cache
8. Mostre o commit planejado
9. Peça minha aprovação antes de commit/push
```

### Prompt para erro de Git

```text
Use recuperar-git-meu-estudo e resolva esse erro com segurança.
Não use comandos destrutivos sem minha aprovação.
```
