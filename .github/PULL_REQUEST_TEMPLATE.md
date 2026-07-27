# Checklist do Pull Request - Meu Estudo

## Tipo de mudança

- [ ] Documentação/skills
- [ ] Frontend simples
- [ ] `index.html` com JavaScript
- [ ] `server.js`
- [ ] Parser/matéria
- [ ] Cache/IA/auth/GRADE
- [ ] Multi-turma

## Validações obrigatórias

- [ ] `git status` revisado
- [ ] `git diff` revisado
- [ ] Sem `git add .` quando havia arquivos misturados
- [ ] Sem senha, token, `ADMIN_SENHA`, `api_key` ou segredo no diff
- [ ] `node -c server.js` rodado se `server.js` mudou
- [ ] `node scripts/validate-index-scripts.js` rodado se `index.html` mudou
- [ ] `/diag` ou fixture real usado se parser/matéria/cache mudou
- [ ] Aba anônima prevista para teste pós-deploy

## Cache

Limpar cache: SIM/NÃO

Justificativa:

## Riscos e rollback

Risco principal:

Rollback sugerido:

## Observações para Carlos

Próximo passo depois do merge:
