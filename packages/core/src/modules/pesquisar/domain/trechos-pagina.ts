import { franc } from "franc-min";

const normalizar = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const palavrasComuns = new Set(["para", "como", "qual", "sobre", "oficial", "documentacao", "versao", "usando"]);

export function selecionarTrecho(
  paragrafos: string[], consulta: string, aceitar?: (trecho: string) => boolean
): string | undefined {
  const termos = [...new Set(normalizar(consulta).match(/[\p{L}\d]+(?:\.[\p{L}\d]+)?/gu) ?? [])]
    .filter((termo) => termo.length >= 3 && !palavrasComuns.has(termo));
  const identificadores = termos.filter((termo) => termo.includes("."));
  const pontuar = (trecho: string) => {
    const texto = normalizar(trecho);
    const relevancia = termos.filter((termo) => texto.includes(termo)).length;
    if (relevancia === 0 || (identificadores.length && !identificadores.some((termo) => texto.includes(termo)))) return 0;
    const metodos = termos.filter((termo) => termo.includes(".") && texto.includes(termo)).length;
    return relevancia + metodos * 2 + (franc(trecho, { minLength: 25 }) === "por" ? 2 : 0) +
      (/housekeeper/i.test(trecho) && /(?:desde que|\bse\b)/i.test(trecho) ? 2 : 0);
  };
  const segmentos = paragrafos.flatMap((trecho) =>
    trecho.length <= 360 ? [trecho] : trecho.split(/(?<=[.!?])\s+(?=\p{Lu})/gu));
  const adjacentes = segmentos.flatMap((trecho, index) => {
    const proximo = segmentos[index + 1];
    const par = proximo ? `${trecho} ${proximo}` : "";
    return par && par.length <= 360 ? [trecho, par] : [trecho];
  });
  const candidatos = adjacentes
    .map((trecho) => trecho.slice(0, 360).trim())
    .filter((trecho) => trecho.length >= 25 && (!aceitar || aceitar(trecho)))
    .map((trecho) => ({ trecho, pontos: pontuar(trecho) }))
    .filter(({ pontos }) => pontos > 0);
  return candidatos.sort((a, b) => b.pontos - a.pontos)[0]?.trecho;
}
