---
name: loop-revisao-meu-estudo
description: Use em tarefas médias ou grandes do Meu Estudo para executar loops de implementação, validação, revisão e correção até a entrega ficar segura.
---

# Loop de Revisão - Meu Estudo

Use esta skill quando a tarefa envolver código, parser, cache, IA, auth, multi-turma ou qualquer risco de produção.

## Objetivo

Evitar entrega parcial. A IA deve implementar em ciclos pequenos, revisar o próprio trabalho, corrigir problemas encontrados e só então preparar Git.

## Loop padrão

### Ciclo 1: entender e planejar

1. Ler `CLAUDE.md`.
2. Ler docs relevantes.
3. Classificar tarefa com `decidir-workflow-meu-estudo`.
4. Propor plano curto.
5. Aguardar aprovação de Carlos se for categoria D, E ou F.

### Ciclo 2: implementar mínimo seguro

1. Alterar o menor conjunto possível de arquivos.
2. Evitar refatoração não pedida.
3. Preservar comportamento do 3º ano atual.
4. Não misturar feature com limpeza de código.

### Ciclo 3: validação automática

1. Se `server.js` mudou: rodar `node -c server.js`.
2. Se `index.html` mudou: extrair scripts e validar com `node -c`.
3. Rodar testes ou simulações existentes.
4. Revisar `git diff`.
5. Procurar segredos.

### Ciclo 4: validação com dado real

Obrigatório para matéria, parser, blog, cache e IA de extração.

Usar `/diag` ou conteúdo real do blog. Sempre lembrar Carlos de apagar `senha=...` antes de colar link.

### Ciclo 5: revisão crítica

Perguntar:

- Isso quebra alguma matéria existente?
- Isso altera cache?
- Isso muda formato enviado ao frontend?
- Isso afeta alunos já logados?
- Isso exige limpar cache?
- Existe rollback simples?

### Ciclo 6: correção

Se qualquer validação falhar, corrigir e voltar ao Ciclo 3. Não entregar com validação pendente tratada como concluída.

### Ciclo 7: entrega Git

Usar `entrega-git-meu-estudo` para commit/push e instruções finais.

## Quantidade de loops por tipo de tarefa

- Documentação: 1 loop de coerência.
- Front simples: 1 loop de sintaxe + revisão visual.
- Parser/matéria: no mínimo 2 loops, um sintático e um com dado real.
- Feature com IA: no mínimo 2 loops, um de custo/limite e um técnico.
- Multi-turma: loops por etapa/commit, nunca tudo de uma vez.

## Saída final

A resposta final deve incluir:

```text
O que foi implementado
Validações executadas
Riscos restantes
Próximo passo do Carlos
Limpar cache: SIM/NÃO
```
