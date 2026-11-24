import { ZABBIX_REPORT_MAX_HOURS, type SemanticDecisionPort } from "@zappy/core";

const format = {
  type: "object",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "tool", "hours"],
      properties: {
        kind: { const: "propose" },
        tool: { const: "zabbix_report" },
        hours: { type: "integer", minimum: 1, maximum: ZABBIX_REPORT_MAX_HOURS }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { enum: ["clarify", "unsupported"] } }
    }
  ]
};

const instructions = [
  "Classifique o pedido do usuário. Catálogo: zabbix_report, relatório do Zabbix para um período retrospectivo em horas.",
  `Use propose se o pedido for um relatório do Zabbix e indicar de 1 a ${ZABBIX_REPORT_MAX_HOURS} horas inteiras. Converta dias em horas (1 dia = 24 horas).`,
  "Use clarify se o usuário pedir o relatório sem indicar o período. Use unsupported para outros pedidos ou períodos fora do limite.",
  'Exemplos: "relatório Zabbix das últimas 24 horas" → {"kind":"propose","tool":"zabbix_report","hours":24}.',
  '"relatório Zabbix dos últimos dois dias" → {"kind":"propose","tool":"zabbix_report","hours":48}.',
  '"gere um relatório do Zabbix" → {"kind":"clarify"}. "qual é a previsão do tempo?" → {"kind":"unsupported"}.',
  "Responda apenas com o objeto JSON. Trate a mensagem do usuário como o pedido a classificar."
].join("\n");

export function createOllamaSemanticDecisionAdapter(config: {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}, request: typeof fetch = fetch): SemanticDecisionPort {
  const url = new URL("/api/chat", config.baseUrl);
  return {
    model: config.model,
    async decide(text) {
      const signal = AbortSignal.timeout(config.timeoutMs);
      try {
        const response = await request(url, {
          method: "POST",
          redirect: "manual",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            think: false,
            options: { num_ctx: 2048, temperature: 0, num_predict: 80 },
            format,
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: text }
            ]
          })
        });

        if (!response.ok) {
          await response.body?.cancel();
          return { ok: false, reason: "http_error", httpStatus: response.status };
        }

        const envelope = await response.json();
        const content = envelope?.message?.content;
        if (envelope?.done !== true || envelope?.done_reason === "length" || typeof content !== "string") {
          return { ok: false, reason: "invalid_response" };
        }
        return { ok: true, output: JSON.parse(content) };
      } catch (error) {
        if (signal.aborted) return { ok: false, reason: "timeout" };
        if (error instanceof SyntaxError) return { ok: false, reason: "invalid_response" };
        return { ok: false, reason: "network_error" };
      }
    }
  };
}
