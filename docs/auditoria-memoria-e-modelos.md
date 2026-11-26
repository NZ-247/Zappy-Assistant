# Auditoria de memória, persona e modelos

Data local 25/11/2026. Comparação do deploy `4bfb71a` com a branch de pesquisa. A inspeção de dados usou contagens agregadas no PostgreSQL. Nenhum texto, identificador de usuário ou histórico privado foi consultado.

## O que existe

| Componente | Implementação e evidência |
| --- | --- |
| Conversa | `AiService.generate` recebe contexto do mapper, resolve persona e relacionamento, carrega memória, monta prompt, chama `LlmPort.chat` e guarda o turno bem-sucedido. O core conserva a decisão operacional sobre sugestões de ferramentas. [Serviço](../packages/ai/src/ai-service.ts) · [Portas](../packages/core/src/pipeline/ports.ts) |
| Persona | Catálogo local com padrão `secretary_default`, modificadores de relacionamento e configuração de prompt. O build atual do CT usa o padrão, janela base 10. Perfis privilegiados podem usar 24 ou 18 entradas. [Persona](../packages/ai/src/persona.ts) · [Prompt](../packages/ai/src/prompt-builder.ts) |
| Persistência | `Message` guarda eventos/mensagens brutos e `ConversationMemory` guarda entradas selecionadas usadas pelo assistente. A memória é podada por contagem na escrita; não foi encontrada expiração por idade no fluxo. A amostra do CT tem 24 entradas em uma conversa, de abril a novembro de 2026. A poda de memória fica separada da tabela de mensagens. `clearMemory` existe como método interno. [Schema](../prisma/schema.prisma) · [Adapter](../packages/adapters/src/index.ts) |
| Scope de chat | A persistência inbound/outbound busca a primeira `Conversation` por tenant e grupo ou grupo nulo. O campo `subject` guarda o usuário na criação, porém não é filtrado depois. A leitura de memória filtra só `conversationId`; o alias `loadRecent` aceita tenant e descarta-o. O filtro raw também pode omitir o grupo quando recebe `undefined`. |
| Achado no deploy | A única conversa direta encontrada na amostra tem mensagens de mais de um remetente. A única conversa direta com memória também tem entradas `user` de mais de um remetente. Os tenants de conversa e linha de memória coincidiram na amostra. Há risco confirmado de contexto direto compartilhado dentro do tenant. A auditoria não verificou conteúdo exibido em respostas. |
| Modelos no CT 120 | `qwen3:1.7b` e `qwen3:4b`, ambos Q4_K_M, com tamanhos em disco de aproximadamente 1,36 GB e 2,50 GB. `/api/ps` estava vazio no instante da leitura. Tamanho de arquivo e residência de memória são métricas diferentes. O deploy segue em Ollama 1.7b para conversa. |

A configuração de janela base igual a zero ainda pode ser sobrescrita pelos modificadores privilegiados. O isolamento deve ser corrigido na resolução da conversa e no repositório; a configuração de janela por si só não demonstra segregação.

## Memória editável

A primeira entrega precisa corrigir o isolamento: chave única de conversa por tenant, canal, tipo de chat e identidade canônica do usuário direto ou grupo. Escopo obrigatório na interface de leitura e de escrita, validação da propriedade da conversa no adapter e recorte explícito de chat direto. Para dados antigos, separar apenas linhas com vínculo comprovado pelo remetente e conversa. Manter entradas ambíguas fora da leitura até revisão, inclusive pares de resposta sem proprietário inequívoco. Validar dois usuários do mesmo tenant, grupos, aliases, tenants diferentes e concorrência na criação.

Depois dessa correção, distinguir histórico efêmero de fatos/preferências editáveis. Criar porta de memória com listar, editar, esquecer, limpar e política de retenção por escopo. Registro com ID, autoria, escopo, timestamps, origem, TTL e revisão otimista. Auditar ações sem texto salvo. Exigir ACL e confirmação para exclusões amplas. Preservar semântica de consentimento e impedir que exclusões reapareçam via índice de embeddings, cache ou recuperação da tabela de mensagens. Descrever retenção, backups e purga na API antes de expor UI ou WhatsApp. Nenhuma entrada foi alterada nesta auditoria.

## Seleção por capacidade e avaliação

| Capacidade | Seleção disponível ou planejada | Corpus e critérios |
| --- | --- | --- |
| Conversa | `LLM_PROVIDER` e `OLLAMA_CHAT_MODEL` no deploy. A branch anterior implementou controles ROOT de troca em execução sob flag própria. | 40 turnos PT-BR em pelo menos 10 diálogos sintéticos. Medir contexto correto, isolamento com usuários intercalados, formato, fallback e adaptação de persona. |
| Síntese de busca | Nesta branch, `SEARCH_PAGES_MODEL` permite um modelo independente para página pública. `PESQUISAR_MODELO` permanece próprio do fluxo anterior. Comparar Qwen3 1.7B e 4B com quantização fixada e páginas congeladas. | 30 consultas por candidato e por regime, incluindo as três auditadas, negativas e instruções em fontes. Medir cobertura, português, URL e trecho literal, sustentação/qualificadores e fallback. Aceitar zero citações fabricadas na amostra e p95 dentro do orçamento de 22 s, com fracassos reportados separadamente. |
| Código | Reusar `LlmPort` com composição por capacidade e um serviço explícito, mantendo execução de código fora da conversa. Candidato de comparação Qwen2.5-Coder 1.5B Instruct, sem instalação nesta rodada. | 30 exercícios em TypeScript e SQL de leitura com fixtures sintéticas. Medir testes aprovados, precisão de explicação e preservação de parâmetros. Avaliar código com isolamento e sem credenciais. [Modelo Coder](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct) |
| Embeddings | Porta nova `EmbeddingPort` e adaptador `/api/embed`, com dimensão, versão, lote e identificação de índice separado. Candidatos Qwen3-Embedding 0.6B e o exemplo EmbeddingGemma. | 50 consultas PT-BR com pares relevantes e negativos próximos. Medir Recall@5, MRR, p95 por lote, vetores válidos, isolamento e comportamento após revogação. Comparar com baseline lexical sem indexar histórico de produção. [API Ollama](https://docs.ollama.com/api/embed) · [Modelo Qwen](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) |

Para cada candidato registre digest, quantização, contexto, tokens, cold/warm, p50/p95, timeouts, throughput e pico de RSS do runner/serviço, consumo GPU quando houver e tempo de carga. Use `/api/ps` e métricas do host de inferência durante cada execução; compare também duas buscas simultâneas com conversa e modo sombra. Publique curvas de qualidade e memória por capacidade, mantendo ambos os provedores e corpus fixos por rodada. Treinamento de pesos ficou fora.
