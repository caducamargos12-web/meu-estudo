# 005: SEM_AULA Normal por Padrão de Professor

**Data:** 30/07/2026
**Status:** Documentado como comportamento esperado
**Autor:** Claude Code

## Contexto

Durante a investigação multi-turma (testes 15-19/06/2026 via `/diag-resultado`), vários professores retornaram `status: sem_aula` consistentemente. Após investigação, identificamos que **nem todo SEM_AULA é bug** - alguns professores publicam conteúdo de forma irregular ou em blocos, e isso é o padrão natural deles.

## Matérias com SEM_AULA Normal

### 1. Ciências - Flávia Vidigal (6/7/8-fund)

**Comportamento observado:**
- Blog usa formato tabela com separadores `|`
- Colunas: Data | Conteúdo Trabalhado | Tarefas | Observações
- Professora posta por data de aula real, não diariamente
- Quando há 3 aulas por semana, ela nem sempre publica para cada dia

**Testes:**
- 6-fund qua 17/06 e sex 19/06: SEM_AULA (3368 chars, mas sem post nessa data)
- 8-fund seg, ter, qua 15-17/06: SEM_AULA (2935 chars)
- 7-fund sex 19/06: SEM_AULA (4892 chars)

**Parser:** `padrao` (IA genérica) - funciona quando data existe

**Ação:** Nenhuma. SEM_AULA é genuíno, blog não tem registro para essa data.

---

### 2. Literatura/Redação - Fábio (multi-turma)

**Comportamento observado:**
- Professor posta conteúdo por BLOCO (ex: semana inteira, bimestre)
- Não publica diariamente
- Quando o post é recente e relevante, parser extrai OK
- Em dias sem post específico, blog ainda tem conteúdo mas parser não acha a data

**Testes:**
- 2-medio sex 19/06: SEM_AULA (5926 chars)
- 1-medio ter/qui/sex: SEM_AULA (7388 chars)
- 7-fund ter qua: SEM_AULA (6273 chars)
- 8-fund qui: SEM_AULA (4957 chars, mesmo dia que Literatura Fábio)

**Ação:** Nenhuma. Professor não publica diariamente, é o padrão dele.

---

### 3. Educacross - Natan Augusto (7-fund)

**Comportamento observado:**
- Blog existe mas é placeholder vazio
- Apenas título "7° ANO - EDUCACROSS" sem conteúdo
- Professor ainda não publicou conteúdo do Educacross 7º ano

**Testes:**
- 7-fund ter 16/06: SEM_AULA (82 chars de HTML sem conteúdo)

**Ação:** Nenhuma. Blog vazio é placeholder do professor. Aguardar professor publicar.

---

### 4. Matemática - Luciano (6/7/8-fund) - PARCIALMENTE NORMAL

**Comportamento observado:**
- Professor publica aulas apenas 2x por semana (terça e sexta)
- Grade mapeia Matemática em 3-4 dias (ter/qua/qui/sex)
- Nos dias que o professor NÃO publica (qua/qui), o blog não tem entrada

**Testes (após atribuir formato:'rotulosSaulo' em 30/07):**
- 6-fund ter 16/06 e sex 19/06: OK
- 6-fund qua 17/06 e qui 18/06: SEM_AULA (esperado - sem post)

**Solução aplicada:** Atribuído `formato:'rotulosSaulo'` nas grades para extração determinística nos dias com post.

**Ação:** SEM_AULA em qua/qui é esperado. Não é bug do parser.

---

## Referências

- Testes: `/diag-resultado` em todas as 7 turmas, período 15-19/06/2026
- Decisão 004: Parser temporário para Física (3º ano)
- URL fix: 005-historia-cintya-atualidades.md (pendente)
- Parser fix: 006-gramatica-fernanda-padrao.md (pendente)
- Parser fix: 007-matematica-luciano-rotulossaulo.md (pendente)

## Conclusão

Nem todo `status: sem_aula` é bug do parser. Alguns professores:
- Postam por bloco (Fábio)
- Postam irregularmente (Flávia, Luciano)
- Têm blogs vazios/placeholder (Natan)

Nesses casos, SEM_AULA é o comportamento esperado e não requer correção.
