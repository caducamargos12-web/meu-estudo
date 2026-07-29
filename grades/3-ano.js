// Grade do 3º ano do Ensino Médio - CNS Anglo
// Atualizada em: 2026-07-29

module.exports = {
  seg: [
    { m:'Filosofia',      p:'Sandra Maisa',    url:'https://profsandracnsanglo.blogspot.com/p/3-ano-filosofia.html', tipo:'provaFinal', maxDiasDever:14, avaliacaoPorData:true, avisoAvaliacao:'Prova com consulta à apostila. Estude as páginas indicadas.' },
    { m:'Geografia',      p:'Gabriel Fonseca', url:'https://profgabrielcnsanglo.blogspot.com/p/3-ano-geografia.html', ignorarAvaliacao:true, testeAulaAnterior:true, maxDiasDever:14 },
    { m:'Prog. Lidere',   p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-lidere.html', tipo:'soDever', maxDiasDever:14 },
  ],
  ter: [
    { m:'História',       p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'História', tipo:'acumulativo' },
    { m:'Química B',      p:'Washington Gois', url:'https://profwashingtonanglo.blogspot.com/p/3-ano.html', formato:'testesPorData' },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, formato:'fisica', aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
  qua: [
    { m:'Linguística',    p:'Lenon Soares',    url:'https://proflenoncnsanglo.blogspot.com/p/3-ano-gramatica.html', formato:'duasAulas' },
    { m:'Matemática A',   p:'Tiago Santos',    url:'https://professoratiagocnsanglo.blogspot.com/p/3-ano-em-matematica-a_27.html', formato:'rotulado' },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Inglês',         p:'Jully Alvim',     url:'https://profjullycnsanglo.blogspot.com/p/3ano-em.html', tipo:'provaFinal', maxDiasDever:14 },
  ],
  qui: [
    { m:'Biologia',       p:'Angelita Pimenta',url:'https://profangelitacnsanglo.blogspot.com/p/3-ano.html', ignorarAvaliacao:true, testeNoDiaExato:true, maxDiasDever:14 },
    { m:'Matemática B',   p:'Saulo Rodrigues', url:'https://profsauloanglo.blogspot.com/p/mat-b.html', formato:'rotulosSaulo' },
    { m:'Química A',      p:'Maurélio',        url:'https://maureliopereiral.blogspot.com/p/3-ano.html', maxDiasDever:14, ignorarAvaliacao:true, testeNoDiaExato:true, deverFixo:'TAREFAS DO 2º BIMESTRE: todas as TC da Frente A', aviso:'O professor marcou no blog a data da prova final do bimestre, mas essa data está incorreta e deve ser ajustada por ele. A prova não é nesta data. Considere abaixo apenas a matéria do teste mais recente.' },
    { m:'Redação',        p:'Fábio',           url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14, ignorarAvaliacao:true, avaliacaoFixa:'Redação estilo ENEM' },
  ],
  sex: [
    { m:'Sociologia',     p:'Gustavo',         url:'https://profgustavocnsanglo.blogspot.com/p/9-ano.html', filtro:'Sociologia' },
    { m:'Biologia',       p:'Ulisses Antônio', url:'https://profulissescnsanglo.blogspot.com/p/3-ano.html', maxDiasDever:14, testeMarcado:true, ignorarAvaliacao:true },
    { m:'Redação e Literatura', p:'Fábio', combinar:[
      { m:'Redação',    p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Redação', tipo:'provaFinal', formato:'agrupado', maxDiasDever:14, ignorarAvaliacao:true, avaliacaoFixa:'Redação estilo ENEM' },
      { m:'Literatura', p:'Fábio', url:'https://proffabiocnsanglo.blogspot.com/p/3-ano.html', filtro:'Literatura', ignorarAvaliacao:true, interpretacaoComAnterior:true, maxDiasDever:14 },
    ] },
    { m:'Física',         p:'Leonardo José',   url:'https://profleonardojosecnsanglo.blogspot.com/p/3-ano.html', maxDeveres:1, formato:'fisica', aviso:'O professor de Física ficou afastado por motivo de saúde e um substituto assumiu as aulas, que podem não estar registradas no blog. Por isso, a análise de Física pode conter erros ou ficar desatualizada até o professor retornar e atualizar o conteúdo.' },
  ],
};
