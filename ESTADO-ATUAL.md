# Estado Atual do Meu Estudo - 2026-07-26

## Branches Ativas

- **`main`** → Produção. Sempre aqui que você sobe mudanças. Railway faz auto-deploy.

## Branches Deletadas (Limpas)

- ~~`ajuste-parsers-recesso-bimestre`~~ (deletada)
- ~~`ajuste-parsers-recesso-bimestre-v2`~~ (deletada, PR #3 fechada)

## Mudanças em Produção

### Commits Recentes (Finais)

1. **b713492** - Redesenhar UI modal redação (proporcional)
2. **ea35e56** - Diminuir velocidade welcome animation
3. **bd3d77c** - Corrigir timing welcome + modal redação
4. **afaede5** - Remover builder NIXPACKS deprecated
5. **682a92c** - Add Procfile (ajuda Railway detectar Node.js)

### O que Funciona Agora

✅ **Design/Frontend:**
- Tokenização de cores (--red-soft, --red-label, etc)
- :focus-visible padronizado (Tab navigation)
- Welcome animation: logo → nome (stagger 70ms) → frase (stagger 120ms) → loader
- Modal de redação: 680px (92vw) com UI proporcional e elegante
- cardIn otimizado (sem blur)

✅ **Backend/Parser:**
- Recesso + bimestre configurável
- Parsers de todas as matérias funcionando
- Cache de extração funcionando

✅ **Infrastructure:**
- Railway em `main` com auto-deploy
- Procfile presente para detectar Node.js
- NIXPACKS deprecated removido

## O que Não Fazer

❌ Não crie mais branches com nome longo como `ajuste-parsers-recesso-bimestre-v2`
❌ Não faça upload via GitHub web ("Add files via upload") — use git push
❌ Não mergeia PRs abertas sem revisar — sempre use Redeploy manual se quiser

## Fluxo Correto Daqui Pra Frente

1. Editar/testar localmente
2. `git add` + `git commit` + `git push origin main`
3. Railway auto-deploya (ou clica Redeploy se quiser forçar)
4. Limpar cache: `/api/limpar-cache?senha=SENHA` se mexeu em parser/leitura

## Próximas Etapas

- Validar retorno do 3º bimestre em agosto (Matemática A, Química B, História)
- Testar Correção de Redação em tela (já implementada)
- Possível expansão multi-turma (planejada, não iniciada)

---

**Tudo organizado, sem confusão!**
