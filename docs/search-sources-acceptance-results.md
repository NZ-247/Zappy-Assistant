# Aceite da busca com fontes e do perfil compilado

Base da rodada `7da0782`. Mudanças de validação em `210591c` e `f16382e`. O deploy CT 110 permaneceu em dev, com os mesmos cinco PIDs, banco e Redis saudáveis, API 200 e WhatsApp conectado.

## Controle de idioma e evidência

Uma referência válida comprova a origem, mas a inferência de uma relação ainda pode extrapolar o trecho. No reteste, o modelo de 1,7 B citou corretamente o método `event.get` e acrescentou uma lista de métodos fora do trecho referenciado. A variante conservadora valida que a citação é literal, usa classificação local de idioma e publica só o trecho em português identificado como citação. A paráfrase do modelo fica fora da resposta. Dados de fonte não acionam ferramentas. A regra pode recusar fontes relevantes em outro idioma ou trechos curtos e retorna links com aviso. A versão é uma redução deliberada de cobertura.

| Dados congelados da rodada anterior | Referência em 7da0782, qwen3:1.7b | qwen3:1.7b com trecho validado | qwen3:4b em bancada |
| --- | --- | --- | --- |
| Proxmox | 2.370 ms de síntese; afirmações sustentadas, em inglês | 5.457 ms; citação em inglês bloqueada, links com aviso | Timeout de 15 s |
| Nextcloud | 1.456 ms; webcron não sustenta cron local | Retorno parcial; sem chamada ao modelo | Retorno parcial; sem chamada ao modelo |
| Zabbix | 1.439 ms; trecho sustentava e preservava o condicional | 6.459 ms; citação literal em português com `event.get` e a condição do housekeeper | Timeout de 15 s |

Foram três temas por configuração, com o mesmo JSONL de recuperação congelado. O 4b foi comparado na variante com citação validada anterior à publicação literal e com chamadas de bancada em andamento. Os dois timeouts impedem selecioná-lo nessa configuração; os dados são insuficientes para caracterizar desempenho frio, aquecido ou isolado. Tempos de replay excluem recuperação web. A aprovação de conteúdo usa leitura dos trechos, além da validação automática de idioma e de origem.

## Cron local do Nextcloud

O escopo diferencia cron do sistema de webcron. Quando a pergunta de configuração não especifica a versão, a consulta complementar restringe ao manual estável. Quando a versão é explícita, restringe ao caminho daquela versão. Só se admite para a síntese um trecho oficial com indício de crontab/cron local. A consulta complementar é única e compartilha o prazo de cinco segundos da recuperação. Um erro ou vazio no complemento conserva links úteis do primeiro resultado.

O manual estável serviu de controle independente. A seção de cron do sistema dá exemplo de `crontab`, execução de `cron.php` e requisitos dependentes da instalação. O snippet capturado de webcron cobria serviço externo. A leitura direta do manual indica que a fonte existe, mas não demonstra que o engine a recupera no turno. [Manual oficial do Nextcloud](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/background_jobs_configuration.html)

## Reprodução da bancada

Use a configuração privada do [parecer anterior](search-sources-release-review.md), com o mesmo digest SearXNG `sha256:a7fc607aa6723f5a8982105bcc5ffba4d1b9fc7c6922a31a88d6e4cba49ef12a`. Nesta rodada, um contêiner temporário publicou apenas loopback e teve segredo gerado fora do Git. Três consultas públicas foram alternadas, dois turnos por lote, 18 lotes. Nove lotes usaram duas buscas simultâneas e dispararam os adaptadores reais de conversa e semântica usando inputs sintéticos. Intervalo de oito segundos entre lotes e pausa de 45 s após o nono. Nenhuma mensagem foi enviada ao WhatsApp. Cada tentativa preserva duração, resultado, engines, contagem, HTTP e indisponibilidade reportada. O turno completo deste ensaio vai da recuperação até a montagem da resposta.

```bash
npm run build
export SEARCH_CAPTURE=/caminho/zappy-search-replayed-turns.jsonl
export OLLAMA_BASE_URL=http://10.200.48.120:11434
export SEARXNG_BASE_URL=http://127.0.0.1:32769
node scripts/search-sources-acceptance.mjs --captured > /tmp/captured.jsonl
node scripts/search-sources-acceptance.mjs > /tmp/live.jsonl
```

A primeira série de 36 turnos usou a estratégia intermediária. Foram 21 falhas, 11 retornos com links e quatro candidatos à síntese. O p95 global foi 7.787 ms, com 21 falhas rápidas. Todas as 18 tentativas antes da pausa retornaram CAPTCHA do DuckDuckGo. Depois voltaram resultados, com três novos CAPTCHAs. Houve um timeout Ollama. Cinco complementos Nextcloud retornaram vazios em 470–491 ms. Dois candidatos Proxmox usaram redação que confundia backup e restauração; isso motivou publicar somente citação selecionada em português.

### Série final da variante literal

| Carga | Turnos | Sustentada | Links com aviso | Falha | p50/p95 do turno |
| --- | ---: | ---: | ---: | ---: | ---: |
| Total | 36 | 0 | 16 (44,4%) | 20 (55,6%) | 166/3.875 ms |
| Sequencial | 18 | 0 | 8 | 10 | 96/3.828 ms |
| Concorrente com conversa e sombra | 18 | 0 | 8 | 10 | 166/5.851 ms |
| Depois da pausa | 18 | 0 | 16 | 2 | 2.579/5.851 ms |

As 41 chamadas de recuperação retornaram HTTP 200. Vinte vieram vazias com CAPTCHA do DuckDuckGo e cinco complementos vieram vazios sem erro reportado. O primeiro lote depois da pausa ainda teve CAPTCHA; a recuperação voltou a produzir resultados a partir do turno 21. Não houve timeout de transporte ou de síntese na série final. Os nove pares de carga de conversa e sombra concluíram. Onze propostas de síntese foram recusadas pelo controle de evidência/idioma, e cinco Nextcloud retornaram por insuficiência comprovada. O p95 inclui falhas rápidas; o p95 de respostas úteis ficou indefinido porque não houve nenhuma. O teste congelado de Zabbix demonstrou uma citação útil à parte.

Nos cinco turnos Nextcloud com complemento, a consulta ao manual estável levou 478–509 ms e não retornou trecho. Uma sonda adicional com o caminho da versão 35 devolveu zero resultados e CAPTCHA. A primeira série teve o mesmo padrão de vazio legítimo no complemento. A decisão de devolver links com a limitação explícita está validada; a disponibilidade de evidência para o cron local continua sem aceite.

## Decisão por etapa

| Etapa | Decisão |
| --- | --- |
| Controle de idioma, citação e qualificadores | **Aceito para revisão técnica.** O código entrega uma citação portuguesa literal quando encontra suporte; propostas que extrapolam ficam fora da resposta. O replay de Zabbix preservou a condição. |
| Cobertura útil da síntese | **Reprovada.** Zero respostas sustentadas no vivo final; Proxmox voltou a propor inglês no replay e Nextcloud continuou parcial. |
| SearXNG privado nessa configuração | **Reprovado para o canário.** A/B anterior mostrou recuperação melhor quando o engine respondia. As séries sustentadas mostraram dependência de um único engine e CAPTCHA mesmo após recuperação. É necessária nova série com engines aprovados e disponibilidade útil. |
| Artefato compilado isolado | **Aceito para a janela operacional**, com a busca desligada. |
| Migração e reboot reais do CT 110 | **Pendentes.** Falta janela confirmada, sessão do WhatsApp preservada e recibo do lembrete pelo operador. |
| Canário WhatsApp | **Suspenso até os aceites.** Após aprovação, primeiro comando e depois a mesma consulta sob flag natural. |

## PM2 compilado independente

Artefato operacional `210591c0d86a7d619a487635570948af4e3df1aa`, SHA-256 `87d9ef9010d3126d9552058de186a20fb6e19761a6629d286320f925a527eedc`. É o pacote de validação do perfil com busca desativada. A variante de busca conservadora foi validada separadamente na branch. O dump dev anterior do CT foi copiado para armazenamento restrito, arquivo 0600 e diretório 0700.

O artefato descompactado subiu em rede Docker interna com Postgres e Redis autenticados, PM2 separado e Baileys sem sessão nem egress. Após reiniciar o contêiner de teste, o gancho completou a restauração em 51 s com cinco processos prod online, zero reinícios, flags de busca desligadas, API/UI/resolver HTTP 200 e heartbeat do worker. O cache de governança de `b29f718` permanece fora. Esse teste aceita o artefato para uma janela operacional; faltam cron de botadmin no reboot real, sessão preservada e lembrete recebido no aparelho. [Cutover e rollback](search-sources-compiled-cutover.md)

Build, lint e 138 testes passaram na branch. Incluem idioma, citação literal, extrapolação, webcron, preservação da condição do housekeeper, escopo, replay, limites e os comandos existentes.
