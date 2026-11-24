# Migração separada para PM2 compilado no CT 110

**Estado:** preparação concluída no checkout isolado. Aceite depende de janela confirmada e teste em WhatsApp. A troca de perfil mantém a busca nova e o cache de governança desabilitados. O deploy dev permanece em execução.

## Artefato e rollback

O pacote compilado usa o SHA gravado no arquivo `BUILD-REVISION`. Confira o checksum antes de abrir. Ele contém os cinco entry points do ecosystem prod, as dependências isoladas e o cliente Prisma gerado para Linux com OpenSSL 3. A preparação mantém o checkout de origem e os dados do CT separados. A descompactação e o precheck no CT devem confirmar ABI, caminhos e engine Prisma antes da troca.

Antes da janela, capture de forma restrita o estado da API, os heartbeats, o perfil ativo, a configuração efetiva sem segredos e os horários do sistema. Proteja o dump PM2 atual e a versão anterior do artefato. O dump contém ambiente operacional. Preserve a sessão Baileys, caminhos de estado e credenciais fora do pacote. A sessão relativa deve continuar resolvendo para o mesmo diretório do gateway no perfil compilado. Preserve também os submódulos e alterações locais dos resolvers no checkout operacional.

## Sequência da janela

1. Valide o SHA, a configuração e os cinco entry points em staging. Mantenha `SEARCH_SOURCES_NATURAL_ENABLED=false` e `SEARCH_AI_ENABLED=false`. Confira precedência do ambiente PM2, do ecosystem e do `.env`. Mantenha o provedor conversacional atual.
2. Na janela, encerre os cinco processos anteriores antes de substituir os arquivos compilados e iniciar o ecosystem prod. O diretório deve corresponder ao caminho verificado pelo gancho de boot. Garanta uma instância de gateway/worker. Confira API autenticada, UI, media-resolver, heartbeats, fila, sessão conectada e `/ping`; então salve o dump e verifique modo 0600.
3. Faça reboot real do CT 110 e confira identidade do novo boot e horário do PID 1. Correlacione cron de botadmin, primeiro `SELECT 1` e `PING` autenticados, restauração PM2, saúde dos cinco processos, heartbeats e reconexão. Distingua PM2 online dos endpoints efetivamente prontos.
4. No chat de teste, envie `/reminder in 30s boot-compilado-ct110`. Correlacione criação, persistência, job, despacho do worker, envio do gateway e recibo do operador. Registre apenas IDs expurgados e horários.

Em caso de falha, encerre os cinco processos compilados, restaure a versão e o dump guardados no caminho original e execute a restauração como botadmin preservando a sessão. Valide endpoints, fila, WhatsApp e perfil. Evite salvar o estado de um deploy incompleto sobre o dump conhecido.

## Canário posterior

Só após os aceites de bancada e operação, configure backend privado aprovado e `SEARCH_AI_PROVIDER=ollama_sources`, com `SEARCH_AI_ENABLED=true` e flag natural ainda desligada. Teste `/search-ai` em chat direto autorizado. Em seguida habilite `SEARCH_SOURCES_NATURAL_ENABLED=true` e use a mesma consulta. Aceite uma resposta por entrada, português, condições preservadas, fontes recuperadas e inferência local correlacionada por execução. Para interromper, desligue as duas flags e reinicie apenas o gateway. [Runbook](search-sources-rollout.md)
