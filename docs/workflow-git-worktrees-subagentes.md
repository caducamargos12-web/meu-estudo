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
