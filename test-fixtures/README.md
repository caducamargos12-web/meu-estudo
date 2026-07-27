# Test fixtures - Meu Estudo

Esta pasta guarda exemplos reais de texto de blogs ou saídas do `/diag`, sempre sem senha.

## Regra de segurança

Nunca salvar URLs com `senha=...`.

Antes de criar fixture a partir de `/diag`, remover qualquer segredo.

## Estrutura recomendada

```text
test-fixtures/
├── mat-a/
├── quimica-b/
├── historia/
├── linguistica/
└── turma-piloto/
```

## Nome recomendado

```text
YYYY-MM-DD-materia-caso.txt
```

Exemplo:

```text
2026-08-05-quimica-b-prova-raa.txt
```

## Como usar

```powershell
node scripts/test-parser.js quimica-b test-fixtures/quimica-b/2026-08-05-quimica-b-prova-raa.txt
```

O script inicial ainda é um harness simples. Conforme parsers forem extraídos em funções mais puras, conectar cada parser ao script.
