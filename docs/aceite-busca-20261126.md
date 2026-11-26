# Bancada de busca em 26/11/2026

Código testado 3a1732b895cbfcf227ebadbfcdf86a91d6dccb38, sem diff de código adicional. Build e lint novos concluíram com saída zero. O comando node --test --import tsx packages/{core,adapters}/test/*.test.ts apps/wa-gateway/test/*.test.ts passou 183 testes. Logs em /tmp/search-new-{build,lint,tests}.log.

Executado scripts/search-public-pages-smoke.mjs três vezes com descoberta DuckDuckGo, e três com --known-urls, OLLAMA_BASE_URL apontando ao CT 120. Cada execução contém os mesmos três temas, totalizando nove tentativas por modalidade. Processo e bancada finalizaram com saída zero. JSONL completos em evidence/aceite-20261126.

| Tema | DDG, sustentadas | Latências DDG ms | URLs conhecidas, sustentadas | Latências controle ms |
| --- | --- | --- | --- | --- |
| Proxmox | 3/3 | 3229, 2933, 3063 | 3/3 | 2549, 2010, 1996 |
| Nextcloud | 3/3 | 2783, 2748, 2717 | 3/3 | 624, 393, 570 |
| Zabbix | 3/3 | 2406, 2807, 2288 | 3/3 | 1906, 2088, 1730 |

Todas as 18 tentativas terminaram com resposta sustentada. Houve zero respostas finais só com links e zero falhas finais. Há falhas parciais registradas por página. Em Proxmox, quatro timeouts de leitura na modalidade DDG e três no controle. A página qmrestore forneceu nome e sintaxe, com referência oficial. Não houve falha final de descoberta, extração ou seleção. Em Nextcloud, a busca complementar oficial resolveu a localização da seção de cron do sistema, e a extração exigiu intervalo, usuário do servidor e ajuste do caminho. Não houve falha de leitura nos casos medidos. Em Zabbix, houve três páginas auxiliares indisponíveis com DDG, enquanto as páginas oficiais forneceram evidência. DDG recuperou o manual 8.2 e o controle usa 6.4. A resposta identifica a versão, atribui o histórico a event.get e a ressalva a problem.get. Essas versões são versões das fontes, sem inferência sobre a versão instalada no homelab.

Os renderizadores de manuais validam passagens reconhecidas, e o Ollama seleciona o identificador da fonte. O código monta português e links a partir da evidência validada. O aceite se aplica aos casos delimitados de cron, restauração QEMU e histórico Zabbix. A amostra de três repetições por tema não mede estabilidade prolongada ou cobertura geral da web.

Parecer de bancada aprovado para revisão e preparação de canário explícito /search. A implantação depende do aceite da memória, janela e teste no WhatsApp. A entrada natural depende do aceite prévio do comando. No CT 110, a revisão ativa ainda não contém o módulo de páginas, as flags novas estão ausentes, SEARCH_AI_ENABLED é false pelo parser e Ollama/qwen3:1.7b permanece ativo.
