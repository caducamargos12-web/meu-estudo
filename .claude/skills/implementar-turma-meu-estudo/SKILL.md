---
name: implementar-turma-meu-estudo
description: Use para adicionar uma nova turma ao Meu Estudo a partir de um arquivo de grade em grades/. Conecta a grade ao TURMAS, valida parsers e testa com /diag.
---

# Implementar Turma - Meu Estudo

Use esta skill para adicionar uma nova turma ao app a partir de um arquivo de grade ja criado.

## Pre-requisitos

- Arquivo de grade existente em `grades/<turma-id>.js`.
- Turma ja cadastrada em `TURMAS` do `server.js` com `ativa: false`.
- Branch/worktree separada.

## Fluxo de implementacao

### Passo 1: ler a grade

Ler `grades/<turma-id>.js` e confirmar estrutura:
- Cada dia (`seg`, `ter`, `qua`, `qui`, `sex`) com array de materias.
- Cada materia com `m`, `p`, `url` e opcionalmente `formato`, `tipo`, `filtro`, etc.

### Passo 2: conectar ao server.js

No `server.js`:
1. Adicionar `require('./grades/<turma-id>')` no topo (proximo dos outros requires).
2. Atualizar a entrada correspondente em `TURMAS` para apontar a grade importada.
3. Marcar `ativa: true` se for turma piloto ou ja validada.
4. Manter fallback para `3-ano`.

### Passo 3: validar sintaxe

```bash
npm run check:server
```

### Passo 4: testar parsers

Para cada materia na grade nova:
1. Identificar qual formato/parser e usado.
2. Verificar se o parser ja existe no app.
3. Se sim: marcar como "reutiliza parser existente".
4. Se nao: listar como "precisa de parser novo ou ajuste".

### Passo 5: coletar fixtures

Quando as aulas estiverem ativas:
1. Usar `/diag` para cada materia.
2. Salvar texto em `test-fixtures/<turma-id>/`.
3. Validar que o parser produz resultado correto.

### Passo 6: commit

Mensagem padrao:
```text
feat(turmas): ativar grade do <turma-id>
```

## Formato do arquivo de grade

```js
// grades/<turma-id>.js
module.exports = {
  seg: [
    { m:'Materia', p:'Professor', url:'https://...', formato:'tipo' },
  ],
  ter: [...],
  qua: [...],
  qui: [...],
  sex: [...],
};
```

## Parsers disponiveis no app

- `'fisica'`: processarFisica (IA).
- `'testesPorData'`: processarTestesPorData (regex puro).
- `'duasAulas'`: processarDuasAulas (regex + IA fallback).
- `'rotulado'`: processWithAI formato rotulado (IA + fallback deterministico).
- `'rotulosSaulo'`: regex puro para formato do Saulo.
- `'agrupado'`: processWithAI formato agrupado (IA).
- `'acumulativo'`: processarHistoria (IA).
- `'provaFinal'`: regex/IA para prova + resumo.
- `'soDever'`: regex puro so para deveres.
- sem formato: processWithAI padrao tabela (IA).

## Regras de seguranca

- Nao alterar grades de outras turmas.
- Nao alterar parsers existentes sem justificativa.
- Nao alterar cache, auth, /diag ou index.html.
- Nao fazer push para main sem aprovacao.
- Manter fallback 3-ano funcional.
- Testar com `npm run check:server` antes de commit.

## Para replicar em massa

Quando multiplas turmas forem adicionadas:
1. Criar cada arquivo em `grades/`.
2. Conectar cada uma em `TURMAS`.
3. Commitar uma turma por commit.
4. Validar cada uma separadamente.
5. Nao fazer commit gigante com todas as turmas juntas.
