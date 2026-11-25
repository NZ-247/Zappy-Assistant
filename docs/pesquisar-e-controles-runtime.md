# Pesquisa local e controles em execução

Esta revisão separa a próxima implementação da busca com fontes do canário anterior. `/search-ai` e `/sai` usam o provedor externo selecionado, Gemini ou OpenAI. A configuração de inicialização é `SEARCH_AI_PROVIDER`. O provedor da conversa usa `LLM_PROVIDER` de forma independente. O gateway carrega `.env` no início e o ambiente recebido do PM2 tem precedência. Um restart comum relê o arquivo quando o daemon e o dump não têm a variável. Confira precedência antes de atualizar um snapshot.

## Gemini

Quando selecionado, o comando requer operador autorizado em chat direto. O payload contém instrução fixa e a consulta digitada no comando. Uma mensagem respondida não fornece consulta para Gemini. A resposta exige URLs HTTPS vindas dos metadados de grounding da mesma candidata de texto. A síntese remove URLs propostas no corpo. Caso falte grounding ou ocorra 429, o gateway produz um aviso em português. O erro upstream bruto fica fora do chat. O fluxo termina no Gemini. Logs incluem ID de execução, provedor, modelo, latência e total de fontes.

No CT 110, o código executado em perfil dev contém a composição Gemini e o dist do adaptador exporta `createGeminiSearchAiAdapter`. A instância PM2 iniciou antes da edição que escolheu Gemini. O teste no WhatsApp após a edição ainda produziu 429 do OpenAI. O ambiente PM2 e o dump têm as chaves de provedor ausentes. O `.env` contém Gemini, grounding ligado e conversa Ollama. A permissão foi ajustada para 0600.

| Consulta pública de cron.php | HTTP | Latência | Metadados/fontes |
| --- | ---: | ---: | --- |
| `gemini-2.5-flash`, pelo adaptador existente | 404 | 426 ms | 0 |
| `gemini-2.5-flash-lite`, API real | 404 | 879 ms | 0 |
| `gemini-3.1-flash-lite`, API real | 429 | 305 ms | 0 |

A listagem respondeu 200 para a chave. O projeto foi tratado como sem faturamento conforme informado pelo operador. Nenhuma ativação de faturamento foi realizada. Grounding real e validação positiva no WhatsApp dependem de modelo/conta com disponibilidade. A condição de ativação não foi atingida nesta rodada. [Tabela de preços e disponibilidade do grounding](https://ai.google.dev/gemini-api/docs/pricing)

Quando o teste público retornar grounding, valide as fontes, mantenha `LLM_PROVIDER=ollama`, confira o ambiente do processo/dump e aplique a revisão em janela que permita relançar apenas `wa-gateway` como botadmin. Preserve o diretório Baileys. Em chat autorizado, envie `/search-ai Segundo a documentação oficial do Nextcloud, qual é a função de cron.php?`. Correlacione a entrada com a única resposta e o log de inferência. Para rollback na versão nova, restaure o provedor anterior ou defina `SEARCH_AI_ENABLED=false` e relance o gateway. Na revisão de produção anterior, `z.coerce.boolean()` interpreta a string `false` como verdadeira; para desativar ali use `SEARCH_AI_ENABLED=` com o valor vazio e um restart após conferir o ambiente PM2.

## Pesquisar

`/pesquisar <consulta>` usa um backend textual e um modelo local Ollama, por uma rota independente. O comando e a opção natural compartilham a recuperação e a validação de trechos. O padrão é desligado. `PESQUISAR_ENABLED=true` provisiona o fluxo. `PESQUISAR_MODELO` permite um identificador de modelo dedicado, e a ausência desse valor usa `OLLAMA_CHAT_MODEL`. `SEARCH_SOURCES_BACKEND` seleciona o backend, e a entrada natural depende de `SEARCH_SOURCES_NATURAL_ENABLED`. O SearXNG próprio ainda está sem aceite operacional. A integração aceita um modelo especializado quando houver um artefato avaliado. Nenhum modelo novo foi treinado ou promovido nesta revisão. A opção histórica `ollama_sources` no provedor de `/search-ai` foi substituída pelo módulo separado.

## Comandos ROOT

As alterações são flags tipadas por tenant no banco, lidas a cada evento e auditadas no mesmo commit transacional. Segredos, endpoints, nomes de variáveis e valores arbitrários permanecem na configuração operacional. O parser aceita apenas as opções abaixo e o uso é restrito ao chat direto ROOT. `padrao` restaura a configuração normal. As flags existentes de grupo/usuário seguem a precedência do resolvedor.

- `/configurar ia on|off|padrao` controla conversa assistida. Comandos determinísticos e as duas rotas de busca têm seus próprios controles.
- `/configurar search-ai on|off|padrao` e `/configurar pesquisar on|off|padrao` operam em recursos provisionados pelo ambiente.
- `/configurar provedor-busca gemini|openai|padrao` seleciona o provedor externo da busca. Credenciais vêm da inicialização.
- `/configurar provedor-ia ollama|openai|padrao` opera quando `LLM_RUNTIME_PROVIDER_ENABLED=true` foi habilitado na inicialização. O padrão mantém a seleção do `.env`. Uma troca para serviço externo tem efeito na conversa e segue o contrato de memória desse serviço. Essa opção permanece desabilitada no perfil padrão.
