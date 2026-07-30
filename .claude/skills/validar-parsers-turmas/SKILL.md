---
name: validar-parsers-turmas
description: Use para validar todas as turmas do Meu Estudo via /diag, identificar materias com problema, analisar formato dos blogs, corrigir URLs e parsers, e rodar loop ate tudo funcionar.
---

# Validar Parsers de Todas as Turmas

Use esta skill quando quiser testar se todas as turmas e materias do Meu Estudo estao puxando conteudo corretamente dos blogs.

## Quando usar

- Depois de adicionar turma nova.
- Depois de corrigir URLs.
- Quando as aulas voltarem e quiser validar tudo.
- Quando um aluno reportar materia vazia.
- Periodicamente para garantir que nada quebrou.

## Pre-requisitos

- Arquivo `.env` na raiz do projeto com ADMIN_SENHA e APP_URL.
- Script `scripts/test-diag.js` funcionando.
- Deploy atualizado na Railway.
- Cache limpo se houve mudanca recente em grades ou parsers.

## Fluxo completo

### Ciclo 1: rodar teste inicial

Rodar:

```bash
node scripts/test-diag.js
```

Analisar resultado:
- OK: materia funcionando, nenhuma acao necessaria.
- VAZIO: precisa investigar.

### Ciclo 2: classificar cada VAZIO

Para cada materia VAZIA, classificar em uma das categorias:

1. URL errada: a pagina do blog nao existe ou tem slug diferente.
   Acao: acessar blog do professor, encontrar URL correta, atualizar grades/*.js.

2. Blog sem conteudo (recesso/ferias): a pagina existe mas nao tem posts recentes.
   Acao: nenhuma. Aguardar aulas voltarem. Documentar como esperado em recesso.

3. Parser incompativel: o blog tem conteudo mas o parser nao entende o formato.
   Acao: analisar formato do blog, comparar com parsers existentes, propor ajuste.

4. Blog desativado: professor nao usa mais blog para aquela turma.
   Acao: remover materia da grade ou marcar como inativa.

### Ciclo 3: corrigir URLs erradas

Para cada URL errada:
1. Acessar pagina inicial do blog do professor.
2. Listar todas as paginas/abas disponiveis.
3. Identificar a pagina correta da turma.
4. Atualizar o arquivo grades/*.js correspondente.
5. Rodar npm run check:server.
6. Nao commitar sem aprovacao.

### Ciclo 4: analisar formato de blogs novos

Para cada blog com conteudo que o parser nao entende:
1. Acessar a URL da materia.
2. Ler o texto limpo ou usar /diag com raw=1.
3. Identificar o padrao de publicacao:
   - Datas no formato DD/MM?
   - Rotulos como Aula, Dever, TM, TC?
   - Tabelas?
   - Posts separados por data?
   - Formato livre?
4. Comparar com parsers existentes:
   - testesPorData: datas + testes/provas (regex puro).
   - rotulosSaulo: rotulos de modulo/capitulo (regex puro).
   - duasAulas: regex primario, IA fallback.
   - rotulado: IA com fallback deterministico.
   - fisica: IA especializado.
   - acumulativo: IA para historia/sociologia.
   - agrupado: IA para redacao.
   - provaFinal: regex para prova + resumo.
   - soDever: regex para deveres simples.
   - sem formato: IA padrao tabela.
5. Determinar qual parser existente e mais adequado.
6. Se nenhum parser existente servir, propor novo formato ou ajuste.

### Ciclo 5: implementar correcoes

Para cada correcao:
1. Alterar apenas o arquivo necessario (grades/*.js ou server.js se for parser).
2. Rodar npm run check:server.
3. Se alterou server.js, rodar node -c server.js.
4. Pedir aprovacao antes de commit.

### Ciclo 6: re-testar

Depois das correcoes:
1. Commitar e fazer push.
2. Aguardar deploy ou pedir redeploy.
3. Limpar cache se necessario.
4. Rodar node scripts/test-diag.js novamente.
5. Verificar se os VAZIOs foram resolvidos.
6. Se ainda houver VAZIOs, voltar ao Ciclo 2.

### Ciclo 7: documentar resultado

Quando todas as materias estiverem OK ou classificadas:
1. Listar materias funcionando.
2. Listar materias em recesso (aguardando aulas).
3. Listar materias removidas (blog inexistente).
4. Documentar decisoes em commit message ou docs/.

## Regras de seguranca

- Nunca expor ADMIN_SENHA em commit, log ou resposta.
- Nao alterar parsers existentes sem justificativa clara.
- Nao alterar index.html, admin.html, auth ou cache nesta skill.
- Manter fallback 3-ano funcional.
- Testar com npm run check:server antes de qualquer commit.
- Nao fazer push para main sem aprovacao.

## Formato de decisao por materia

```text
Turma | Materia | Professor | Status | Acao | Parser
6-fund | Matematica | Luciano | OK | nenhuma | padrao (IA)
7-fund | Ciencias | Flavia | VAZIO recesso | aguardar agosto | padrao (IA)
9-fund | Quimica | Washington | removida | blog sem pagina 9 ano | n/a
```

## Prompt curto para Carlos

Carlos pode iniciar com:

```text
Use validar-parsers-turmas.
Rode o teste completo e me diga quais materias precisam de atencao.
Para as que precisam de correcao, corrija automaticamente se for URL errada.
Para as que precisam de parser novo, me explique o formato e proponha solucao.
```

## Loop automatico

O agente deve repetir o ciclo ate:
- Todas as materias estarem OK ou classificadas como recesso/aguardando.
- Nao houver mais VAZIOs que possam ser corrigidos sem dados reais.
- O resultado final estiver documentado.

## Quando parar e pedir ajuda

- Blog com formato completamente novo que nenhum parser cobre.
- Professor que nao publica no blog (decisao de negocio: remover ou manter).
- Conflito entre turmas usando mesmo blog com conteudo misturado.
- Erro no server.js que nao passa em npm run check:server.
- Duvida sobre qual turma um professor realmente atende.
