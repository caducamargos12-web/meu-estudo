# ADR 001 - Workflow seguro para produção

## Status

Aceito.

## Contexto

O Meu Estudo está em produção e monetizado. A branch `main` pode disparar redeploy na Railway. Mudanças em `server.js`, parser, cache, IA, auth, `GRADE` ou JavaScript relevante podem quebrar o app para alunos reais.

## Decisão

Usar workflow obrigatório com:

- `CLAUDE.md` como contexto principal.
- `docs/` como documentação operacional.
- `.claude/skills/` para tarefas repetitivas.
- Worktree para mudanças de código com risco.
- Sub-agentes para tarefas estruturais ou multi-ângulo.
- Loops de revisão antes da entrega.
- Commit/push apenas após validação e aprovação de Carlos.

## Consequências

Benefícios:

- Menos risco de quebrar produção.
- Melhor histórico no Git.
- Menos retrabalho.
- Recuperação Git mais segura.

Trade-off:

- Tarefas grandes começam um pouco mais devagar, mas com risco muito menor.
