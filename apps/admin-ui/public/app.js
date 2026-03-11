const API_BASE = localStorage.getItem("apiBase") || "http://localhost:3333";
const tokenInput = document.getElementById("token");
const apiInput = document.getElementById("apiBase");
if (tokenInput) tokenInput.value = localStorage.getItem("adminToken") || "";
if (apiInput) apiInput.value = API_BASE;

function saveSettings() {
  localStorage.setItem("adminToken", tokenInput.value);
  localStorage.setItem("apiBase", apiInput.value);
  alert("Saved");
}

async function api(path, opts = {}) {
  const token = localStorage.getItem("adminToken") || "";
  const base = localStorage.getItem("apiBase") || API_BASE;
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

function setData(rows) {
  document.getElementById("data").textContent = JSON.stringify(rows, null, 2);
}

async function loadFlags() { setData(await api("/admin/flags")); }
async function createFlag() {
  const payload = {
    key: document.getElementById("key").value,
    description: document.getElementById("description").value,
    enabled: document.getElementById("enabled").checked,
    value: document.getElementById("value").value || "on",
    scope: document.getElementById("scope").value,
    tenantId: document.getElementById("tenantId").value || undefined,
    groupId: document.getElementById("groupId").value || undefined,
    userId: document.getElementById("userId").value || undefined
  };
  await api("/admin/flags", { method: "POST", body: JSON.stringify(payload) });
  await loadFlags();
}

async function loadTriggers() { setData(await api("/admin/triggers")); }
async function createTrigger() {
  const payload = {
    name: document.getElementById("name").value,
    pattern: document.getElementById("pattern").value,
    responseTemplate: document.getElementById("responseTemplate").value,
    matchType: document.getElementById("matchType").value,
    enabled: document.getElementById("enabled").checked,
    priority: Number(document.getElementById("priority").value || 0),
    cooldownSeconds: Number(document.getElementById("cooldownSeconds").value || 0),
    scope: document.getElementById("scope").value,
    tenantId: document.getElementById("tenantId").value || undefined,
    groupId: document.getElementById("groupId").value || undefined,
    userId: document.getElementById("userId").value || undefined
  };
  await api("/admin/triggers", { method: "POST", body: JSON.stringify(payload) });
  await loadTriggers();
}

async function loadLogs() { setData(await api("/admin/logs?limit=100")); }
async function loadStatus() { setData(await api("/admin/status")); }
async function loadMessages() { setData(await api("/admin/messages?limit=50")); }
async function loadCommands() { setData(await api("/admin/commands?limit=50")); }
async function loadQueues() { setData(await api("/admin/queues")); }
async function loadMetrics() { setData(await api("/admin/metrics/summary")); }
