---
name: orquestrar-multiturma-meu-estudo
description: Use para conduzir a implementação multi-turma do Meu Estudo do planejamento ao PR, com sub-agentes, loops, commits pequenos, validações e checkpoints de aprovação.
---

# Orquestrar Multi-Turma - Meu Estudo

Use esta skill para conduzir a Fase 2 multi-turma no Meu Estudo.

## Papel

Atue como orquestrador técnico da mudança multi-turma.

Você deve:

- Ler `CLAUDE.md` e docs relevantes.
- Aplicar `decidir-workflow-meu-estudo`.
- Delegar análises para sub-agentes quando necessário.
- Implementar em commits pequenos.
- Rodar loops de validação.
- Usar `recuperar-git-meu-estudo` quando Git falhar.
- Usar `entrega-git-meu-estudo` ao final de cada etapa.
- Pedir aprovação de Carlos nos checkpoints obrigatórios.

## Regra principal

A multi-turma nunca deve ser implementada em um único commit.

O 3º ano atual deve continuar funcionando como antes em todos os passos.

## Premissas já decididas

- `TURMAS` deve ficar inline em `server.js` nesta fase.
- Admin deve expor campo de turma no cadastro/listagem de aluno.
- Não adicionar turma piloto nesta fase.
- `cacheDia` deve incluir `turmaId` na chave quando cache por turma for ativado.
- Fallback obrigatório: se usuário não tiver turma, usar `3-ano`.
- Não criar env var `TURMA_PILOTO_ATIVA` nesta Fase 2A.
- Não criar endpoint `/api/admin/trocar-turma` sem antes verificar se é realmente necessário.
- Se `index.html` incluir `turmaId` em chaves `chk_*`, preservar compatibilidade com chaves antigas do 3º ano.

## Documentos obrigatórios

Ler antes de agir:

- `CLAUDE.md`
- `docs/arquitetura.md`
- `docs/fase-2-multiturma.md`
- `docs/workflow-git-worktrees-subagentes.md`
- `docs/bugs-resolvidos.md`
- `docs/operacao.md`
- `docs/seguranca.md`
- `docs/decisions/001-workflow-producao.md`
- `docs/decisions/002-multiturma-gradual.md`

## Plano de commits da Fase 2A

### Commit 1: já esperado

```text
refactor(turmas): extrair GRADE_3_ANO sem mudar comportamento
```

Escopo:

- Renomear `GRADE` para `GRADE_3_ANO`.
- Criar alias temporário `const GRADE = GRADE_3_ANO;`.
- Não alterar comportamento.

### Commit 2: já esperado

```text
refactor(turmas): adicionar TURMAS e helpers com fallback 3-ano
```

Escopo:

- Criar `TURMA_PADRAO`.
- Criar `TURMAS` com apenas `3-ano`.
- Criar helpers de turma/grade.
- Não usar helpers ainda no fluxo.

### Commit 3: inspeção obrigatória antes de implementar

```text
refactor(turmas): mapear uso de GRADE antes de trocar fluxo
```

Antes de alterar arquivos, mapear:

1. Todos os usos de `GRADE` em `server.js`.
2. Assinatura atual de `processarDia` e chamadas.
3. Como `/api/today` calcula total, SSE start e processa matérias.
4. Como `/diag` escolhe matéria/dia.
5. Rotas admin que usam lista de matérias ou `GRADE`.
6. Usos de `GRADE` em `index.html` ou `admin.html`.
7. O que entra no Commit 3 e o que fica para commits futuros.

Somente depois da inspeção, propor implementação pequena e pedir aprovação.

### Commit 4: resolver grade no fluxo principal backend

Escopo provável, após aprovação:

- Middleware/auth ou rota define `req.turmaId` e `req.grade` com fallback.
- Fluxo principal usa grade resolvida no lugar de `GRADE` onde necessário.
- Não mexer em cache por turma ainda.
- Não mexer em admin/front ainda, salvo payload mínimo do SSE se aprovado.

### Commit 5: cache por turma

Escopo:

- Incluir `turmaId` na chave de `cacheDia`.
- Atualizar limpeza de cache se necessário.
- Limpar cache: SIM apenas após merge/deploy na main.

### Commit 6: admin e usuário com turma

Escopo:

- Campo turma no cadastro/listagem.
- Persistir turma em usuários.
- Validar turma contra `TURMAS`.
- Fallback para usuários antigos.
- Endpoint novo só se necessário após inspeção.

### Commit 7: frontend e localStorage

Escopo:

- Receber `turmaId/turmaNome` se backend enviar.
- Mostrar turma se fizer sentido.
- Se mudar chave `chk_*`, preservar fallback da chave antiga para `3-ano`.

### Commit 8: documentação e ADR

Escopo:

- Criar `docs/decisions/003-multiturma-fase2.md`.
- Atualizar arquitetura e fase multi-turma.

## Sub-agentes obrigatórios

Usar sub-agentes:

- Antes da implementação da arquitetura.
- Antes de trocar usos reais de `GRADE`.
- Antes do PR final.

### Sub-agentes recomendados para revisão final

1. Segurança/auth/admin.
2. Backend/cache/parsers.
3. Frontend/SSE/localStorage.
4. Testes/rollback/operação.
5. Regressão do 3º ano.

## Loop obrigatório por etapa

Para cada commit:

```text
inspecionar → propor escopo → pedir aprovação se sensível → implementar pequeno → validar → revisar diff → corrigir → validar de novo → pedir aprovação de commit/push → commit/push branch
```

## Validações obrigatórias

Se `server.js` mudou:

```bash
npm run check:server
```

Se `index.html` mudou:

```bash
npm run check:index
```

Se parser/matéria/cache mudou:

- Usar `/diag` ou fixtures reais em `test-fixtures/`.
- Lembrar Carlos de remover `senha=...` antes de colar links.

Antes de commit:

- Rodar `git status`.
- Rodar `git diff` dos arquivos da etapa.
- Procurar `senha=`, `ADMIN_SENHA`, `token`, `secret`, `api_key`.
- Não usar `git add .`.

## Quando pedir aprovação de Carlos

Pedir aprovação obrigatória:

- Antes de implementar Commit 3 ou posterior.
- Antes de criar endpoint novo.
- Antes de mudar cache.
- Antes de alterar `index.html`/localStorage.
- Antes de `git commit` e `git push`.
- Quando houver conflito ou erro Git perigoso.
- Quando houver dúvida sobre risco de produção.

Pode agir sem pedir nova aprovação apenas para:

- Ler arquivos.
- Rodar buscas.
- Rodar validações.
- Fazer inspeção.
- Gerar plano.

## Prompt curto para Carlos

Carlos pode iniciar com:

```text
Use orquestrar-multiturma-meu-estudo e continue do ponto atual da branch feature/multiturma-arquitetura.
```

Você deve então:

1. Rodar `git status`.
2. Identificar commits já feitos.
3. Identificar próximo commit do plano.
4. Se for etapa sensível, inspecionar antes.
5. Propor o próximo passo sem implementar se precisar de aprovação.

## Saída padrão ao terminar cada etapa

```text
Branch: [nome]
Commit: [hash se houve commit]
Etapa concluída: [nome]
Arquivos alterados: [lista]
Validações feitas: [lista]
Riscos restantes: [lista]
Próximo passo recomendado: [commit/etapa]
Limpar cache: SIM/NÃO, porque [motivo]
```

## Regra final

Velocidade importa, mas estabilidade importa mais. Se houver dúvida entre ir rápido e preservar o 3º ano, preservar o 3º ano.
