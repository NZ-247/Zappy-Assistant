# Busca com fontes e síntese local

## Base e escopo

Branch `feature/ollama-search-sources`, base `4bfb71a4cd577779e5ddcf11d8ceac84ac632664`, igual ao GitHub `main` no início da implementação. A revisão de performance `b29f718` diverge a partir de `bc8518f`, uma revisão exclusiva de cada lado. Ela inclui cache de governança, registros de erro e stall do worker e `min_uptime` no ecosystem compilado. Revisar esses pontos no release, sem mesclar a linha de performance neste diff funcional. O checkout do PM2 tem alterações nos resolvers e um relatório local. O build e os testes desta branch usam dependências instaladas em worktree separado.

O canário atende chat direto com permissão de root ou admin, sujeito à política e ao consentimento do pipeline. Respostas usam até quatro trechos recuperados, identificadores validados e links construídos pelo Zappy. O Ollama recebe schema JSON e somente os trechos, sem ferramentas. O caminho de busca local usa uma instância própria do adaptador Ollama. Falhas nesse caminho geram resposta controlada. A recuperação tem teto de 5 s, a síntese de 15 s ou o timeout menor configurado no Ollama e o turno de 22 s. Até duas buscas simultâneas no processo e uma por conversa. O conteúdo recuperado consiste em snippets.

## Bancada A/B

Use uma instância privada já aprovada ou provisione em bancada separada após revisão. Prenda a imagem a um digest, mantenha o bind em loopback para testes co-localizados ou restrinja o acesso à origem de bancada. Gere segredo exclusivo fora do Git. Exemplo de `settings.yml`:

```yaml
use_default_settings:
  engines:
    keep_only:
      - google
      - duckduckgo
      - bing
server:
  secret_key: "SUBSTITUIR_POR_SEGREDO_DA_BANCADA"
  bind_address: "0.0.0.0"
search:
  formats:
    - html
    - json
outgoing:
  request_timeout: 3.0
```

Configure os engines ativos com sua política de egress. A documentação oficial descreve instalação, configuração do container e a API. [Instalação](https://docs.searxng.org/admin/installation-docker.html) · [Configuração](https://docs.searxng.org/admin/settings/settings.html) · [API de busca](https://docs.searxng.org/dev/search_api.html)

No checkout isolado, compile e execute o comparador. Em `bench.env`, coloque somente `SEARXNG_BASE_URL`, `SEARCH_PROVIDER` e, se aprovadas, as credenciais e engine ID do Google para a bancada. Proteja o arquivo e mantenha-o fora do Git.

```bash
npm ci
npm run build
node --env-file=/caminho/bench.env scripts/search-sources-benchmark.mjs 10 1000 > /tmp/zappy-search-ab.jsonl
```

O comparador faz 30 medições pareadas por backend, com ordem alternada, top 3, deadline de 5 s e uma medição adicional de Google estrito por tema. O modo existente mantém as opções de idioma próprias do adaptador. A primeira rodada fica identificada com `round: 1`. A saída registra URLs públicas sem query string, presença de domínios oficiais, tamanho de trechos, latência, fallback e engines SearXNG quando informados. Pontue manualmente cada resultado relevante de 0 a 2 e revise o suporte de cada citação. Repita com um engine indisponível e endpoint SearXNG indisponível em bancada, além de fixtures para timeout, vazio e duplicatas. Ajuste o intervalo conforme a cota dos engines.

A auditoria anterior mediu o backend textual em Proxmox, Nextcloud e Zabbix, respectivamente 1.036 ms, 813 ms e 797 ms. As três consultas retornaram DDG por `google_error`, zero snippets e fontes oficiais apenas no tema Zabbix. O Google estrito devolveu HTTP 401. Nenhum SearXNG privado foi identificado na configuração disponível nesta implementação, então a série pareada real está pendente. O backend de produção depende dos resultados, incluindo evidência suficiente, fontes oficiais no top 3 em pelo menos dois temas e revisão da sustentação das citações.

## Evidência de implementação

Em bancada isolada, o comparador com transportes de fixture produziu nove amostras e dois resumos, incluindo Google 401 e um engine SearXNG indisponível. Isso valida a coleta, sem medir a qualidade de uma instância SearXNG.

Com fixtures públicas de recuperação, o Ollama real do CT 120 retornou HTTP 200 e referências válidas para Proxmox e Zabbix. As duas sínteses levaram aproximadamente 902 ms e 652 ms. O ensaio permitiu apenas `/api/chat` do Ollama no transporte de inferência. Os testes de integração exercitam as duas entradas, replay, permissões e os modos antigos de busca.

## Ativação e rollback

1. Após revisão, registre configuração anterior expurgada e identifique o SHA do artefato. Faça build isolado, teste os cinco entry points de `ecosystem.prod.config.cjs` e prepare o dump PM2 com caminho de checkout consistente com o gancho. Preserve sessão Baileys e dados. Planeje a troca sem duplicar gateway ou worker.
2. Em janela autorizada, valide o perfil compilado com APIs, painel, resolver, heartbeats, fila, `/ping` e lembrete. Salve o snapshot dos cinco processos. Faça boot real, confirme PostgreSQL e Redis autenticados antes do PM2, execução do gancho, reconexão e lembrete com criação, worker, envio e recibo. [Runbook PM2](pm2-runtime-guide.md)
3. Com backend escolhido pela bancada, configure `SEARCH_AI_PROVIDER=ollama_sources`, `SEARCH_AI_ENABLED=true`, `SEARCH_SOURCES_BACKEND=existing|searxng`, `SEARXNG_BASE_URL` quando aplicável, e o endpoint e modelo Ollama. Relance o gateway. Confira a precedência de ambiente do PM2 sobre `.env` e os valores no dump. Teste primeiro `/search-ai`.
4. Ative `SEARCH_SOURCES_NATURAL_ENABLED=true` e teste a mesma consulta em linguagem natural no WhatsApp, em chat direto autorizado. Exija uma resposta por entrada, URLs recuperadas, citações sustentadas e logs com `executionId`, backend, modelo e latências. Confirme isolamento da OpenAI na rota, usuário sem permissão, replay, e regressão dos comandos textuais. Faça falhas de backend e Ollama em bancada isolada. Para ampliar, valide o limite proposto de p95 de 22 s em 30 execuções, incluindo concorrência com conversa e sombra.
5. Para interromper o canário, defina `SEARCH_SOURCES_NATURAL_ENABLED=false` e `SEARCH_AI_ENABLED=false` e relance o gateway. Para restaurar explicitamente a busca legada, recupere `SEARCH_AI_PROVIDER` e `SEARCH_AI_ENABLED` anteriores. O legado pode usar API externa. Em rollback do perfil, restaure o artefato e o dump conhecidos e revalide a sessão e o serviço.
