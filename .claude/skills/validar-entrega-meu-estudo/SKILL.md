---
name: validar-entrega-meu-estudo
description: Use antes de qualquer entrega com mudança em server.js, index.html ou lógica do Meu Estudo. Valida sintaxe, lógica, cache e riscos antes de entregar.
---

# Validar Entrega - Meu Estudo

Use esta skill antes de entregar qualquer alteração no projeto Meu Estudo.

## Objetivo

Evitar que uma mudança com erro de sintaxe, quebra de parser, vazamento de segredo ou cache desatualizado derrube o app em produção.

## Checklist obrigatório

### 1. Identificar arquivos alterados

Rode:

```bash
git diff --name-only
```

Classifique a mudança:

- Backend: `server.js`.
- Frontend: `index.html`.
- Admin: `admin.html`.
- Configuração: `package.json`, `railway.json`.
- Documentação: `docs/`, `CLAUDE.md`, `.claude/skills/`.

### 2. Validar server.js

Se `server.js` mudou, rode:

```bash
node -c server.js
```

Se falhar, não entregue. Corrija antes.

### 3. Validar scripts do index.html

Se `index.html` mudou, extraia os blocos `<script>` e valide com Node.

Abordagem recomendada:

1. Criar arquivo temporário com o conteúdo dos scripts.
2. Rodar `node -c arquivo-temporario.js`.
3. Corrigir qualquer erro antes de entregar.

Atenção: erro de sintaxe no frontend pode quebrar a experiência inteira do aluno.

### 4. Validar segredos

Rode ou revise:

```bash
git diff
```

Procure por:

- `senha=`
- `ADMIN_SENHA`
- `token`
- `secret`
- `api_key`
- `ANTHROPIC_API_KEY`

Nunca entregar segredo em código, commit ou documentação.

### 5. Testar lógica com dado real

Se a mudança toca leitura, parser, cache ou matéria, usar conteúdo real.

Fontes:

- `/diag`.
- Conteúdo real do blog.
- Casos conhecidos documentados em `docs/bugs-resolvidos.md`.

Não confiar só em teste mental.

### 6. Decidir limpar cache

Limpar cache: SIM se mexeu em `fetchBlog`, `fetchBlogCompleto`, `limparHtmlBlog`, parser de matéria, `processWithAI`, `comMateriais`, `GRADE`, formato de saída de matérias, regras de data ou cache de extração.

Limpar cache: NÃO se mexeu apenas em CSS, texto visual, layout, overlay isolado, documentação ou endpoint independente que não afeta matérias.

Se houver dúvida e a mudança tocar matéria, marque SIM.

### 7. Resposta final obrigatória

Toda entrega precisa terminar com:

```text
Limpar cache: SIM/NÃO
```

Com uma justificativa curta.

## Padrão de entrega

Retorne para Carlos:

1. O que foi alterado.
2. Como foi validado.
3. O que ele precisa fazer no GitHub/Railway.
4. Limpar cache: SIM/NÃO.

Sem explicação longa desnecessária.
