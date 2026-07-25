---
name: debugar-materia-diag
description: Use quando uma matéria aparece vazia, errada, duplicada ou incompleta no Meu Estudo. Guia o diagnóstico usando /diag sem vazar ADMIN_SENHA.
---

# Debugar Matéria via /diag

Use esta skill quando uma matéria não aparece corretamente no Meu Estudo.

## Objetivo

Isolar se o problema está em:

- Blog do professor.
- Acesso ao HTML.
- Limpeza do Blogspot.
- Corte de texto.
- Parser determinístico.
- Prompt de IA.
- Cache.
- Renderização no frontend.

## Regra de segurança obrigatória

Antes de pedir link de `/diag`, diga ao Carlos:

```text
Antes de colar aqui, apague o trecho senha=... do link para não vazar a ADMIN_SENHA.
```

Nunca repetir senha em resposta.

## Coleta mínima

Pedir ao usuário:

1. Matéria com problema.
2. Dia da semana.
3. O que aparece em tela.
4. O que deveria aparecer.
5. Se possível, saída de `/diag` sem a senha.

Exemplo de URL conceitual:

```text
/diag?senha=SENHA&dia=ter&materia=quimica&raw=1
```

## Diagnóstico por camadas

### 1. Blog vazio ou URL errada

Sinais:

- `/diag` retorna texto muito curto.
- Conteúdo esperado não aparece nem no raw.
- Professor apagou ou mudou página.

Ação:

- Confirmar URL na `GRADE`.
- Verificar se o blog real tem conteúdo.
- Atenção: História usa `https://profgustavocnsanglo.blogspot.com/p/9-ano.html`, não `_4.html`.

### 2. Limpeza apagando conteúdo

Sinais:

- HTML bruto tem conteúdo, mas texto limpo não.
- Texto limpo fica só com título.
- Blog tem HTML muito aninhado.

Ação:

- Revisar `limparHtmlBlog`.
- Comparar modo agressivo vs modo suave.
- Garantir salvaguarda: se suave é muito maior que agressivo, usar suave.

### 3. Corte removendo o trecho importante

Sinais:

- Conteúdo esperado está no topo ou meio do blog.
- Texto final não contém a aula recente.

Ação:

- Confirmar regra de corte: ≤12000 mantém tudo; maior mantém primeiros 5000 + últimos 7000.
- Não voltar ao comportamento antigo de manter só o fim.

### 4. Rodapé/menu entrando no parser ou IA

Sinais:

- IA devolve lixo.
- Parser captura `Postagens (Atom)`, `Arquivo do blog`, `Pesquisar este blog`, etc.

Ação:

- Verificar corte por marcadores de rodapé.
- Garantir trava: só cortar se posição for maior que 100 caracteres.

### 5. Parser estreito demais

Sinais:

- Texto correto chegou, mas a função não reconhece.
- Formato do professor mudou.

Ação:

- Preferir regex determinístico quando possível.
- Usar IA como reserva, não como primeira opção se formato é previsível.
- Criar teste com trecho real do blog.

### 6. Cache antigo

Sinais:

- `/diag` mostra correto, mas tela mostra antigo.
- Mudança tocou parser ou processamento.

Ação:

- Orientar limpar cache.
- Resposta final: `Limpar cache: SIM`.

### 7. Frontend renderizando errado

Sinais:

- Backend retorna certo, SSE entrega certo, mas tela mostra errado.
- Problema em checkbox, agrupamento, Central de Deveres ou estado local.

Ação:

- Verificar `index.html`.
- Conferir `localStorage`.
- Testar em aba anônima.
- Se mexer só em front, geralmente `Limpar cache: NÃO`.

## Saída esperada

Retorne:

1. Causa provável.
2. Evidência observada.
3. Arquivo/função provável.
4. Fix recomendado.
5. Se precisa limpar cache.

Formato curto e prático.
