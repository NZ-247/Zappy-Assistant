# Aceite técnico de memória em 26/11/2026

O código candidato é 6f9226b4839d8096883fefe5190f243c717839bb, sobre b35b914. O diff completo inclui schema e migração, repositório de conversa, identidade e aliases, persistência e leitura de Message, escopo das portas de memória, ingresso e persona, sondas sintéticas e documentação. Os trabalhos existentes no checkout de produção foram preservados. Os commits 78cd3a3 e b35b914 constituem a contenção anterior.

## Execuções novas

Build e lint concluíram com saída 0. A chamada node --test --import tsx packages/{adapters,core}/test/*.test.ts apps/{wa-gateway,admin-api,worker}/test/*.test.ts passou 168 testes, saída 0. Logs novos em /tmp/memory-new-build.log, /tmp/memory-new-lint.log e /tmp/memory-new-tests.log. Os 168 testes dos logs anteriores são evidência histórica independente.

Criado PostgreSQL 16 descartável zappy-memory-acceptance, acessível somente por loopback, com schema anterior. Inseridos dois usuários intercalados na conversa direta compartilhada, resposta sem proprietário, conversa coletiva e alias sintético. O SQL de dry-run foi executado duas vezes antes da migração e uma vez depois. cmp retornou 0 nas duas comparações. Contagens constantes: memória user atribuível 2, user sem turno 1, assistant ambígua 1, Message inbound atribuível 2, outbound ambígua 1. A migração alterou estrutura, preservando as linhas.

No schema migrado, test-conversation-legacy.mjs repetiu classificações e comparou contagens. test-conversation-isolation.mjs executou o Orchestrator e o adaptador real do Ollama, modelo qwen3:1.7b. Três turnos A/B/A, oito resoluções concorrentes de identidade, doze criações concorrentes de conversa e quatro escopos passaram. Houve zero marcadores estrangeiros. O teste confirmou o turno atual, prompt da persona sem identificadores pessoais e a persistência de cada resposta. Entradas ambíguas e legadas permaneceram fora da recuperação.

## Rollback e implantação

A revisão b35b914 foi reconstruída em checkout separado, incluindo geração do cliente Prisma. A sonda confirmou zero leituras/escritas de memória direta nos três perfis e preservação da mensagem atual e persona. Ela executa SQL contra o schema novo, porém o teste de persistência demonstrou reutilização da conversa legada mixed. Por isso seu uso no schema migrado prejudica o isolamento de novas mensagens.

O artefato /tmp/zappy-memory-6f9226b-rollback.tar.gz contém os dist compilados e manifestos com lockfile. SHA256 registrado nas evidências. Reconstrução pela revisão 6f9226b com npm ci e npm run build. A configuração de recuo usa LLM_MEMORY_MESSAGES=0 no gateway dessa revisão. Sonda no schema migrado confirmou ausência de leitura/escrita da memória em member, creator_root e mother_privileged, com mensagem atual e persona. A versão segura no schema migrado é essa revisão corrigida com janela zero.

Antes da janela, validar backup novo do PostgreSQL com pg_dump em formato custom, checksum, pg_restore --list e restauração em PostgreSQL isolado com contagens e schema. O diretório backup/memory-containment.OxahqpvT contém apenas patches e JS anteriores, e não substitui backup do banco. Preservar também dump.pm2, env protegido, sessão Baileys e artefato do gateway. O snapshot de banco de produção ainda depende da preparação da janela.

Na janela autorizada, interromper coordenadamente os escritores (gateway, workers e endpoints administrativos com escrita), produzir o backup consistente e validá-lo, aplicar a migração transacional, instalar cliente e binários da mesma revisão em todos os consumidores e iniciar gateway com janela zero. Confirmar DB/Redis autenticados, cinco processos, sessão conectada e tráfego. Liberar memória por configuração só após canário consentido com dois usuários, aliases e grupo. Busca pública permanece desligada.

Se a versão corrigida exigir recuo funcional, usar o artefato corrigido com janela zero e reiniciar gateway. Para voltar ao gateway antigo com persistência antiga, restaurar coordenadamente banco e binário da contenção a partir do backup da janela, com reconciliação das mensagens posteriores ao snapshot. Não misturar escritores antigos com schema novo.

A contenção em produção está no fonte e nos dist. A sonda sobre o checkout ativo passou novamente, e o fonte coincide com fix/memory-containment. O dump PM2 aponta para o mesmo checkout. A alteração de banco em produção aguarda janela. O aceite técnico de bancada é aprovado. O aceite operacional depende da implantação e do canário no aparelho.
