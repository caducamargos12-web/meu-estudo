---
name: revisar-custo-ia
description: Use quando uma feature do Meu Estudo usa IA, como redação, resumo, simulado ou resolução de questão. Estima custo e impacto no preço.
---

# Revisar Custo de IA - Meu Estudo

Use antes de aprovar ou implementar qualquer feature que chame IA.

## Objetivo

Evitar feature com custo imprevisível ou margem ruim. Separar features que são argumento de venda de features que exigem aumento de preço.

## Dados-base do negócio

- Preço atual: R$ 20 por aluno por mês.
- Railway: custo fixo estimado em R$ 60 por mês, pendente de confirmação real.
- IA atual costuma ser barata porque há cache por dia, assunto ou texto.
- Haiku é o modelo principal.
- Sonnet é reserva.

## Perguntas obrigatórias

1. A IA roda por aluno, por matéria, por dia ou por texto único?
2. Existe cache?
3. O mesmo resultado pode ser compartilhado entre alunos?
4. Existe limite de uso por aluno?
5. O modelo precisa ser Sonnet ou Haiku basta?
6. A feature tem imagem? Se sim, custo pode subir.
7. A feature aumenta valor percebido ou só adiciona custo?

## Fórmula simples

```text
custo_mensal = custo_por_uso × usos_por_aluno_por_mes × alunos
custo_por_aluno = custo_por_uso × usos_por_aluno_por_mes
```

Depois comparar com R$ 20/mês.

## Classificação

### Verde

Custo menor que R$ 0,50 por aluno/mês.

Decisão provável: não muda preço. Usar como argumento de venda.

### Amarelo

Custo entre R$ 0,50 e R$ 2,00 por aluno/mês.

Decisão provável: manter, mas com limite de uso e monitoramento.

### Vermelho

Custo acima de R$ 2,00 por aluno/mês ou imprevisível.

Decisão provável: aumentar preço, criar plano premium, limitar uso ou não construir.

## Referências internas

### Correção de redação

Custo estimado: cerca de R$ 0,02 por correção.

Uso realista: 6 correções/mês por aluno.

Custo por aluno: cerca de R$ 0,12/mês.

Conclusão: não muda preço.

### Resolver questão por foto

Custo estimado:

- Haiku: cerca de R$ 0,03 por resolução completa.
- Sonnet: cerca de R$ 0,10 por resolução completa.

Pior caso: 1 foto por aluno por dia, 20 dias.

Conclusão: pode justificar aumento de preço ou limite rígido.

## Saída esperada

Retorne:

```text
Custo estimado por uso: R$ X
Uso mensal estimado por aluno: Y
Custo mensal por aluno: R$ Z
Classificação: Verde/Amarelo/Vermelho
Impacto no preço de R$ 20: manter/aumentar/criar limite
Recomendação: construir/não construir/testar primeiro
```

Se houver incerteza, diga exatamente qual dado precisa ser medido antes de decidir.
