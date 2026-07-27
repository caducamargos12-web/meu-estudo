# Operação - Meu Estudo

## Deploy

Claude não faz deploy.

Fluxo operacional:

1. Alterar arquivos localmente.
2. Validar sintaxe e lógica.
3. Carlos sobe os arquivos no GitHub.
4. Carlos faz redeploy na Railway.
5. Se necessário, Carlos limpa cache.
6. Carlos testa em aba anônima.

## Quando limpar cache

### Limpar cache: SIM

Quando a mudança afeta:

- Leitura de blogs.
- Processamento de matéria.
- Parser de qualquer matéria.
- Função `limparHtmlBlog`.
- `fetchBlog` ou `fetchBlogCompleto`.
- `comMateriais`.
- `GRADE`.
- Cache por dia.
- Formato de saída enviado ao frontend.

### Limpar cache: NÃO

Quando a mudança é:

- Apenas visual no frontend.
- Texto de botão ou layout.
- Overlay sem alterar dados.
- Endpoint isolado que não mexe na leitura de matéria, como `/api/redacao`.
- Correção CSS.

Se houver dúvida, preferir SIM quando a mudança toca dados de aula.

## Validação antes de entrega

### server.js

Rodar:

```bash
npm run check:server
```

Equivalente direto:

```bash
node -c server.js
```

### index.html

Rodar:

```bash
npm run check:index
```

Esse comando usa `scripts/validate-index-scripts.js` para extrair e validar scripts inline do `index.html`.

### Teste com dados reais

Sempre que mexer em matéria ou parser, usar `/diag`.

Exemplo conceitual:

```text
/diag?senha=SENHA&dia=ter&materia=quimica&raw=1
```

Antes de colar link em chat, apagar `senha=...`.

## Teste pós-deploy

Após Railway redeploy:

1. Abrir em aba anônima.
2. Logar com usuário real ou teste.
3. Conferir matéria alterada.
4. Conferir console do navegador se mexeu no frontend.
5. Conferir logs Railway se mexeu no backend.
6. Se mexeu no cache, rodar limpar cache e testar novamente.

## Commits recomendados

Usar Conventional Commits:

- `fix(parser): corrigir leitura de Matemática A`
- `feat(redacao): adicionar correção por competência ENEM`
- `chore(docs): adicionar documentação de arquitetura`
- `refactor(cache): separar grade por turma`

## Regra de rollback

Antes de mudança grande:

1. Criar branch ou worktree.
2. Garantir que main está estável.
3. Fazer commit pequeno e reversível.
4. Se quebrar produção, reverter commit ou voltar versão anterior no GitHub/Railway.

## Pendências operacionais

- Confirmar custo real mensal da Railway.
- Confirmar se últimas versões de `server.js` e `index.html` já estão no GitHub/Railway.
- Testar Central de Deveres.
- Testar Correção de Redação.
- Confirmar matérias em agosto.
