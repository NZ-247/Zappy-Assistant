const API_BASE = localStorage.getItem('apiBase') || 'http://localhost:3333';
const tokenInput = document.getElementById('token');
const apiInput = document.getElementById('apiBase');
if (tokenInput) tokenInput.value = localStorage.getItem('adminToken') || '';
if (apiInput) apiInput.value = API_BASE;

function saveSettings() {
  localStorage.setItem('adminToken', tokenInput.value);
  localStorage.setItem('apiBase', apiInput.value);
  alert('Saved');
}

async function api(path, opts = {}) {
  const token = localStorage.getItem('adminToken') || '';
  const base = localStorage.getItem('apiBase') || API_BASE;
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

async function loadFlags() {
  const rows = await api('/admin/flags');
  document.getElementById('data').textContent = JSON.stringify(rows, null, 2);
}

async function createFlag() {
  const payload = {
    key: document.getElementById('key').value,
    description: document.getElementById('description').value,
    enabled: document.getElementById('enabled').checked,
    scope: document.getElementById('scope').value
  };
  await api('/admin/flags', { method: 'POST', body: JSON.stringify(payload) });
  await loadFlags();
}

async function loadTriggers() {
  const rows = await api('/admin/triggers');
  document.getElementById('data').textContent = JSON.stringify(rows, null, 2);
}

async function createTrigger() {
  const payload = {
    name: document.getElementById('name').value,
    pattern: document.getElementById('pattern').value,
    matchType: document.getElementById('matchType').value,
    enabled: document.getElementById('enabled').checked
  };
  await api('/admin/triggers', { method: 'POST', body: JSON.stringify(payload) });
  await loadTriggers();
}

async function loadLogs() {
  const rows = await api('/admin/logs?limit=100');
  document.getElementById('data').textContent = JSON.stringify(rows, null, 2);
}
