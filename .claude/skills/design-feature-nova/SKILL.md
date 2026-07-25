---
name: design-feature-nova
description: Use antes de construir qualquer feature nova no Meu Estudo. Avalia problema, risco acadêmico, custo, esforço e prioridade.
---

# Design de Feature Nova - Meu Estudo

Use esta skill antes de implementar uma feature nova.

## Objetivo

Evitar construir feature cara, arriscada, pouco usada ou que prejudique o posicionamento do Meu Estudo.

## Checklist de decisão

### 1. Problema

Responder:

- Qual dor real do aluno essa feature resolve?
- O aluno já reclamou disso ou é hipótese?
- Essa dor acontece todo dia, toda semana ou raramente?

### 2. Usuário-alvo

Responder:

- Aluno do 3º ano atual?
- Outras turmas futuras?
- Carlos/admin?
- Responsável financeiro?

### 3. Risco acadêmico

Pergunta central:

A feature faz no lugar do aluno ou ajuda o aluno a fazer?

Se faz no lugar do aluno, tendência é rejeitar.

Se ajuda o aluno a estudar, organizar, entender ou corrigir, tendência é aceitar.

### 4. Custo de IA

Se usar IA, rodar a lógica da skill `revisar-custo-ia`.

Classificar:

- Sem IA.
- IA barata com cache.
- IA por uso sem cache.
- IA com imagem.
- IA que pode exigir Sonnet.

### 5. Esforço técnico

Classifique esforço:

- P: menos de 2 horas.
- M: meio dia.
- G: 1-2 dias.
- GG: vários dias ou risco alto.

Considere:

- Mexe em `server.js`?
- Mexe em `index.html`?
- Precisa persistência em arquivo?
- Precisa nova rota?
- Precisa alterar auth?
- Precisa mexer na estrutura de dados?
- Pode quebrar SSE ou cache?

### 6. Impacto no negócio

Avaliar:

- Aumenta valor percebido do R$ 20/mês?
- Ajuda a reduzir churn?
- Ajuda a vender para outras turmas?
- Aumenta custo de suporte?
- Gera risco para relação com a escola?

### 7. Prioridade versus pendências

Comparar com pendências abertas:

- Testar Central de Deveres.
- Testar Correção de Redação.
- Confirmar matérias em agosto.
- Ajustar base do 3º ano.
- Multi-turma.

Não colocar feature nova acima de estabilidade sem motivo forte.

## Saída obrigatória

Retorne neste formato:

```text
Decisão: Construir / Não construir / Validar antes / Desenhar sem código

Motivo principal:
[1 parágrafo]

Riscos:
- [risco 1]
- [risco 2]

Esforço estimado:
[P/M/G/GG]

Custo estimado:
[se aplicável]

Próximo passo recomendado:
[ação concreta]
```

## Exemplos de decisão

### Correção de redação

Decisão: construir.

Motivo: ajuda o aluno a melhorar, não escreve no lugar dele. Custo baixo. Aumenta valor percebido.

### Submeter redação automaticamente no Plurall

Decisão: não construir.

Motivo: faz no lugar do aluno, alto risco acadêmico e reputacional.

### Resolver questão por foto

Decisão: validar antes.

Motivo: pode ajudar o aluno, mas custo e risco de virar cola são relevantes. Validar interesse e testar qualidade antes.
