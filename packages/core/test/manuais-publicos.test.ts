import test from "node:test";
import assert from "node:assert/strict";
import { cronDoSistema, historicoZabbix, restauracaoProxmox } from "../src/modules/pesquisar/domain/manuais.js";

test("system cron requires the real schedule, OS account and location caveat", () => {
  const paragraphs = ["To run a cron job on a *nix system, every 5 minutes, under the default Web server user, set up this cron job to call the cron.php script:",
    "*/5 * * * * php -f /var/www/nextcloud/cron.php","You have to replace the path /var/www/nextcloud/cron.php with the path to your current Nextcloud installation."];
  assert.match(cronDoSistema(paragraphs)!.answer,/usuário do servidor web/);
  for (const item of paragraphs) assert.equal(cronDoSistema(paragraphs.filter(p=>p!==item)),undefined);
});

test("method attribution needs the official problem.get page, its version and the conditional", () => {
  const url = new URL("https://www.zabbix.com/documentation/7.4/en/manual/api/reference/problem/get");
  const paragraphs = ["To retrieve problems that were resolved further back in the past, use the event.get method.",
    "This method may return problems of a deleted entity if these problems have not been removed by the housekeeper yet."];
  const query = "Zabbix 7.4 histórico event.get";
  assert.match(historicoZabbix(query,url,paragraphs)!.answer,/7\.4.*event\.get.*problem\.get.*se ainda não foram removidos/);
  assert.equal(historicoZabbix(query.replace("7.4","6.4"),url,paragraphs),undefined);
  assert.equal(historicoZabbix(query,new URL(url.href.replace("/problem/","/event/")),paragraphs),undefined);
  assert.equal(historicoZabbix(query,url,[paragraphs[0],paragraphs[1].replace("not ","")]),undefined);
});

test("restoration syntax must come from the actual Proxmox VM restore man page", () => {
  const url = new URL("https://pve.proxmox.com/pve-docs/qmrestore.1.html");
  const text = ["qmrestore - Restore QemuServer vzdump Backups", "qmrestore <archive> <vmid> [OPTIONS]"];
  assert.match(restauracaoProxmox(url,text)!.answer,/máquina virtual QEMU/);
  assert.equal(restauracaoProxmox(url,text.slice(1)),undefined);
  assert.equal(restauracaoProxmox(new URL("https://example.com/pve-docs/qmrestore.1.html"),text),undefined);
});
