// Narrow renderers for two documented relationships. Keep the source passage separate from the answer.
export type SupportedPassage = { passage: string; answer: string };

export function cronDoSistema(paragraphs: string[]): SupportedPassage | undefined {
  const example = "*/5 * * * * php -f /var/www/nextcloud/cron.php";
  const intro = paragraphs.find(p => /every 5 minutes, under the default Web server user/i.test(p) && /call the cron\.php script/i.test(p));
  const path = paragraphs.find(p => /replace the path .*cron\.php with the path to your current Nextcloud installation/i.test(p));
  if (!intro || !paragraphs.includes(example) || !path) return;
  return { passage: [intro, example, path].join("\n"),
    answer: `O manual orienta executar cron.php a cada cinco minutos como o usuário do servidor web. Ajuste o caminho do exemplo à instalação.\n${example}` };
}

export function historicoZabbix(query: string, url: URL, paragraphs: string[]): SupportedPassage | undefined {
  const path = /^\/documentation\/(\d+\.\d+|current)\/(?:pt|en|es)\/manual\/api\/reference\/problem\/get\/?$/.exec(url.pathname);
  const version = /\bzabbix\s+(\d+\.\d+)/i.exec(query)?.[1];
  if (url.hostname !== "www.zabbix.com" || !path || (version && version !== path[1])) return;
  const resolvedHistory = [
    /^Para recuperar problemas que foram resolvidos (?:mais )?no passado, use o método event\.get\.$/i,
    /^Para recuperar problemas que se resolvieron hace más tiempo, utilice el método event\.get\.$/i,
    /^To retrieve problems that were resolved further back in the past, use the event\.get method\.$/i
  ];
  const conditional = [
    /^(?:Este|Esse) método pode retornar problemas de uma entidade excluída se esses problemas ainda não tiverem sido removidos pelo housekeeper\s*\.$/i,
    /^Este método puede devolver problemas de una entidad eliminada si el housekeeper aún no los ha eliminado\.$/i,
    /^This method may return problems of a deleted entity if these problems have not been removed by the housekeeper yet\.$/i
  ];
  const history = paragraphs.flatMap(p => p.split(/(?<=[.!?])\s+(?=\p{Lu})/u))
    .find(p => resolvedHistory.some(pattern => pattern.test(p)));
  const caveat = paragraphs.find(p => conditional.some(pattern => pattern.test(p)));
  if (!history || !caveat) return;
  return { passage: history + " " + caveat,
    answer: `No manual ${path[1]} do Zabbix, o histórico de problemas resolvidos é consultado com event.get. A ressalva da página se refere a problem.get: problemas de uma entidade excluída podem aparecer se ainda não foram removidos pelo housekeeper.` };
}

export function restauracaoProxmox(url: URL, paragraphs: string[]): SupportedPassage | undefined {
  if (url.hostname !== "pve.proxmox.com" || url.pathname !== "/pve-docs/qmrestore.1.html") return;
  const name = "qmrestore - Restore QemuServer vzdump Backups";
  const usage = "qmrestore <archive> <vmid> [OPTIONS]";
  if (!paragraphs.includes(name) || !paragraphs.includes(usage)) return;
  return { passage: name + "\n" + usage,
    answer: "Para restaurar o backup vzdump de uma máquina virtual QEMU, o manual do Proxmox VE indica a sintaxe\n" + usage };
}
