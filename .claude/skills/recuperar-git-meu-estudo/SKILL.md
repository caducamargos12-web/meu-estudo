---
name: recuperar-git-meu-estudo
description: Use quando ocorrer erro de Git no Meu Estudo, como index.lock, push rejected, pull/rebase, stash, conflitos ou arquivos misturados. Resolve automaticamente o que for seguro e para quando precisar de decisão do Carlos.
---

# Recuperar Git - Meu Estudo

Use esta skill sempre que Git falhar ou antes de operações Git sensíveis no Meu Estudo.

## Objetivo

Reduzir tempo perdido com erros comuns de Git sem colocar produção em risco, sem perder alterações e sem misturar arquivos de tarefas diferentes.

## Regra principal

Nunca usar comandos destrutivos sem autorização explícita de Carlos.

Comandos proibidos sem aprovação explícita:

```bash
git reset --hard
git clean -fd
git stash clear
git checkout -- .
git restore .
git push --force
git rebase --abort
```

Se houver conflito, parar e pedir decisão.

## Fluxo inicial obrigatório

Antes de tentar corrigir qualquer erro:

```bash
git status
git branch --show-current
git stash list
```

Depois classificar o problema.

## Caso 1: erro de index.lock

Erro típico:

```text
fatal: Unable to create '.git/index.lock': File exists.
Another git process seems to be running
```

### Recuperação segura no Windows

1. Verificar se há processo Git ativo:

```powershell
Get-Process git -ErrorAction SilentlyContinue
```

2. Se houver processo Git ativo, não remover lock. Aguardar ou pedir Carlos para fechar o processo.

3. Se não houver processo Git ativo, remover o lock:

```powershell
Remove-Item .git\index.lock
```

4. Conferir:

```powershell
git status
```

## Caso 2: push rejeitado por fetch first

Erro típico:

```text
! [rejected] main -> main (fetch first)
Updates were rejected because the remote contains work that you do not have locally.
```

### Se working tree estiver limpa

Rodar:

```bash
git pull --rebase
git push
```

### Se houver mudanças locais não commitadas

1. Identificar arquivos modificados:

```bash
git status --short
```

2. Guardar apenas os arquivos não commitados que não fazem parte do commit atual:

```bash
git stash push -m "auto-stash-antes-pull" -- ARQUIVOS
```

3. Rodar:

```bash
git pull --rebase
git push
```

4. Restaurar stash específico usando aspas no PowerShell:

```powershell
git stash pop "stash@{0}"
```

5. Se houver conflito, parar e pedir decisão a Carlos.

## Caso 3: arquivos misturados no git status

Exemplo:

```text
modified: CLAUDE.md
modified: server.js
modified: index.html
new file: docs/...
new file: .claude/skills/...
```

Ação obrigatória:

1. Separar por tipo:

- app: `server.js`, `index.html`, `admin.html`.
- docs: `CLAUDE.md`, `docs/`, `README.md`.
- skills: `.claude/skills/`.
- config: `package.json`, `railway.json`.
- temporários: caches, logs, `.env`, `.claude/settings.local.json`.

2. Não usar `git add .`.

3. Montar commits separados.

Exemplo para workflow:

```powershell
git add CLAUDE.md docs\workflow-git-worktrees-subagentes.md .claude\skills\decidir-workflow-meu-estudo .claude\skills\entrega-git-meu-estudo .claude\skills\loop-revisao-meu-estudo .claude\skills\recuperar-git-meu-estudo
git commit -m "docs(workflow): adicionar recuperação git"
```

Exemplo para app:

```powershell
git add server.js index.html
git commit -m "fix(app): descrever correção"
```

## Caso 4: stash no PowerShell

No PowerShell, sempre usar aspas com `stash@{0}`:

```powershell
git stash show -p "stash@{0}"
git stash pop "stash@{0}"
git stash drop "stash@{0}"
```

Sem aspas, PowerShell pode interpretar `{0}` incorretamente.

## Caso 5: conflito após pull, rebase ou stash pop

Sinais:

```text
CONFLICT
both modified
unmerged paths
```

Ação obrigatória:

1. Parar.
2. Rodar:

```bash
git status
```

3. Explicar para Carlos quais arquivos estão em conflito.
4. Não resolver automaticamente se envolver `server.js`, `index.html`, auth, cache, parser ou dados de aluno.
5. Pedir decisão antes de continuar.

## Caso 6: push direto na main

Só permitido sem nova confirmação quando a mudança for apenas docs/skills e o diff estiver limpo.

Se tocar app, `server.js`, `index.html`, parser, cache, IA, auth ou `GRADE`, pedir autorização explícita de Carlos antes de push direto na main.

## Checklist de recuperação final

Depois de corrigir Git, rodar:

```bash
git status
git log --oneline -5
```

Responder:

```text
Problema Git identificado: [tipo]
Ação feita: [comandos seguros]
Estado atual: [limpo/ahead/pendente/conflito]
Arquivos protegidos de mistura: [lista]
Próximo passo recomendado: [ação]
```

## Regra de segurança final

Esta skill resolve o comum automaticamente, mas não deve esconder risco. Se houver conflito, segredo, arquivo de produção sensível ou dúvida sobre o que deve entrar no commit, parar e pedir aprovação de Carlos.
