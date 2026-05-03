use o agente strict-tdd-developer e depois de todo ciclo tdd rode npx 
convex dev e garanta que tudo está passando, então faça stage das alterações do clico e use agente conventional-commit fazendo commit de todas as alterações daquele ciclo. Então o fluxo para cada ciclo é: agente strict-tdd-developer -> npx 
convex dev -> correções necessárias -> stash das alterações -> agente conventional-commit
