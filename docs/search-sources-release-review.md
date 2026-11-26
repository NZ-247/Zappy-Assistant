# Parecer de liberação da busca com fontes

Auditado no CT 110, em 23/11/2026 no horário local. Diff original `4bfb71a..ffaaba5`. Candidato para recuperação **SearXNG privado**. Estado da liberação **aguardar aceite de síntese e disponibilidade, boot real e WhatsApp**.

## Revisão de código

| Área | Parecer |
| --- | --- |
| Autorização | O fluxo local continua restrito a ROOT/admin no chat direto, depois de política e consentimento. A revisão cobriu ROOT sem entrada na lista administrativa, admin cadastrado, identidade ADMIN, membro, grupo e consentimento pendente. |
| Replay | O gateway e o router mantêm seus filtros. No core, a deduplicação de texto e o ID de comando podiam deixar o mesmo evento chegar por entradas distintas quando recebido com conteúdo diferente. As duas entradas agora compartilham claim de 120 s por tenant, usuário e ID de mensagem. Falha do claim encerra a rota antes de rede ou inferência. |
| Concorrência e tempo | Um turno por conversa, dois no processo. Recuperação até 5 s, síntese até 15 s ou timeout menor do adaptador e deadline total de 22 s. Testes cobriram cancelamento, terceiro turno recusado, liberação e retorno parcial. A latência medida de ponta a ponta nesta rodada começa no caso de uso e termina na resposta montada. |
| Referências | IDs inexistentes, URLs inventadas, protocolos inválidos, credenciais em URL e duplicatas são rejeitados ou normalizados. Um ID válido garante proveniência. A leitura humana dos trechos detectou afirmações que perderam ressalvas ou excederam o texto, mesmo com IDs válidos. |
| Correções de síntese e falha | Instrução mais estrita de tradução, uso literal de evidência e preservação das condições; teto de duas afirmações no schema e no parser. `cron.php` é aceito, assim como `event.get`, quando aparece na evidência citada. HTTP 200 sem resultados e com engines indisponíveis agora é falha de backend; vazio legítimo mantém a resposta de evidência insuficiente. |
| Regressão | `/search` mantém modo genérico e `/google` Google estrito. Testes de integração confirmaram as duas rotas textuais e o provedor legado com o canário desabilitado. O 401 do Google também ocorre com o adaptador atual. |

## A/B de recuperação real

Contêiner dedicado, Docker, bind aleatório somente em `127.0.0.1`, limites de 1 CPU, 384 MiB e 100 PIDs. SearXNG `2026.11.23-a7163d091`, imagem `searxng/searxng@sha256:a7fc607aa6723f5a8982105bcc5ffba4d1b9fc7c6922a31a88d6e4cba49ef12a`. A configuração seguiu o runbook. Segredo gerado fora do Git em diretório restrito. Os três engines estavam na lista da configuração e todos os resultados top 3 da amostra identificaram DuckDuckGo. Os dois braços rodaram do mesmo CT e com a mesma origem pública de rede. A configuração de idioma do adaptador legado ficou preservada, enquanto o SearXNG recebeu `pt-BR`.

Foram dez rodadas por tema e backend, ordenadas em pares alternados, top 3, deadline de 5 s e intervalo de 1 s entre chamadas. Houve também sondagens pontuais do caso de uso completo durante a janela. Percentis por posto mais próximo. “Oficial” conta consultas com ao menos um domínio oficial no top 3. “Trecho” conta consultas com ao menos um snippet de 25 caracteres. A utilidade semântica foi avaliada separadamente nos turnos completos.

| Backend | Tema | n | p50/p95 recuperação | Oficial | Trecho | Falha/timeout |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Atual | Proxmox | 10 | 890/1.034 ms | 1 | 0 | 0/0 |
| Atual | Nextcloud | 10 | 695/831 ms | 0 | 0 | 0/0 |
| Atual | Zabbix | 10 | 708/870 ms | 10 | 0 | 0/0 |
| SearXNG | Proxmox | 10 | 617/767 ms | 10 | 10 | 0/0 |
| SearXNG | Nextcloud | 10 | 618/697 ms | 10 | 10 | 0/0 |
| SearXNG | Zabbix | 10 | 617/696 ms | 10 | 10 | 0/0 |
| **Atual** | Total | **30** | **726/1.029 ms** | **11** | **0** | **0/0** |
| **SearXNG** | Total | **30** | **618/727 ms** | **30** | **30** | **0/0** |

Google estrito, uma tentativa por tema, retornou **HTTP 401 nas três**, em 95/98/90 ms respectivamente. O adaptador genérico caiu para DuckDuckGo em 30/30. Fora das 30 amostras, o SearXNG registrou CAPTCHA do DuckDuckGo e retornou vazio em dois turnos adicionais. Uma consulta posterior retornou dez itens após a pausa. O resultado do A/B mostra qualidade de recuperação em situação normal e não estabelece disponibilidade sustentada.

## Turnos completos com dados reais

Consultas usadas, idênticas nos braços:

- **Proxmox** — “Proxmox VE documentação oficial backup vzdump e restauração”.
- **Nextcloud** — “Nextcloud documentação oficial configuração cron tarefas em segundo plano”.
- **Zabbix** — “Zabbix documentação oficial API problem.get event.get histórico de problemas”.

A tabela registra a série ao vivo após corrigir tradução do prompt, identificadores e falhas do backend. Ela precedeu o ajuste final de teto de duas afirmações. O reteste final usa os resultados reais capturados e está descrito abaixo.

| Tema | Atual, recuperação/turno | SearXNG, recuperação/síntese/turno | Validação humana da resposta SearXNG |
| --- | --- | --- | --- |
| Proxmox | 1.063/1.071 ms | 795/2.322/3.119 ms | Os trechos oficiais sustentavam backup completo, GUI ou `vzdump` e requisito de armazenamento. A resposta veio em inglês. A referência F4 sustentava a menção às operações de backup/restauração. Em outra tentativa em português, uma referência que apenas mencionava agendamento foi usada para afirmar recomendação. |
| Nextcloud | 693/693 ms | 552/664/1.216 ms | O trecho oficial F1 sustentava que registrar `cron.php` em serviço webcron como easyCron permite a execução periódica. A resposta informou essa possibilidade. O trecho citado não bastava para um roteiro completo de cron local. |
| Zabbix | 713/713 ms | 596/1.377/1.972 ms | F2 sustentava usar `event.get` para problemas resolvidos no passado. A afirmação sobre entidade excluída perdeu a condição de que o housekeeper ainda não removeu o evento. Em replay de evidência, o modelo preservou essa condição e citou os trechos corretos. |

Links de referência efetivamente recuperados nos turnos SearXNG: [Proxmox F1, Backup and Restore](https://pve.proxmox.com/pve-docs/chapter-vzdump.html), [Proxmox F4, comandos de backup](https://proxmenux.com/en/docs/help-info/backup-commands/), [Nextcloud F1, Background Jobs](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/background_jobs_configuration.html), [Zabbix F2, problem.get 6.4](https://www.zabbix.com/documentation/6.4/pt/manual/api/reference/problem/get). Também houve [event.get](https://www.zabbix.com/documentation/current/en/manual/api/reference/event/get) entre os links recuperados de Zabbix. A matriz JSONL contém os demais links, trechos exatos oferecidos ao modelo, IDs e respostas. Os três turnos do backend atual apresentaram apenas os links recuperados e indicação de evidência insuficiente. Nenhum chamou o Ollama, comportamento esperado na ausência de snippets. Nos turnos que sintetizaram, o transporte de teste só permitiu o endpoint local Ollama. A amostra de três turnos por braço não estima p95 de ponta a ponta.

### Reteste do patch com a recuperação real capturada

O reteste congelou os resultados já obtidos e repetiu a inferência no Ollama real. Os tempos abaixo são de **síntese**, pois a recuperação foi reproduzida localmente. Proxmox, 2.370 ms, voltou a responder em inglês mesmo com dois enunciados sustentados. Nextcloud, 1.456 ms, identificou corretamente que o manual aborda cron, mas o trecho de webcron segue insuficiente para instruções completas de cron local. Zabbix, 1.439 ms, manteve o condicional do housekeeper em português e indicou o trecho que o sustenta. O braço atual manteve o retorno de links nas três consultas. O controle sintático de referências passou nos três temas SearXNG. O critério de idioma e completude ainda impede liberação.

Build, lint e 162 testes passaram no patch final. A suíte abrangeu core, adaptadores afetados, gateway, worker e scripts de boot. Os artefatos JSONL da bancada contêm apenas dados públicos recuperados. Os contêineres de teste e o segredo temporário foram removidos ao final.

## Perfil compilado e linha de performance

`b29f718` parte de `bc8518f` e foi inspecionado separadamente. O compilado funciona sem cherry-pick dessa revisão. `min_uptime` controla classificação de reinícios rápidos; avaliar em patch próprio juntamente com os listeners de erro e stall do worker. Esses listeners são úteis para aceite operacional. O cache de snapshot de governança guarda decisões de dados potencialmente revogáveis por 30 s e não tem invalidação nessa revisão. `consumeQuota` passa direto pelo port original, mas regras e aprovação podem ficar defasadas. Deixar o cache fora do release até testes de revogação, invalidação, escopo e falha Redis. `CLAUDE.md` não altera o runtime.

O ecosystem compilado foi executado com cinco apps PM2 em rede Docker interna, PostgreSQL e Redis autenticados dedicados, dump 0600 e flags de busca nova desligadas. Baileys usou sessão vazia sem acesso externo. A imagem slim precisou de bibliotecas OpenSSL 3 para o Prisma. Cinco apps online, API, UI e resolver HTTP 200, banco e Redis OK e heartbeat de worker/gateway verificado. Uma tentativa de restauração a quente com limite de 180 PIDs falhou por EAGAIN/abort em processos de bancada. Com limite de 512 e namespace reiniciado, o gancho restaurou os cinco em aproximadamente 51 s, zero reinícios, com as flags desligadas e verificações de saúde repetidas. Os lançadores `npm` fazem o PM2 aguardar os timeouts de readiness; confirmar saúde real por endpoint e heartbeat além do status PM2. A execução do gancho foi manual no contêiner. Cron, usuário botadmin, reboot real do CT e reconexão WhatsApp precisam de aceite em janela operacional.

## Decisão e gates

1. **Bancada** — conservar SearXNG como candidato. Validar operação sustentada com engines/quotas aprovados, casos de CAPTCHA, janela mais longa e repetição integral. Para a síntese, exigir português e afirmações integralmente sustentadas, incluindo qualificadores, em revisão humana por tema. Medir p95 de turno em ao menos 30 execuções. Se o modelo continuar falhando, escolher modelo ou modo de síntese mais conservador antes do canário.
2. **Operação** — construir artefato identificado pelo SHA e arquivar configuração e dump anteriores com acesso restrito. Em janela, trocar apenas a instância existente para o perfil compilado, com busca desabilitada. Garantir caminho de sessão e checkout compatíveis com o gancho. Conferir cinco processos, API/UI/resolver, heartbeats, fila e WhatsApp. Após reboot real, registrar prontidão autenticada, cron do botadmin, restauração, sessão e lembrete com recibo.
3. **Canário** — após os dois aceites, conectar backend privado que passou na bancada, selecionar `ollama_sources` e manter `SEARCH_SOURCES_NATURAL_ENABLED=false`. Executar `/search-ai` com a conta de teste, revisar fontes e logs. Só então habilitar a flag natural e enviar a mesma consulta no WhatsApp, validando o caminho completo.
4. **Rollback** — para a busca, desligar `SEARCH_AI_ENABLED` e a flag natural e relançar o gateway. Para o perfil, retirar processos compilados, restaurar o artefato e o dump anteriores no mesmo caminho e com a sessão preservada, e verificar endpoints, fila e WhatsApp. Guardar cópia do dump conhecido antes de salvar o novo. [Runbook](search-sources-rollout.md)
