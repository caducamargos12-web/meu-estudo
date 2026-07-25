# Features - Meu Estudo

## Central de Deveres

Status: construída, ainda pendente de teste em tela com deveres reais.

Arquivo alterado: `index.html`.

Não houve mudança em `server.js`.

### O que faz

- Exibe painel fixo no topo do dia, acima dos cards.
- Junta todos os deveres de todas as matérias do dia.
- Inclui deveres de hoje e pendentes.
- Agrupa por matéria com emoji.
- Usa a mesma chave de estado `_devId` que os cards já usavam.
- Marcar como feito na Central marca no card, e vice-versa.
- Exibe contador de progresso `X/Y feitos`.
- Ignora itens de prévia.
- Exibe estado vazio: `Tudo em dia! Nenhum dever pendente.`
- Botão final: `Abrir Plurall (aba Tarefas)` apontando para `https://www.plurall.net`.

### Decisão sobre Plurall

Não tentar abrir tarefa específica no Plurall.

Motivos:

- Os blogs não expõem ID da tarefa.
- Mesmo com ID, aluno precisa estar logado.
- App não deve guardar senha/sessão de alunos no Plurall.
- Deep link para app Plurall foi testado e abriu no navegador.

Decisão permanente: manter botão simples para Plurall. Não insistir em automação de login ou deep link desconhecido.

### Cache

Limpar cache: NÃO.

É mudança front-end.

## Correção de Redação

Status: construída, pendente de teste real em tela pelo usuário.

Arquivos alterados: `server.js` e `index.html`.

### Backend

Endpoint: `POST /api/redacao`.

Proteções:

- `auth`.
- `rateLimitGeral`.

Entrada:

- Texto colado.
- Não aceita foto.

Regras:

- Texto com menos de 200 caracteres é rejeitado.
- Texto com mais de 6000 caracteres é rejeitado.
- Limite de 1 correção por aluno por dia.
- Mesmo texto reenviado usa cache e não conta de novo.

Persistência:

- `redacao_uso.json`.
- `redacao_cache.json`.

Correção:

- Usa as 5 competências oficiais do ENEM.
- Nota de 0 a 200 por competência em múltiplos de 40.
- Comentário simples de 2-3 frases por competência.
- Nota total é recalculada no servidor, não aceita soma da IA.

### Frontend

- Botão no header.
- Overlay com textarea.
- Contador de caracteres.
- Resultado mostra nota total grande.
- Mostra cada competência com nota colorida.
- Aviso fixo: correção automática para orientar estudo, não substitui nota oficial do professor.

### Custo

Estimativa realista: aproximadamente R$ 0,02 por correção.

Projeção realista: cerca de R$ 0,12 por aluno por mês com 6 correções/mês.

Conclusão: não justifica aumentar preço. Serve como argumento de venda.

### Cache

Limpar cache: NÃO.

Endpoint isolado, não mexe na leitura de matérias.

## Resolver questão por foto

Status: desenhada, não construída.

Decisão atual: não construir agora.

### Motivos para cautela

- Custo imprevisível.
- Pode precisar de Sonnet para exatas.
- Pode virar cola, não estudo.
- IA pode errar conta com confiança.
- Mercado já tem concorrentes gratuitos, como Photomath e Gauth.

### Desenho se avançar no futuro

Entrada:

- Foto.
- Texto digitado/colado.

Saída:

- Explicação passo a passo.
- Resposta final, nunca isolada.

Controle:

- Começar com Haiku.
- Subir para Sonnet só se testes reais exigirem.
- Limite de 1 imagem por aluno por dia.
- Cache por questão idêntica.

### Custo estimado

- Só imagem reduzida: cerca de R$ 0,01 a R$ 0,014.
- Resolução completa com Haiku: cerca de R$ 0,03.
- Resolução completa com Sonnet: cerca de R$ 0,10.

### Decisão de negócio

Se for construída, provavelmente deve justificar aumento de preço, porque é a única feature com custo por uso relevante.
