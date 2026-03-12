export const normalizeConsentInput = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const buildConsentOnboardingText = (consentLink: string): string =>
  [
    "Olá, seja bem-vindo!",
    "Sou Zappy, assistente digital da Services.NET.",
    "",
    "Antes de prosseguir, recomendamos que leia e aceite nossos Termos de Compromisso e a Política de Privacidade disponíveis em:",
    consentLink,
    "",
    "Para continuar, responda com: SIM",
    "Se não concordar, responda com: NÃO"
  ].join("\n");

export const buildConsentReminderText = (consentLink: string): string =>
  `Para continuar, preciso do seu consentimento. Leia: ${consentLink}. Responda SIM para aceitar ou NÃO para recusar.`;

export const buildConsentAcceptedText = (): string =>
  "Obrigado! Consentimento registrado. Sou Zappy, assistente digital da Services.NET. Posso ajudar com suporte, orçamento, agendamento ou dúvidas.";
