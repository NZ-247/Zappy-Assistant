// Requests about configuring cron in Nextcloud need evidence for system cron.
export function nextcloudCronScope(query: string) {
  if (!/\bnextcloud\b/i.test(query) || !/\bcron\b/i.test(query) ||
      /\b(?:webcron|easycron)\b/i.test(query) || !/configur|cron\s+local|crontab/i.test(query)) return;
  const version = /\bnextcloud\s+(?:v(?:ers(?:ão|ao)\s*)?)?(\d{2})(?:\.\d+)?\b/i.exec(query)?.[1];
  const manual = `docs.nextcloud.com/server/${version ?? "stable"}/admin_manual`;
  return {
    query: `site:${manual} Nextcloud system cron crontab cron.php background jobs`,
    accepts(url: string, snippet: string) {
      const source = new URL(url);
      return source.hostname === "docs.nextcloud.com" &&
        source.pathname.startsWith(`/server/${version ?? "stable"}/admin_manual/`) &&
        /\b(?:crontab|system cron|cron do sistema|cron job on the server)\b/i.test(snippet) &&
        /cron\.php|\bcrontab\b/i.test(snippet);
    }
  };
}
