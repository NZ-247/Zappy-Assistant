import type { PreSalesKnowledgeBase } from "./pre-sales-models.js";

export const SERVICES_NET_PRESALES_SCHEMA_VERSION = "services_net.pre_sales_knowledge.v1";
export const SERVICES_NET_PRESALES_CATALOG_VERSION = "services_net.service_catalog.v1";
export const SERVICES_NET_PRESALES_FAQ_VERSION = "services_net.faq.v1";
export const SERVICES_NET_PRESALES_TRIAGE_VERSION = "services_net.triage.v1";
export const SERVICES_NET_PRESALES_TEMPLATES_VERSION = "services_net.commercial_templates.v1";

export const SERVICES_NET_PRESALES_KNOWLEDGE_BASE: PreSalesKnowledgeBase = {
  schemaVersion: SERVICES_NET_PRESALES_SCHEMA_VERSION,
  source: "services_net_seed",
  versions: {
    readiness: "seeded_v1",
    catalogVersion: SERVICES_NET_PRESALES_CATALOG_VERSION,
    faqVersion: SERVICES_NET_PRESALES_FAQ_VERSION,
    triageVersion: SERVICES_NET_PRESALES_TRIAGE_VERSION,
    templatesVersion: SERVICES_NET_PRESALES_TEMPLATES_VERSION
  },
  serviceCategories: [
    {
      id: "ti_suporte_tecnologia",
      title: "TI e Suporte Tecnologico",
      shortDescription: "Suporte tecnico e sustentacao operacional para o ambiente de TI.",
      keywords: ["ti", "suporte", "tecnologia", "help desk", "suporte tecnico", "atendimento tecnico"]
    },
    {
      id: "infraestrutura_redes",
      title: "Infraestrutura de Redes",
      shortDescription: "Planejamento, ajuste e estabilizacao de redes cabeadas e sem fio.",
      keywords: ["rede", "wifi", "internet", "switch", "roteador", "latencia", "rede lenta", "infraestrutura de rede"]
    },
    {
      id: "servidores",
      title: "Servidores",
      shortDescription: "Organizacao e suporte de ambientes de servidores fisicos e virtuais.",
      keywords: ["servidor", "windows server", "linux server", "ad", "dominio", "storage", "datacenter"]
    },
    {
      id: "virtualizacao",
      title: "Virtualizacao",
      shortDescription: "Consolidacao e melhoria de ambiente virtual para eficiencia e disponibilidade.",
      keywords: ["virtualizacao", "vm", "hyper-v", "vmware", "proxmox", "maquina virtual"]
    },
    {
      id: "automacao",
      title: "Automacao",
      shortDescription: "Automacao de rotinas tecnicas e de processos com foco em produtividade.",
      keywords: ["automacao", "integracao", "processo", "script", "rpa", "fluxo automatico"]
    },
    {
      id: "seguranca_informacao",
      title: "Seguranca da Informacao",
      shortDescription: "Acoes de protecao, reducao de risco e melhoria da postura de seguranca.",
      keywords: ["seguranca", "firewall", "backup", "ransomware", "protecao", "antivirus", "controle de acesso"]
    },
    {
      id: "gestao_ti",
      title: "Gestao Completa de TI",
      shortDescription: "Gestao continuada do ambiente de TI, priorizacao e melhoria operacional.",
      keywords: ["gestao de ti", "gestao completa", "governanca", "planejamento de ti", "operacao de ti"]
    }
  ],
  serviceOfferings: [
    {
      id: "offering_ti_suporte",
      title: "Suporte de TI e Operacao Tecnica",
      shortDescription: "Atendimento inicial, diagnostico e orientacao para demandas de TI do dia a dia.",
      detailedDescription:
        "Suporte para incidentes recorrentes, orientacao tecnica inicial e organizacao de encaminhamento para resolucao adequada.",
      categoryId: "ti_suporte_tecnologia",
      keywords: ["suporte de ti", "suporte tecnico", "atendimento de ti", "problema no computador", "instabilidade de sistema"],
      clientProblemExamples: [
        "computador lento",
        "nao consigo acessar sistema interno",
        "equipe com dificuldades recorrentes de TI"
      ],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Informar quantidade de usuarios impactados, horario de maior impacto e sintomas observados."
    },
    {
      id: "offering_infraestrutura_redes",
      title: "Infraestrutura e Performance de Redes",
      shortDescription: "Analise de estabilidade, desempenho e organizacao de rede local e wifi.",
      detailedDescription:
        "Apoio em diagnostico de lentidao, quedas de conectividade e ajustes de infraestrutura para maior confiabilidade de rede.",
      categoryId: "infraestrutura_redes",
      keywords: ["rede lenta", "wifi ruim", "queda de internet", "problema de rede", "latencia alta", "switch"],
      clientProblemExamples: ["wifi oscilando", "internet caindo toda hora", "rede lenta no escritorio"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Compartilhar topologia basica, pontos afetados, equipamentos principais e horario das falhas."
    },
    {
      id: "offering_servidores",
      title: "Suporte e Organizacao de Servidores",
      shortDescription: "Acompanhamento de ambiente de servidores e estabilidade de servicos criticos.",
      detailedDescription:
        "Diagnostico inicial e orientacao para disponibilidade de servicos corporativos hospedados em servidores locais ou dedicados.",
      categoryId: "servidores",
      keywords: ["servidor", "server", "dominio", "ad", "controlador de dominio", "storage", "arquivo em servidor"],
      clientProblemExamples: ["servidor instavel", "usuarios sem acesso ao dominio", "servico interno fora do ar"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Descrever criticidade do servico afetado, sistema operacional e impacto no negocio."
    },
    {
      id: "offering_virtualizacao",
      title: "Virtualizacao e Consolidacao de Ambiente",
      shortDescription: "Orientacao inicial para consolidacao e melhoria de cargas virtualizadas.",
      detailedDescription:
        "Apoio em estrutura de maquinas virtuais, capacidade de host e direcionamento para evolucao segura do ambiente virtual.",
      categoryId: "virtualizacao",
      keywords: ["virtualizacao", "maquina virtual", "vm", "vmware", "proxmox", "hyper-v", "cluster virtual"],
      clientProblemExamples: ["host sobrecarregado", "vm lenta", "queda de maquina virtual"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Informar plataforma de virtualizacao, volume aproximado de VMs e principais sintomas."
    },
    {
      id: "offering_automacao",
      title: "Automacao de Rotinas e Integracoes",
      shortDescription: "Triagem de oportunidades para automatizar processos e reduzir operacao manual.",
      detailedDescription:
        "Mapeamento inicial de tarefas repetitivas e orientacao para automacao com foco em ganho operacional e rastreabilidade.",
      categoryId: "automacao",
      keywords: ["automacao", "integracao", "processo repetitivo", "script", "fluxo automatico", "rpa"],
      clientProblemExamples: ["processo manual demorado", "retrabalho em tarefas de rotina", "integracao entre sistemas"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Descrever processo atual, frequencia da rotina, entradas/saidas e sistemas envolvidos."
    },
    {
      id: "offering_seguranca",
      title: "Seguranca da Informacao e Protecao Basica",
      shortDescription: "Triagem de risco e orientacao inicial para protecao do ambiente.",
      detailedDescription:
        "Apoio inicial para analisar riscos, controles basicos e necessidades de seguranca para servidores, redes e dados empresariais.",
      categoryId: "seguranca_informacao",
      keywords: ["seguranca", "firewall", "backup", "protecao", "ransomware", "vazamento", "antivirus"],
      clientProblemExamples: ["necessidade de melhorar backup", "duvida sobre firewall", "preocupacao com ataques"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Informar riscos percebidos, ferramentas atuais e requisitos minimos de continuidade."
    },
    {
      id: "offering_gestao_ti",
      title: "Gestao Completa de TI",
      shortDescription: "Acompanhamento continuado de TI com visao operacional e evolutiva.",
      detailedDescription:
        "Estruturacao de prioridades, rotina tecnica e plano de melhoria para empresas que buscam gestao mais completa de TI.",
      categoryId: "gestao_ti",
      keywords: ["gestao de ti", "gestao completa", "governanca de ti", "operacao de ti", "planejamento de ti"],
      clientProblemExamples: ["falta de padrao na operacao", "muitas demandas sem priorizacao", "necessidade de parceiro para gerir TI"],
      safeForBasicQuoteOrientation: true,
      recommendedNextStep: "Compartilhar tamanho da operacao, principais dores e expectativa de acompanhamento continuo."
    }
  ],
  faqEntries: [
    {
      id: "faq_servicos_oferecidos",
      question: "Que tipo de servico voces oferecem?",
      answer:
        "A Services.NET atua com Tecnologia e Infraestrutura Inteligente, cobrindo TI/suporte, redes, servidores, virtualizacao, automacao, seguranca da informacao e gestao completa de TI.",
      keywords: ["que tipo de servico", "quais servicos", "o que voces fazem", "servicos oferecidos", "sobre a services.net"],
      relatedCategoryIds: [
        "ti_suporte_tecnologia",
        "infraestrutura_redes",
        "servidores",
        "virtualizacao",
        "automacao",
        "seguranca_informacao",
        "gestao_ti"
      ],
      nextStepHint: "Se quiser, eu faco uma triagem inicial para indicar o melhor encaminhamento."
    },
    {
      id: "faq_atendem_problema_x",
      question: "Voces atendem problema X?",
      answer:
        "Na triagem inicial eu avalio o tema, comparo com as frentes de atuacao da Services.NET e indico se ja parece aderente ou se precisa de validacao tecnica/comercial detalhada.",
      keywords: ["voces atendem", "fazem isso", "atende problema", "entra no escopo", "compativel com servicos"],
      nextStepHint: "Descreva o cenario atual e o impacto para eu classificar melhor."
    },
    {
      id: "faq_redes_servidores_seguranca_automacao",
      question: "Voces fazem redes, servidores, seguranca ou automacao?",
      answer:
        "Sim, esses temas fazem parte das frentes principais da Services.NET. O atendimento comeca com triagem para entender contexto, prioridade e melhor encaminhamento.",
      keywords: ["faz redes", "faz servidores", "faz seguranca", "faz automacao", "infraestrutura", "virtualizacao"],
      relatedCategoryIds: ["infraestrutura_redes", "servidores", "seguranca_informacao", "automacao", "virtualizacao"],
      nextStepHint: "Posso te orientar nos dados iniciais que ajudam a abrir o atendimento."
    },
    {
      id: "faq_como_funciona_atendimento",
      question: "Como funciona o atendimento?",
      answer:
        "O fluxo basico e: triagem inicial, classificacao por area tecnica, levantamento de contexto e depois direcionamento para atendimento/comercial conforme a complexidade.",
      keywords: ["como funciona o atendimento", "como voces atendem", "primeiro atendimento", "fluxo de atendimento", "triagem inicial"],
      nextStepHint: "Se quiser, eu inicio a triagem agora com algumas perguntas objetivas."
    },
    {
      id: "faq_como_pedir_orcamento",
      question: "Como pedir orcamento?",
      answer:
        "Eu posso ajudar com pre-orientacao. O valor final depende de avaliacao tecnica/comercial, escopo e prioridade de atendimento.",
      keywords: ["como pedir orcamento", "orcamento", "cotacao", "preco", "valor", "quanto custa"],
      nextStepHint: "Envie contexto, sintomas, urgencia e objetivo para acelerar o encaminhamento comercial."
    },
    {
      id: "faq_escopo",
      question: "Como saber se meu problema entra no escopo?",
      answer:
        "Na pre-triagem eu comparo seu cenario com o catalogo de servicos da Services.NET e retorno uma orientacao inicial. Quando necessario, sinalizo que a validacao final depende de avaliacao tecnica/comercial.",
      keywords: ["entra no escopo", "meu problema", "como saber se atende", "escopo do atendimento", "validar escopo"],
      nextStepHint: "Descreva ambiente, sintomas e impacto para receber a classificacao inicial."
    }
  ],
  inquiryCategories: [
    {
      id: "company_overview",
      title: "Apresentacao da empresa",
      description: "Pergunta sobre o que a Services.NET faz e quais frentes cobre.",
      keywords: ["o que voces fazem", "quais servicos", "que tipo de servico", "sobre a services.net", "empresa faz o que"]
    },
    {
      id: "service_scope_check",
      title: "Checagem de aderencia de servico",
      description: "Pergunta se a empresa atende determinado tema/problema.",
      keywords: ["voces fazem", "voces atendem", "trabalham com", "isso entra no escopo", "conseguem atender"]
    },
    {
      id: "attendance_flow",
      title: "Fluxo de pre-atendimento",
      description: "Pergunta sobre como funciona o atendimento inicial.",
      keywords: ["como funciona o atendimento", "como voces atendem", "fluxo", "triagem", "primeiro contato"]
    },
    {
      id: "quote_orientation",
      title: "Orientacao comercial inicial",
      description: "Pergunta sobre orcamento, preco ou cotacao inicial.",
      keywords: ["orcamento", "cotacao", "preco", "valor", "quanto custa", "proposta comercial"]
    },
    {
      id: "scope_validation",
      title: "Validacao de escopo",
      description: "Pedido para validar se um cenario entra no escopo de atendimento.",
      keywords: ["entra no escopo", "compativel", "esse caso", "validar escopo", "meu problema entra"]
    }
  ],
  responseTemplates: [
    {
      id: "overview",
      description: "Resposta padrao para apresentar o posicionamento comercial da Services.NET.",
      template: "A Services.NET atua com Tecnologia e Infraestrutura Inteligente. Principais frentes: {{serviceList}}."
    },
    {
      id: "scope_match",
      description: "Resposta segura quando existe aderencia inicial de tema com o catalogo.",
      template: "Pelo que voce descreveu, isso parece alinhado com {{categoryTitle}}."
    },
    {
      id: "scope_uncertain",
      description: "Fallback seguro para cenario sem confianca suficiente.",
      template:
        "Posso te ajudar com uma triagem inicial para entender melhor seu cenario. Se fizer sentido com o catalogo da Services.NET, encaminhamos para avaliacao tecnica/comercial."
    },
    {
      id: "attendance_flow",
      description: "Resumo do fluxo de pre-atendimento.",
      template:
        "Fluxo inicial: triagem, classificacao por area tecnica, coleta de contexto e encaminhamento para atendimento/comercial quando necessario."
    },
    {
      id: "quote_boundary",
      description: "Limites comerciais para orientacoes de preco/orcamento.",
      template:
        "Posso orientar um pre-orcamento inicial, mas valores, prazos e garantias finais dependem de avaliacao tecnica/comercial e definicao de escopo."
    },
    {
      id: "next_step",
      description: "Proximo passo seguro para continuidade do atendimento.",
      template:
        "Para avancar: compartilhe ambiente atual, problema/objetivo, urgencia e impacto no negocio. Com isso eu preparo o melhor encaminhamento inicial."
    }
  ]
};
