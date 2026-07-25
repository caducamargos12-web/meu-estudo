# Segurança - Meu Estudo

## Regra crítica sobre ADMIN_SENHA

A senha de admin já vazou duas vezes em links de `/diag` colados no chat.

Regra permanente:

Antes de Carlos colar qualquer link de `/diag`, orientar:

`Apague o trecho senha=... antes de mandar o link aqui.`

Nunca incluir senha real em:

- Resposta do assistente.
- Commit.
- Documentação.
- Print.
- Link colado no chat.
- Arquivo versionado.

Se houver suspeita de vazamento, orientar troca imediata na Railway:

Railway → projeto → Variables → `ADMIN_SENHA` → atualizar → redeploy.

## Rotas sensíveis

### `/diag`

Protegida por `ADMIN_SENHA`.

Usada para depuração de blogs.

Riscos:

- Exposição do conteúdo processado.
- Vazamento da senha em URL.
- Compartilhamento acidental de links com credencial.

Regra: usar só para diagnóstico controlado.

### `/api/limpar-cache`

Protegida por senha.

Usar apenas quando mudança afeta leitura, parsing, cache ou processamento de matérias.

### `/api/redacao`

Protegida por `auth` e `rateLimitGeral`.

Riscos:

- Abuso de custo de IA.
- Texto muito grande.
- Dados pessoais em redações.

Controles existentes:

- Limite diário por aluno.
- Cache por texto idêntico.
- Validação de tamanho.

## Dados de menores

Como o app é usado por alunos, possivelmente menores de idade, evitar coletar dados desnecessários.

Princípios:

- Coletar só o necessário para autenticação e operação.
- Evitar logs com conteúdo sensível.
- Não armazenar senhas de terceiros.
- Não automatizar acesso a plataformas como Plurall em nome do aluno.

## Plurall

Nunca construir solução que:

- Guarde senha do aluno.
- Faça login no Plurall no lugar do aluno.
- Leia apostilas protegidas para resolver respostas.
- Submeta dever ou redação no lugar do aluno.

Alternativa aceitável:

- Ajudar o aluno a estudar.
- Explicar questão enviada pelo próprio aluno.
- Corrigir redação colada pelo aluno para orientação.
- Organizar links, deveres e materiais.

## IA e risco acadêmico

Regra de decisão:

Se a feature faz no lugar do aluno, rejeitar ou redesenhar.

Se a feature ajuda o aluno a fazer melhor, pode ser considerada.

Exemplos rejeitados:

- Resolver dever do Plurall em massa.
- Robô lendo apostila e salvando resposta.
- IA escrevendo e submetendo redação no lugar do aluno.

Exemplos aceitáveis:

- Central de deveres.
- Correção orientativa de redação.
- Explicação passo a passo de questão enviada pelo aluno.
- Resumos e simulados por assunto.

## Checklist antes de deploy

Antes de subir mudança:

1. Verificar se nenhum segredo foi adicionado ao código.
2. Rodar `git diff` procurando por `senha`, `token`, `key`, `secret`, `ADMIN_SENHA`.
3. Validar sintaxe de `server.js` e scripts do `index.html`.
4. Confirmar se a mudança exige limpar cache.
5. Testar em aba anônima depois do redeploy.
