use o agente strict-tdd-developer e depois de todo ciclo tdd rode npx 
convex dev e garanta que tudo está passando, então faça stage das alterações do clico e use agente conventional-commit fazendo commit de todas as alterações daquele ciclo. Então o fluxo para cada ciclo é: agente strict-tdd-developer -> npx 
convex dev -> correções necessárias -> atualizar doc de tasks com as concluidas -> stash das alterações -> agente conventional-commit
E repita isso para cada ciclo, não devemos fazer um commit geral com todos os ciclos de uma unica vez. Extremamente importante, atualize as tasks concluidas as marcando com X, nunca pular.
