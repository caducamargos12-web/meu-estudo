# ADR 002 - Expansão multi-turma gradual

## Status

Proposto.

## Contexto

O Meu Estudo hoje é single-turma. A `GRADE` é fixa no código e todos os alunos veem a mesma grade. Carlos quer expandir para as 7 turmas da manhã, mas os professores, blogs e formatos podem variar.

## Decisão

Não adicionar todas as turmas de uma vez.

A expansão deve seguir fases:

1. Preparar arquitetura multi-turma mantendo fallback para 3º ano.
2. Adicionar uma turma piloto.
3. Validar parsers com dados reais.
4. Só depois replicar para outras turmas.

## Consequências

Benefícios:

- Menor risco para o 3º ano atual.
- Teste real antes de escalar.
- Menos chance de quebrar parsers.
- Rollback mais simples.

Trade-off:

- Expansão total demora mais, mas com risco controlado.
