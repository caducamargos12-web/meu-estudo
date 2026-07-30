# 004: Parser Temporário para Física (3º Ano)

**Data:** 30/07/2026
**Status:** TEMPORÁRIO até retorno do professor Leonardo José
**Autor:** Claude Code

## Problema

O professor Leonardo José de Física (3º ano) ficou afastado por motivo de saúde. Um substituto assumiu as aulas mas **não segue o mesmo formato de blog**:

- **Formato original (Leonardo):** estruturado com rótulos e aulas nomeadas
- **Formato do substituto:** lista cronológica de eventos/tarefas/testes, sem marcadores de "Aula:"

**Exemplo do blog do substituto em 16/06/2026:**
```
16/6 OLIMPIADAS _________________________ TESTE 22/5 LEIS DE NEWTON...
```

Este formato não é compatível com o parser especializado `fisica` (IA que espera estrutura específica).

## Impacto Observado

- `/diag-resultado?dia=ter&materia=Fisica` retornava `status: sem_aula`
- `/diag-resultado?dia=sex&materia=Fisica` retornava `status: sem_aula`
- Aula vazia apesar do blog ter 1326 caracteres de conteúdo

## Solução Implementada

**Arquivo:** `grades/3-ano.js`

**Mudança:**
- Linha 13 (terça): removido `formato: 'fisica'`
- Linha 37 (sexta): removido `formato: 'fisica'`

**Efeito:**
- Parser padrão (IA genérica) tenta interpretar o formato livre
- Se não houver aula estruturada no blog, retorna `status: sem_aula` (esperado)
- Não gera erro, apenas blog vazio (aceitável enquanto substituto estiver)

**Código:**
```javascript
// TEMPORÁRIO: Física usa parser genérico (padrao/IA) porque o substituto do prof. Leonardo
// usa formato de eventos/datas simples, não estruturado. Voltar para formato:'fisica'
// quando Leonardo retornar. (Testado 30/07/2026 - /diag-resultado falha com formato:'fisica')
{ m:'Física', p:'Leonardo José', url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, aviso:'...' },
```

## Comportamento Esperado

- **Antes:** `status: sem_aula` com `parser: fisica`
- **Depois:** `status: sem_aula` com `parser: padrao`
- **Motivo:** Blog do substituto não tem aula estruturada, mas não há erro

## Restauração

Quando Leonardo José retornar:

1. Reativar `formato: 'fisica'` nas linhas 13 e 37 de `grades/3-ano.js`
2. Remover os comentários TEMPORÁRIO
3. Commit: `fix(grade): Reativar parser especializado Física`
4. Testar com `/diag-resultado`

## Referências

- Issue: Testes 3º ano 15-19/06/2026 - Física SEM_AULA
- PR: #12 (rota /diag-resultado criada para diagnóstico)
- Teste: `/diag-resultado?turma=3-ano&dia=ter&materia=Fisica&dataRef=16/06/2026`
- Blog: https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html
