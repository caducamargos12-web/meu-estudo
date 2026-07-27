---
name: entrega-git-meu-estudo
description: Use depois que uma mudança do Meu Estudo foi revisada e validada para preparar commit, push e instruções de deploy seguro no GitHub/Railway.
---

# Entrega Git - Meu Estudo

Use esta skill depois que a implementação já foi revisada e validada.

## Regra principal

Para mudanças de código, preferir branch separada em vez de push direto na main.

Fluxo seguro: criar worktree/branch, implementar, validar, commitar, push para branch, Carlos revisa no GitHub, Carlos faz merge para main, Railway redeploya.

Push direto na main só é aceitável para documentação, skills, correção muito pequena validada ou quando Carlos autorizar explicitamente.


## Fluxo automático obrigatório no final de qualquer tarefa

Quando Carlos pedir para finalizar, commitar ou subir uma alteração, aplicar este fluxo automaticamente, sem exigir que ele cole o prompt completo:

1. Rodar `git status`.
2. Separar arquivos alterados por tipo:
   - app: `server.js`, `index.html`, `admin.html`, arquivos do produto.
   - docs: `CLAUDE.md`, `docs/`, `README.md`.
   - skills: `.claude/skills/`.
   - config: `package.json`, `railway.json`, configs de deploy ou dependências.
   - temporários: caches, logs, `.env`, arquivos gerados em runtime.
3. Não usar `git add .` por padrão.
4. Adicionar apenas arquivos relacionados à tarefa atual.
5. Rodar validações obrigatórias conforme os arquivos alterados.
6. Mostrar resumo do commit planejado.
7. Pedir aprovação de Carlos antes de `git commit` e `git push`.
8. Só depois da aprovação executar commit e push.

Se a mudança tocar `server.js`, `index.html` com JavaScript, parser, cache, IA, auth ou `GRADE`, não fazer push direto na `main` sem autorização explícita de Carlos.

## Como escolher o git add correto

Use `git add` específico por tarefa.

Exemplos:

```bash
# Só workflow/documentação
git add CLAUDE.md docs/workflow-git-worktrees-subagentes.md .claude/skills/decidir-workflow-meu-estudo .claude/skills/entrega-git-meu-estudo .claude/skills/loop-revisao-meu-estudo

# Só mudança de app em server e front
git add server.js index.html

# Só documentação
git add docs/arquivo.md CLAUDE.md

# Só uma skill
git add .claude/skills/nome-da-skill/SKILL.md
```

Só usar `git add .` se `git status` mostrar que todos os arquivos modificados pertencem claramente à mesma tarefa e não há temporários, caches ou mudanças misturadas.

## Checklist antes do commit

1. Rodar `git status`.
2. Rodar `git diff` e revisar o que mudou.
3. Verificar segredos: `senha=`, `ADMIN_SENHA`, `token`, `secret`, `api_key`.
4. Rodar validações da skill `validar-entrega-meu-estudo`.
5. Decidir `Limpar cache: SIM/NÃO`.
6. Garantir que arquivos de runtime/cache não entraram no commit por acidente.

Arquivos que geralmente NÃO devem entrar em commit: `redacao_cache.json`, `redacao_uso.json`, logs, temporários e `.env`.

## Mensagem de commit

Use Conventional Commits: `fix`, `feat`, `docs`, `chore`, `refactor`, `test`.

Exemplos:

```text
fix(parser): corrigir leitura de Matemática A
feat(redacao): melhorar feedback por competência ENEM
docs(workflow): adicionar decisão sobre worktree e sub-agentes
chore(skills): adicionar entrega git do Meu Estudo
refactor(turmas): preparar grade por turma
```

## Comandos para branch separada

```bash
git status
git add ARQUIVOS
git commit -m "tipo(escopo): descrição curta"
git push -u origin NOME_DA_BRANCH
```

Depois orientar Carlos a abrir Pull Request no GitHub, revisar arquivos e fazer merge para main se estiver tudo certo.

## Comandos para main

Usar apenas quando apropriado:

```bash
git status
git add ARQUIVOS
git commit -m "tipo(escopo): descrição curta"
git push
```

## Resposta final obrigatória

Depois do push, responder:

```text
Commit criado: [hash curto se disponível]
Branch: [nome]
Arquivos alterados: [lista]
Validações feitas: [lista]
Próximo passo: [PR/merge/redeploy/teste]
Limpar cache: SIM/NÃO, porque [motivo]
```

## Política de deploy

Claude Code pode preparar commit e push se Carlos tiver autorizado naquele contexto. Claude não deve clicar no Railway nem mexer em variáveis sensíveis. Carlos continua responsável por conferir GitHub, fazer merge se for branch, conferir deploy Railway, limpar cache quando indicado e testar em aba anônima.
