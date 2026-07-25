# Meu Estudo - SaaS de Agregação de Aulas

## Contexto do projeto

Meu Estudo é um micro-SaaS em Node.js/Express hospedado na Railway. Ele agrega os blogs Blogspot dos professores do CNS Anglo em uma visão diária de estudo, evitando que o aluno precise entrar em vários blogs para saber aula do dia, deveres, TM/TC e datas de prova.

## Dono e operação

- Dono: Carlos, aluno do 3º ano do CNS Anglo, Brasil.
- Repositório GitHub: `caducamargos12-web/meu-estudo`.
- Branch principal: `main`.
- App em produção: `https://meu-estudo-production.up.railway.app`.
- Admin: `/admin`.
- Modelo de receita: assinatura de alunos, R$ 20 por mês.
- Carlos faz deploy manualmente via GitHub + Railway.

## Modelo de deploy

Claude nunca deve fazer deploy diretamente.

Fluxo correto:

1. Claude edita a cópia de trabalho local.
2. Carlos sobe o arquivo no GitHub.
3. Carlos clica em Redeploy na Railway.
4. Carlos limpa cache via `/api/limpar-cache?senha=SENHA` quando a mudança afeta leitura, parsing, cache ou processamento de matéria.
5. Carlos testa em aba anônima.

Toda entrega de código deve terminar com:

`Limpar cache: SIM/NÃO`

Com uma justificativa curta.

## Arquivos principais

- `server.js`: backend principal, aproximadamente 2850 linhas.
- `index.html`: frontend principal, aproximadamente 1360 linhas.
- `admin.html`: área administrativa.
- `package.json`: dependências e scripts.
- `railway.json`: configuração de deploy.

## Arquitetura do server.js

### Grade

A `GRADE` é um objeto fixo no código, por volta da linha 650-700. Ela mapeia matéria para `{m, p, url, formato/tipo, filtro...}` por dia da semana.

Estado atual: single-turma. Todos os alunos veem a mesma grade. Não existe ainda conceito de aluno pertencendo a uma turma.

### Fluxo de leitura dos blogs

Fluxo principal:

`fetchBlog(url)` → `obterHtml()` → `limparHtmlBlog(html, removerBlocos)` → corte de tamanho → cache de 10 minutos → processamento por matéria.

Observações importantes:

- `obterHtml()` tenta acesso direto e proxies.
- `limparHtmlBlog()` tem modo agressivo e modo suave.
- Se o modo agressivo remove corpo demais, o modo suave deve ser usado.
- `fetchBlogCompleto` retorna texto completo sem corte.
- Cache de extração é por dia: `cacheDia`, chave baseada em `isoEfetivo()+dayKey`.

### Funções importantes

- `dataParaNum('DD/MM')`: converte data para número AAAAMMDD para comparar datas sem depender de zero à esquerda.
- `agoraEfetivo()` e `isoEfetivo()`: viram o dia às 22:30 no horário de Brasília, independentemente do fuso da Railway.
- `comMateriais`: ponto universal de regras de exibição. Roda tanto no cache quanto no caminho fresco.
- `/diag`: rota protegida por `ADMIN_SENHA`, essencial para depurar texto cru/limpo por matéria e dia.

### Processamento por matéria

- História: `processarHistoria`, usa IA, tipo acumulativo.
- Linguística: `processarDuasAulas`, usa regex primário via `parseAulasRegex`, IA só como reserva.
- Física: `processarFisica`, usa IA.
- Química B: `processarTestesPorData`, regex puro, sem IA.
- Matemática A: formato `rotulado`, tem fallback determinístico.
- Redação: formato `agrupado`, usa IA.
- Geografia, Biologia, Química A e Literatura: formato tabela/padrão, usam IA.
- Matemática B: `rotulosSaulo`, regex/sem IA.
- Filosofia e Inglês: `provaFinal`, regex/sem IA.
- Programação Lidere: `soDever`, regex/sem IA.

## Arquitetura do index.html

- Dados chegam via streaming SSE.
- Cada `msg.item` representa o resultado de uma matéria.
- Checkbox de dever feito usa `localStorage` com chave determinística `chk_{materia}_{grupo}_{hash-do-texto}`.
- A Central de Deveres reutiliza o mesmo estado dos cards.
- `toggleDever(id, el)` sincroniza todos os checkboxes com o mesmo `data-devid`.
- Overlay padrão usa `<div class="rep-overlay">` com `<div class="rep-modal">`.
- Front envia `x-session-token` do `localStorage`.
- Back recebe usuário via middleware `auth`, em `req.user`.

## Modelos de IA

`const MODELS = ['claude-haiku-4-5-20251001','claude-sonnet-4-6']`

Haiku é o modelo principal. Sonnet é reserva.

Regra de negócio: IA deve ser usada com parcimônia. Sempre que for possível usar parser determinístico confiável, preferir código. IA deve ser reserva ou camada de interpretação quando regex não for suficiente.

## Regras críticas de qualidade

Antes de qualquer entrega com código:

1. Rodar `node -c server.js` se `server.js` foi alterado.
2. Se `index.html` foi alterado, extrair os blocos `<script>` e validar com `node -c`.
3. Testar a lógica nova com dados reais, preferencialmente via `/diag` ou conteúdo real de blog.
4. Não confiar só em validação de sintaxe.
5. Explicar se precisa limpar cache.
6. Não entregar mudança parcial como se estivesse completa.

## Segurança

A `ADMIN_SENHA` já vazou duas vezes em links de `/diag` colados no chat. Regra permanente:

Sempre orientar Carlos a apagar o trecho `senha=...` antes de colar qualquer link de `/diag`.

Nunca colocar senha, token, chave de API ou URL com segredo em commit, documentação pública ou resposta final.

## Automações rejeitadas

Não sugerir nem construir, salvo se Carlos pedir explicitamente para revisitar com nova análise:

1. Automação de deveres do Plurall via gabarito de um aluno representante replicado para a turma.
2. Robô acessando Plurall para ler apostilas, resolver e guardar respostas.
3. Automação que escreve e submete redações no lugar do aluno.

Padrão de decisão: se a automação faz no lugar do aluno, tende a ser risco acadêmico e de negócio. Se ajuda o aluno a fazer, organizar, estudar, receber feedback ou entender, tende a ser legítima e vendável.

## Features recentes

### Central de Deveres

- Implementada em `index.html`.
- Não altera `server.js`.
- Agrupa deveres pendentes por matéria.
- Reutiliza a mesma chave de estado dos cards.
- Botão final abre Plurall.
- Limpar cache: NÃO.
- Pendente: testar em tela com deveres reais após o recesso.

### Correção de Redação

- Endpoint: `POST /api/redacao`.
- Protegido por `auth` e `rateLimitGeral`.
- Entrada: texto colado, não foto.
- Correção baseada nas 5 competências do ENEM.
- Nota total recalculada no servidor.
- Limite: 1 correção por aluno por dia.
- Cache por texto idêntico.
- Arquivos persistidos: `redacao_uso.json` e `redacao_cache.json`.
- Limpar cache: NÃO.
- Pendente: Carlos testar em tela.

### Resolver questão por foto

Ainda não construída. Apenas desenhada.

Decisão atual: não construir agora. Validar interesse dos alunos primeiro. Se avançar, testar Haiku vs Sonnet com exercícios reais e provavelmente subir preço por causa de custo maior.

## Expansão multi-turma

Planejada, não iniciada.

Estado atual:

- App é single-turma.
- Outras 6 turmas da manhã têm professores e blogs diferentes.
- Todos usam Blogspot, o que ajuda, mas não elimina o trabalho.
- Fase 2 será arquitetura multi-turma: aluno pertence a uma turma, grade por turma, app carrega grade certa.
- Só começar depois de Carlos terminar ajustes da base do 3º ano.

## Pendências abertas

- Carlos precisa especificar quais ajustes quer fazer na base do 3º ano antes da expansão.
- Testar Central de Deveres em tela com deveres reais.
- Testar Correção de Redação em tela.
- Confirmar em agosto: Matemática A, Química B com PROVA/RAA e História.
- Tornar parser determinístico da Matemática A primário, mas só depois de validação real em tela.
- Confirmar valor real mensal da Railway.
- Construir arquitetura multi-turma depois dos ajustes da base.
- Validar interesse dos alunos antes de investir em features novas.

## Preferências de resposta para Carlos

- Português.
- Direto, estruturado e prático.
- Tom de conselheiro estratégico, não validador automático.
- Não usar travessão em texto visível ao usuário.
- Apontar riscos e contrapontos com honestidade.
- Perguntar antes de implementar quando houver ambiguidade.
- Em código, priorizar estabilidade, validação e manutenção simples.
