# Busca com leitura de páginas públicas

## Operação no CT 110

A revisão ativa `4bfb71a` usa `z.coerce.boolean()` em `SEARCH_AI_ENABLED`. A string `false` se torna verdadeira. Foi aplicado `SEARCH_AI_ENABLED=` no `.env` 0600, com `SEARCH_PROVIDER=duckduckgo` e `LLM_PROVIDER=ollama` preservado. O ambiente de `wa-gateway` e o dump PM2 não continham overrides para essas chaves. Foi reiniciado só o gateway como botadmin. O status autenticado respondeu 200, com gateway conectado e worker online. Um teste do caso de uso compilado com o parser ativo devolveu “Busca assistida por IA está desativada neste ambiente.” sem invocar o adapter. Um daemon PM2 isolado restaurou uma sonda do dump e releu os mesmos valores antes e depois de `resurrect`. A sonda exclui estado Baileys e processos ativos de produção. O CT não foi reiniciado.

A mesma credencial configurada produziu 401 direto no Google e `http_401` pelo adaptador em modo `google_strict`. Resposta sanitizada: `UNAUTHENTICATED`, `CREDENTIALS_MISSING`, `required`; a API informou que não aceita API key para essa chamada e esperava OAuth2 ou outra credencial que identifique um principal. A configuração atual de chave e engine não permite uma correção local simples. DuckDuckGo produziu três hits no modo genérico. O comando `/google` conserva a semântica Google estrita.

## Branch isolada

Com `SEARCH_PAGES_ENABLED=true`, `/search` usa a descoberta DuckDuckGo no adapter existente, lê até três páginas públicas dentro do prazo de recuperação e reutiliza a seleção conservadora Ollama do módulo `pesquisar`. `SEARCH_PAGES_MODEL` seleciona o modelo para essa capacidade. O padrão usa o modelo local de conversa. O backend de descoberta recebe a consulta. O GET de página leva apenas a URL recuperada e cabeçalhos de leitura, sem histórico, cookies ou credenciais. As flags do fluxo de páginas vêm desligadas. O parser da branch aceita tanto o valor vazio legado quanto `false` para manter `/search-ai` pausado após uma futura migração.

O leitor faz apenas GET HTTP(S) nas portas padrão. Valida URL, DNS e cada redirecionamento, fixa o IP validado na conexão, e bloqueia loopback, redes privadas/reservadas e respostas DNS mistas. Lê apenas HTML/XHTML, com 512 KiB, até dois redirecionamentos e 1,8 s por página, dentro do orçamento total. Readability extrai texto sem executar scripts. Resultados bloqueados ficam fora da saída, e falhas de leitura conservam os demais links. URLs de páginas lidas apontam ao destino efetivo do trecho. Snippets da SERP não viram evidência para a variante de páginas.

O modelo escolhe apenas o ID de um trecho em português. O código considera idioma declarado na página e no caminho da documentação, e aplica classificação de idioma ao trecho. O código confirma citação literal, relevância, português e vínculo com o ID da fonte. O conteúdo enviado ao usuário é a evidência selecionada; URLs montadas pelo servidor vêm dos resultados. O complemento para Nextcloud cron local tem o mesmo limite de recuperação. Quando falta material suficiente, a resposta apresenta a limitação e os links encontrados.

A entrada natural usa o mesmo caso de uso sob `SEARCH_PAGES_NATURAL_ENABLED=true`, independente da opção anterior de `/pesquisar`. O comando mantém suas permissões e o caminho natural permanece restrito pelo guard de operadores. Ambos usam deduplicação da mensagem. `/google` conserva o modo estrito. A implantação começa com as flags desligadas. Valide `/search` antes de habilitar a opção natural. Para rollback da leitura pública, desligue as flags das páginas e relance o gateway; `/search` volta à lista de links do backend textual.

## Reprodução

```bash
npm ci
npm run build
OLLAMA_BASE_URL=http://10.200.48.120:11434 node scripts/search-public-pages-smoke.mjs
OLLAMA_BASE_URL=http://10.200.48.120:11434 node scripts/search-public-pages-smoke.mjs --known-urls
```

A primeira chamada mede descoberta, leitura e Ollama. A segunda usa URLs públicas conhecidas para distinguir falta de descoberta de limitação de extração ou síntese. A saída JSONL contém dados públicos. O teste de pipeline em unidade e integração cobre bloqueio de rede, cancelamento, vazio, citações fabricadas, comando, entrada natural e regressão de `/google`. Não há alteração do deploy do fluxo de páginas.

## Resultados reais em bancada

| Caso | DuckDuckGo + páginas + Ollama quando aplicável | URLs conhecidas + páginas + Ollama quando aplicável |
| --- | --- | --- |
| Proxmox | links com aviso, 2.616 ms | trecho em português, 2.086 ms |
| Nextcloud | links com aviso, 2.381 ms | links com aviso, 644 ms |
| Zabbix | trecho em português, 2.289 ms | trecho em português, 1.637 ms |

O teste com URLs controladas produziu trechos em português sobre `vzdump` e sobre `event.get` com a condição do housekeeper preservada. O cron local do Nextcloud conservou os links, inclusive quando o leitor alcançou o manual em inglês. Uma execução anterior revelou um falso positivo de idioma em página espanhola; a última revisão usa idioma declarado, idioma do caminho e teste específico de regressão. O pedido com método explícito só publica evidência que contenha o identificador técnico. O ensaio foi executado pelo mesmo caso de uso e adaptadores em isolamento, com Ollama real. O novo caminho não foi acionado pelo WhatsApp de produção.

Build, lint e 151 testes passaram. A sonda de compatibilidade confirmou também o valor vazio legado no parser novo.
