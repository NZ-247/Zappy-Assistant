const STORAGE_KEY = "zappy.admin-ui.session.v1";

const DEFAULT_SETTINGS = {
  apiBase: "http://localhost:3333",
  token: "",
  actor: "admin-ui",
  tenantId: ""
};

const VIEW_IDS = ["dashboard", "users", "groups", "bundles", "capabilities", "settings", "licenses", "audit", "jobs"];

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toPrettyDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const toFriendlyError = (error) => {
  if (!error) return "Unexpected error.";
  if (error.kind === "unauthorized") {
    return "Unauthorized: check your admin token and save session again.";
  }
  if (error.kind === "network") {
    return `Could not reach admin-api (${error.message}). Check base URL/network.`;
  }
  if (error.kind === "api") {
    return error.message || `Request failed (${error.status}).`;
  }
  return error.message || "Unexpected error.";
};

const normalizeApiError = (status, payload) => {
  const nested = payload?.error;
  const message =
    (typeof nested === "string" && nested) ||
    (typeof nested?.message === "string" && nested.message) ||
    (typeof payload?.message === "string" && payload.message) ||
    (typeof payload?.error === "string" && payload.error) ||
    `Request failed with status ${status}`;

  if (status === 401) {
    return {
      kind: "unauthorized",
      status,
      message
    };
  }

  return {
    kind: "api",
    status,
    message,
    payload
  };
};

const parseStoredSession = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : null,
      token: typeof parsed.token === "string" ? parsed.token : "",
      actor: typeof parsed.actor === "string" ? parsed.actor : DEFAULT_SETTINGS.actor,
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : ""
    };
  } catch {
    return null;
  }
};

const statusBadgeClass = (value) => {
  const normalized = String(value ?? "").toUpperCase();
  if (["APPROVED", "ONLINE", "OK", "ROOT"].includes(normalized)) return "status-approved";
  if (["PENDING", "BASIC", "PRO", "DEGRADED", "SCHEDULED"].includes(normalized)) return "status-pending";
  return "status-blocked";
};

const healthBadge = (health) => {
  if (!health) return '<span class="badge health-bad">unknown</span>';
  const online = health.online ?? health.ok;
  const text = online ? "online" : health.configured === false ? "not configured" : "offline";
  const klass = online ? "health-ok" : health.configured === false ? "health-warn" : "health-bad";
  return `<span class="badge ${klass}">${escapeHtml(text)}</span>`;
};

const summarizeAuditDiff = (item) => {
  const before = item?.before ?? null;
  const after = item?.after ?? null;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return item.action;
  }

  const changes = [];
  if (before.status !== after.status) changes.push(`status: ${before.status ?? "-"} -> ${after.status ?? "-"}`);
  if (before.tier !== after.tier) changes.push(`tier: ${before.tier ?? "-"} -> ${after.tier ?? "-"}`);
  if (before.approvedBy !== after.approvedBy) changes.push(`approvedBy: ${before.approvedBy ?? "-"} -> ${after.approvedBy ?? "-"}`);
  if (!changes.length) return item.action;
  return changes.join(" | ");
};

const createApiClient = ({ fetchImpl, getSession }) => {
  const call = async (path, options = {}) => {
    const session = getSession();
    const method = options.method ?? "GET";
    const headers = {
      "x-admin-api-base": session.apiBase,
      "x-admin-token": session.token,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {})
    };

    let response;
    try {
      response = await fetchImpl(`/ui-api${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      throw {
        kind: "network",
        message: error?.message || "Network error"
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");

    if (!response.ok) {
      throw normalizeApiError(response.status, payload);
    }

    return payload;
  };

  return {
    call,
    getStatus: () => call("/admin/v1/status"),
    getMetrics: () => call("/admin/metrics/summary"),
    listUsers: (tenantId) => call(`/admin/v1/users${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    getUserUsage: (waUserId, tenantId) =>
      call(`/admin/v1/usage/users/${encodeURIComponent(waUserId)}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    updateUserAccess: (waUserId, body) => call(`/admin/v1/users/${encodeURIComponent(waUserId)}/access`, { method: "PATCH", body }),
    updateUserTier: (waUserId, body) => call(`/admin/v1/users/${encodeURIComponent(waUserId)}/license`, { method: "PATCH", body }),
    listGroups: (tenantId) => call(`/admin/v1/groups${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    getGroupUsage: (waGroupId, tenantId) =>
      call(`/admin/v1/usage/groups/${encodeURIComponent(waGroupId)}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    updateGroupAccess: (waGroupId, body) => call(`/admin/v1/groups/${encodeURIComponent(waGroupId)}/access`, { method: "PATCH", body }),
    updateGroupTier: (waGroupId, body) => call(`/admin/v1/groups/${encodeURIComponent(waGroupId)}/license`, { method: "PATCH", body }),
    listPlans: () => call("/admin/v1/licenses/plans"),
    listGovernanceCapabilities: () => call("/admin/v1/governance/capabilities"),
    listGovernanceBundles: () => call("/admin/v1/governance/bundles"),
    createGovernanceBundle: (body) => call("/admin/v1/governance/bundles", { method: "POST", body }),
    updateGovernanceBundle: (bundleKey, body) =>
      call(`/admin/v1/governance/bundles/${encodeURIComponent(bundleKey)}`, { method: "PATCH", body }),
    assignCapabilityToBundle: (bundleKey, capabilityKey, body) =>
      call(`/admin/v1/governance/bundles/${encodeURIComponent(bundleKey)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "PUT", body }),
    removeCapabilityFromBundle: (bundleKey, capabilityKey, body) =>
      call(`/admin/v1/governance/bundles/${encodeURIComponent(bundleKey)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "DELETE", body }),
    getGovernanceSettings: () => call("/admin/v1/governance/settings"),
    getPreSalesKnowledge: () => call("/admin/v1/presales/knowledge"),
    getPreSalesCatalog: () => call("/admin/v1/presales/catalog"),
    getPreSalesFaq: () => call("/admin/v1/presales/faq"),
    getUserEffectiveGovernance: (waUserId, tenantId) =>
      call(`/admin/v1/governance/users/${encodeURIComponent(waUserId)}/effective${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    getGroupEffectiveGovernance: (waGroupId, query = "") =>
      call(`/admin/v1/governance/groups/${encodeURIComponent(waGroupId)}/effective${query ? `?${query}` : ""}`),
    assignUserBundle: (waUserId, bundleKey, body) =>
      call(`/admin/v1/governance/users/${encodeURIComponent(waUserId)}/bundles/${encodeURIComponent(bundleKey)}`, { method: "PUT", body }),
    removeUserBundle: (waUserId, bundleKey, body) =>
      call(`/admin/v1/governance/users/${encodeURIComponent(waUserId)}/bundles/${encodeURIComponent(bundleKey)}`, { method: "DELETE", body }),
    assignGroupBundle: (waGroupId, bundleKey, body) =>
      call(`/admin/v1/governance/groups/${encodeURIComponent(waGroupId)}/bundles/${encodeURIComponent(bundleKey)}`, { method: "PUT", body }),
    removeGroupBundle: (waGroupId, bundleKey, body) =>
      call(`/admin/v1/governance/groups/${encodeURIComponent(waGroupId)}/bundles/${encodeURIComponent(bundleKey)}`, { method: "DELETE", body }),
    setUserCapabilityOverride: (waUserId, capabilityKey, body) =>
      call(`/admin/v1/governance/users/${encodeURIComponent(waUserId)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "PUT", body }),
    clearUserCapabilityOverride: (waUserId, capabilityKey, body) =>
      call(`/admin/v1/governance/users/${encodeURIComponent(waUserId)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "DELETE", body }),
    setGroupCapabilityOverride: (waGroupId, capabilityKey, body) =>
      call(`/admin/v1/governance/groups/${encodeURIComponent(waGroupId)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "PUT", body }),
    clearGroupCapabilityOverride: (waGroupId, capabilityKey, body) =>
      call(`/admin/v1/governance/groups/${encodeURIComponent(waGroupId)}/capabilities/${encodeURIComponent(capabilityKey)}`, { method: "DELETE", body }),
    listAudit: (query = "") => call(`/admin/v1/audit${query ? `?${query}` : ""}`),
    listReminders: (query = "") => call(`/admin/v1/reminders${query ? `?${query}` : ""}`),
    retryReminder: (id, body) => call(`/admin/v1/reminders/${encodeURIComponent(id)}/retry`, { method: "POST", body })
  };
};

export const createAdminUiApp = ({
  document,
  fetchImpl,
  storage,
  uiConfig = {
    defaultAdminApiBaseUrl: DEFAULT_SETTINGS.apiBase,
    uiVersion: "1.9.2"
  }
}) => {
  const viewRoot = document.getElementById("view-root");
  const globalMessage = document.getElementById("global-message");
  const sessionBadge = document.getElementById("session-badge");
  const uiVersionBadge = document.getElementById("ui-version-badge");
  const configFeedback = document.getElementById("config-feedback");

  const configApiBase = document.getElementById("config-api-base");
  const configToken = document.getElementById("config-token");
  const configActor = document.getElementById("config-actor");
  const configTenant = document.getElementById("config-tenant");

  const stored = parseStoredSession(storage?.getItem?.(STORAGE_KEY));

  const state = {
    view: "dashboard",
    loading: false,
    session: {
      apiBase: stored?.apiBase || uiConfig.defaultAdminApiBaseUrl || DEFAULT_SETTINGS.apiBase,
      token: stored?.token || "",
      actor: stored?.actor || DEFAULT_SETTINGS.actor,
      tenantId: stored?.tenantId || ""
    },
    plans: [],
    governanceCapabilities: [],
    governanceBundles: [],
    users: [],
    groups: [],
    audit: [],
    reminders: [],
    dashboard: null,
    metrics: null,
    settings: null,
    preSalesKnowledge: null,
    preSalesCatalog: null,
    preSalesFaq: null,
    filters: {
      usersSearch: "",
      groupsSearch: "",
      auditType: "",
      auditSubjectId: "",
      reminderStatus: ""
    },
    details: {
      user: null,
      group: null,
      bundleEditor: null
    }
  };

  const api = createApiClient({
    fetchImpl,
    getSession: () => state.session
  });

  const renderSessionBadge = () => {
    const ready = Boolean(state.session.apiBase && state.session.token);
    sessionBadge.className = `chip ${ready ? "chip-ok" : "chip-alert"}`;
    sessionBadge.textContent = ready ? "Session configured" : "Session not configured";
  };

  const setFeedback = (message) => {
    configFeedback.textContent = message;
  };

  const showGlobalMessage = (message, type = "info") => {
    if (!message) {
      globalMessage.classList.add("hidden");
      globalMessage.textContent = "";
      globalMessage.classList.remove("warn", "error");
      return;
    }
    globalMessage.classList.remove("hidden", "warn", "error");
    if (type === "warn") globalMessage.classList.add("warn");
    if (type === "error") globalMessage.classList.add("error");
    globalMessage.textContent = message;
  };

  const readSessionFromForm = () => {
    state.session.apiBase = String(configApiBase.value || "").trim() || uiConfig.defaultAdminApiBaseUrl || DEFAULT_SETTINGS.apiBase;
    state.session.token = String(configToken.value || "").trim();
    state.session.actor = String(configActor.value || "").trim() || DEFAULT_SETTINGS.actor;
    state.session.tenantId = String(configTenant.value || "").trim();
  };

  const fillFormFromSession = () => {
    configApiBase.value = state.session.apiBase;
    configToken.value = state.session.token;
    configActor.value = state.session.actor;
    configTenant.value = state.session.tenantId;
  };

  const saveSession = () => {
    readSessionFromForm();
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(state.session));
    renderSessionBadge();
  };

  const clearSession = () => {
    storage?.removeItem?.(STORAGE_KEY);
    state.session = {
      apiBase: uiConfig.defaultAdminApiBaseUrl || DEFAULT_SETTINGS.apiBase,
      token: "",
      actor: DEFAULT_SETTINGS.actor,
      tenantId: ""
    };
    fillFormFromSession();
    renderSessionBadge();
  };

  const renderStateCard = (klass, text) => {
    viewRoot.innerHTML = `<div class="state-card ${klass}">${escapeHtml(text)}</div>`;
  };

  const renderLoading = () => renderStateCard("state-loading", "Loading admin data...");

  const renderError = (error) => {
    renderStateCard("state-error", toFriendlyError(error));
  };

  const renderEmpty = (text) => renderStateCard("state-empty", text || "No records found.");

  const renderDashboard = () => {
    const status = state.dashboard;
    if (!status) return renderEmpty("No dashboard status returned by admin-api.");

    const metrics = state.metrics || {};

    const serviceRows = [
      { name: "wa-gateway", info: status.services?.gateway, detail: status.services?.gateway?.lastHeartbeat },
      { name: "worker", info: status.services?.worker, detail: status.services?.worker?.lastHeartbeat },
      { name: "admin-api", info: status.services?.adminApi, detail: status.checkedAt },
      { name: "media-resolver-api", info: status.services?.mediaResolverApi, detail: status.services?.mediaResolverApi?.baseUrl },
      { name: "assistant-api", info: status.services?.assistantApi, detail: status.services?.assistantApi?.baseUrl || "optional" }
    ];

    const warnings = Array.isArray(status.warnings) ? status.warnings : [];

    viewRoot.innerHTML = `
      <div class="card-grid">
        <article class="info-card"><h3>Project Version</h3><p class="metric mono">${escapeHtml(status.projectVersion || "-")}</p></article>
        <article class="info-card"><h3>Queue Failed</h3><p class="metric">${escapeHtml(status.failures?.queueFailedJobs ?? 0)}</p></article>
        <article class="info-card"><h3>Reminders Failed</h3><p class="metric">${escapeHtml(status.failures?.failedReminders ?? 0)}</p></article>
        <article class="info-card"><h3>Redis</h3><p class="metric">${status.redis?.ok ? "OK" : "FAIL"}</p></article>
        <article class="info-card"><h3>Postgres</h3><p class="metric">${status.db?.ok ? "OK" : "FAIL"}</p></article>
        <article class="info-card"><h3>Commands Executed</h3><p class="metric">${escapeHtml(metrics.commands_executed_total ?? 0)}</p></article>
      </div>

      <h3>Service Health</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Service</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
            ${serviceRows
              .map(
                (row) =>
                  `<tr><td class="mono">${escapeHtml(row.name)}</td><td>${healthBadge(row.info)}</td><td class="mono">${escapeHtml(
                    row.detail || "-"
                  )}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="card-grid" style="margin-top:0.75rem">
        <article class="info-card">
          <h3>Jobs Summary</h3>
          <p class="subtext">waiting ${escapeHtml(status.queue?.waiting ?? 0)} | active ${escapeHtml(status.queue?.active ?? 0)} | delayed ${escapeHtml(
      status.queue?.delayed ?? 0
    )}</p>
        </article>
        <article class="info-card">
          <h3>Reminders Summary</h3>
          <p class="subtext">scheduled ${escapeHtml(status.reminders?.SCHEDULED ?? 0)} | sent ${escapeHtml(status.reminders?.SENT ?? 0)} | canceled ${escapeHtml(
      status.reminders?.CANCELED ?? 0
    )}</p>
        </article>
        <article class="info-card">
          <h3>Resolver Summary</h3>
          <p class="subtext">${escapeHtml(
            status.resolver?.health?.configured ? `health=${status.resolver.health.status}` : "health endpoint not configured"
          )}</p>
        </article>
      </div>

      ${warnings.length ? `<div class="state-card state-empty" style="margin-top:0.8rem">Warnings: ${escapeHtml(warnings.join(" | "))}</div>` : ""}

      <h3 style="margin-top:0.9rem">Recent Failures</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Reminder</th><th>Status</th><th>Message</th><th>Updated</th></tr></thead>
          <tbody>
            ${
              (status.failures?.recentFailedReminders || [])
                .map(
                  (item) => `<tr>
                      <td class="mono">${escapeHtml(item.publicId || item.id)}</td>
                      <td><span class="badge status-blocked">${escapeHtml(item.status)}</span></td>
                      <td>${escapeHtml(item.message)}</td>
                      <td class="mono">${escapeHtml(toPrettyDate(item.updatedAt))}</td>
                    </tr>`
                )
                .join("") || '<tr><td colspan="4">No recent failures.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  };

  const renderGovernanceSection = (kind, detail) => {
    const governance = detail?.governance?.item;
    if (!governance) {
      return '<article class="info-card"><h3>Governance</h3><p class="subtext">No governance details loaded.</p></article>';
    }

    const subjectId = kind === "user" ? detail?.item?.waUserId : detail?.item?.waGroupId;
    const assignedBundles = new Set((kind === "user" ? governance.assignedBundles?.user : governance.assignedBundles?.group) || []);
    const overrides = kind === "user" ? governance.overrides?.user || {} : governance.overrides?.group || {};
    const bundleActionPrefix = kind === "user" ? "user-bundle" : "group-bundle";
    const capabilityActionPrefix = kind === "user" ? "user-capability" : "group-capability";

    return `
      <article class="info-card governance-card">
        <h3>Governance Policy</h3>
        <p class="subtext">Tier <span class="mono">${escapeHtml(governance.tier)}</span> | Status <span class="mono">${escapeHtml(governance.status)}</span></p>
        <h4>Bundles</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Bundle</th><th>Assigned</th><th>Action</th></tr></thead>
            <tbody>
              ${
                state.governanceBundles.length
                  ? state.governanceBundles
                      .map((bundle) => {
                        const isAssigned = assignedBundles.has(bundle.key);
                        const action = isAssigned ? `${bundleActionPrefix}-remove` : `${bundleActionPrefix}-add`;
                        const actionLabel = isAssigned ? "Remove" : "Add";
                        return `<tr>
                          <td><div class="mono">${escapeHtml(bundle.key)}</div><div>${escapeHtml(bundle.displayName || bundle.key)}</div></td>
                          <td>${isAssigned ? '<span class="badge status-approved">yes</span>' : '<span class="badge status-blocked">no</span>'}</td>
                          <td><button class="btn btn-ghost" data-action="${escapeHtml(action)}" data-id="${escapeHtml(subjectId)}" data-bundle="${escapeHtml(bundle.key)}">${actionLabel}</button></td>
                        </tr>`;
                      })
                      .join("")
                  : '<tr><td colspan="3">No bundle catalog loaded.</td></tr>'
              }
            </tbody>
          </table>
        </div>

        <h4>Capabilities</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Capability</th><th>Allow</th><th>Source</th><th>Override</th></tr></thead>
            <tbody>
              ${
                (governance.effectiveCapabilities || [])
                  .map((item) => {
                    const currentOverride = overrides[item.key] || "inherit";
                    const selectorKey = `${subjectId}::${item.key}`;
                    return `<tr>
                      <td><div class="mono">${escapeHtml(item.key)}</div><div class="subtext">bundles: ${escapeHtml((item.matchedBundles || []).join(", ") || "-")}</div></td>
                      <td>${item.allow ? '<span class="badge status-approved">allow</span>' : '<span class="badge status-blocked">deny</span>'}</td>
                      <td class="mono">${escapeHtml(item.source)}${item.denySource ? ` / ${escapeHtml(item.denySource)}` : ""}</td>
                      <td>
                        <div class="inline-actions">
                          <select data-override-select-${escapeHtml(kind)}="${escapeHtml(selectorKey)}">
                            <option value="inherit" ${currentOverride === "inherit" ? "selected" : ""}>inherit</option>
                            <option value="allow" ${currentOverride === "allow" ? "selected" : ""}>allow</option>
                            <option value="deny" ${currentOverride === "deny" ? "selected" : ""}>deny</option>
                          </select>
                          <button class="btn btn-ghost" data-action="${escapeHtml(capabilityActionPrefix)}-apply" data-id="${escapeHtml(subjectId)}" data-capability="${escapeHtml(
                      item.key
                    )}">Apply</button>
                        </div>
                      </td>
                    </tr>`;
                  })
                  .join("") || '<tr><td colspan="4">No capability records.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>
    `;
  };

  const renderUsers = () => {
    const filtered = state.users.filter((item) => {
      const needle = state.filters.usersSearch.trim().toLowerCase();
      if (!needle) return true;
      return [item.waUserId, item.displayName, item.phoneNumber, item.permissionRole, item.authorityRole]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });

    if (!filtered.length) return renderEmpty("No users match this filter.");

    const tierOptions = state.plans
      .map((plan) => `<option value="${escapeHtml(plan.tier)}">${escapeHtml(plan.tier)}</option>`)
      .join("");

    viewRoot.innerHTML = `
      <div class="tools-row">
        <input id="users-search" type="search" value="${escapeHtml(state.filters.usersSearch)}" placeholder="Search by WA user id, name, or phone" />
        <button type="button" class="btn" data-action="users-refresh">Refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Authority</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map(
                (item) => `<tr>
                <td>
                  <div class="mono">${escapeHtml(item.waUserId)}</div>
                  <div>${escapeHtml(item.displayName || "-")}</div>
                </td>
                <td><span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
                <td><span class="badge ${`tier-${String(item.tier || "").toLowerCase()}`}">${escapeHtml(item.tier)}</span></td>
                <td>
                  <span class="badge ${`tier-${String((item.authorityRole || item.permissionRole || "member")).toLowerCase()}`}">${escapeHtml(
                    item.authorityRole || String(item.permissionRole || "MEMBER").toUpperCase()
                  )}</span>
                  <div class="subtext">bot-admin: ${item.isBotAdmin ? "yes" : "no"}</div>
                </td>
                <td class="mono">${escapeHtml(toPrettyDate(item.updatedAt))}</td>
                <td>
                  <div class="inline-actions">
                    <button class="btn" data-action="user-approve" data-id="${escapeHtml(item.waUserId)}">Approve</button>
                    <button class="btn btn-danger" data-action="user-block" data-id="${escapeHtml(item.waUserId)}">Block</button>
                    <select data-tier-select-user="${escapeHtml(item.waUserId)}">${tierOptions.replace(`value=\"${escapeHtml(item.tier)}\"`, `value=\"${escapeHtml(
                  item.tier
                )}\" selected`)}</select>
                    <button class="btn" data-action="user-tier" data-id="${escapeHtml(item.waUserId)}">Set Tier</button>
                    <button class="btn btn-ghost" data-action="user-details" data-id="${escapeHtml(item.waUserId)}">Details</button>
                  </div>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${
        state.details.user
          ? `<section style="margin-top:0.8rem" class="two-col governance-details">
            <article class="info-card"><h3>User Details</h3><pre>${escapeHtml(JSON.stringify(state.details.user.item, null, 2))}</pre></article>
            <article class="info-card"><h3>User Usage</h3><pre>${escapeHtml(JSON.stringify(state.details.user.usage, null, 2))}</pre></article>
            ${renderGovernanceSection("user", state.details.user)}
          </section>`
          : ""
      }
    `;
  };

  const renderGroups = () => {
    const filtered = state.groups.filter((item) => {
      const needle = state.filters.groupsSearch.trim().toLowerCase();
      if (!needle) return true;
      return [item.waGroupId, item.groupName].some((value) => String(value || "").toLowerCase().includes(needle));
    });

    if (!filtered.length) return renderEmpty("No groups match this filter.");

    const tierOptions = state.plans
      .map((plan) => `<option value="${escapeHtml(plan.tier)}">${escapeHtml(plan.tier)}</option>`)
      .join("");

    viewRoot.innerHTML = `
      <div class="tools-row">
        <input id="groups-search" type="search" value="${escapeHtml(state.filters.groupsSearch)}" placeholder="Search by group id or name" />
        <button type="button" class="btn" data-action="groups-refresh">Refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map(
                (item) => `<tr>
                <td>
                  <div class="mono">${escapeHtml(item.waGroupId)}</div>
                  <div>${escapeHtml(item.groupName || "-")}</div>
                </td>
                <td><span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
                <td><span class="badge ${`tier-${String(item.tier || "").toLowerCase()}`}">${escapeHtml(item.tier)}</span></td>
                <td class="mono">${escapeHtml(toPrettyDate(item.updatedAt))}</td>
                <td>
                  <div class="inline-actions">
                    <button class="btn" data-action="group-approve" data-id="${escapeHtml(item.waGroupId)}">Approve</button>
                    <button class="btn btn-danger" data-action="group-block" data-id="${escapeHtml(item.waGroupId)}">Block</button>
                    <select data-tier-select-group="${escapeHtml(item.waGroupId)}">${tierOptions.replace(`value=\"${escapeHtml(item.tier)}\"`, `value=\"${escapeHtml(
                  item.tier
                )}\" selected`)}</select>
                    <button class="btn" data-action="group-tier" data-id="${escapeHtml(item.waGroupId)}">Set Tier</button>
                    <button class="btn btn-ghost" data-action="group-details" data-id="${escapeHtml(item.waGroupId)}">Details</button>
                  </div>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${
        state.details.group
          ? `<section style="margin-top:0.8rem" class="two-col governance-details">
            <article class="info-card"><h3>Group Details</h3><pre>${escapeHtml(JSON.stringify(state.details.group.item, null, 2))}</pre></article>
            <article class="info-card"><h3>Group Usage</h3><pre>${escapeHtml(JSON.stringify(state.details.group.usage, null, 2))}</pre></article>
            ${renderGovernanceSection("group", state.details.group)}
          </section>`
          : ""
      }
    `;
  };

  const parseCapabilityCsv = (value) =>
    [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];

  const renderBundles = () => {
    const editor = state.details.bundleEditor;

    viewRoot.innerHTML = `
      <section class="info-card">
        <h3>Create Bundle</h3>
        <p class="subtext">Create an access group and optionally attach capabilities in one step.</p>
        <div class="tools-row">
          <input id="bundle-create-key" placeholder="bundle key (ex: onboarding_private)" />
          <input id="bundle-create-name" placeholder="display name" />
          <input id="bundle-create-description" placeholder="description (optional)" />
          <label class="subtext" style="display:flex;align-items:center;gap:0.35rem">
            <input id="bundle-create-active" type="checkbox" checked />
            active
          </label>
          <button class="btn" data-action="bundle-create">Create Bundle</button>
          <button class="btn btn-ghost" data-action="bundles-refresh">Refresh</button>
        </div>
        <div class="tools-row">
          <input id="bundle-create-capabilities" style="min-width:420px;max-width:100%" placeholder="capabilities (comma separated)" />
        </div>
      </section>

      <section style="margin-top:0.8rem" class="info-card">
        <h3>Bundle Catalog</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Bundle</th><th>Active</th><th>Capabilities</th><th>Updated</th><th>Action</th></tr></thead>
            <tbody>
              ${
                state.governanceBundles.length
                  ? state.governanceBundles
                      .map(
                        (bundle) => `<tr>
                        <td><div class="mono">${escapeHtml(bundle.key)}</div><div>${escapeHtml(bundle.displayName || bundle.key)}</div><div class="subtext">${escapeHtml(
                          bundle.description || "-"
                        )}</div></td>
                        <td>${bundle.active ? '<span class="badge status-approved">active</span>' : '<span class="badge status-blocked">inactive</span>'}</td>
                        <td class="mono">${escapeHtml((bundle.capabilities || []).join(", ") || "-")}</td>
                        <td class="mono">${escapeHtml(toPrettyDate(bundle.updatedAt))}</td>
                        <td><button class="btn btn-ghost" data-action="bundle-edit" data-bundle="${escapeHtml(bundle.key)}">Edit</button></td>
                      </tr>`
                      )
                      .join("")
                  : '<tr><td colspan="5">No bundles available.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      ${
        editor
          ? `<section style="margin-top:0.8rem" class="info-card">
            <h3>Edit Bundle</h3>
            <p class="subtext">Key <span class="mono">${escapeHtml(editor.key)}</span></p>
            <div class="tools-row">
              <input id="bundle-edit-name" value="${escapeHtml(editor.displayName || "")}" placeholder="display name" />
              <input id="bundle-edit-description" value="${escapeHtml(editor.description || "")}" placeholder="description (optional)" />
              <label class="subtext" style="display:flex;align-items:center;gap:0.35rem">
                <input id="bundle-edit-active" type="checkbox" ${editor.active ? "checked" : ""} />
                active
              </label>
              <button class="btn" data-action="bundle-save" data-bundle="${escapeHtml(editor.key)}">Save Bundle</button>
              <button class="btn btn-ghost" data-action="bundle-edit-cancel">Cancel</button>
            </div>
            <div class="tools-row">
              <input id="bundle-edit-capabilities" style="min-width:420px;max-width:100%" value="${escapeHtml(
                (editor.capabilities || []).join(", ")
              )}" placeholder="capabilities (comma separated)" />
            </div>
          </section>`
          : ""
      }
    `;
  };

  const resolveCapabilityMembership = (capability) => {
    if (Array.isArray(capability.bundles) && capability.bundles.length) return capability.bundles;
    return state.governanceBundles
      .filter((bundle) => (bundle.capabilities || []).includes(capability.key))
      .map((bundle) => bundle.key)
      .sort((a, b) => a.localeCompare(b));
  };

  const renderCapabilities = () => {
    if (!state.governanceCapabilities.length) return renderEmpty("No capability catalog entries available.");

    viewRoot.innerHTML = `
      <div class="tools-row">
        <button class="btn btn-ghost" data-action="capabilities-refresh">Refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Capability</th><th>Category</th><th>Description</th><th>Bundles</th><th>Active</th></tr></thead>
          <tbody>
            ${state.governanceCapabilities
              .map((capability) => {
                const memberships = resolveCapabilityMembership(capability);
                return `<tr>
                  <td class="mono">${escapeHtml(capability.key)}</td>
                  <td>${escapeHtml(capability.category || "-")}</td>
                  <td>${escapeHtml(capability.description || capability.displayName || "-")}</td>
                  <td class="mono">${escapeHtml(memberships.join(", ") || "-")}</td>
                  <td>${capability.active ? '<span class="badge status-approved">active</span>' : '<span class="badge status-blocked">inactive</span>'}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderSettings = () => {
    const settings = state.settings?.item ?? state.settings;
    if (!settings) return renderEmpty("Governance defaults unavailable.");

    const privateDefault = settings.defaults?.privateUser || {};
    const groupDefault = settings.defaults?.group || {};
    const onboarding = settings.onboarding || {};
    const preSales = settings.preSales || {};
    const preSalesServiceCatalog = preSales.serviceCatalog || {};
    const preSalesFaq = preSales.faq || {};
    const preSalesKnowledge = state.preSalesKnowledge || {};
    const preSalesCatalogPayload = state.preSalesCatalog || {};
    const preSalesFaqPayload = state.preSalesFaq || {};
    const serviceCategories = preSalesCatalogPayload.categories || preSalesKnowledge.serviceCategories || [];
    const serviceOfferings = preSalesCatalogPayload.items || preSalesKnowledge.serviceOfferings || [];
    const faqEntries = preSalesFaqPayload.items || preSalesKnowledge.faqEntries || [];

    viewRoot.innerHTML = `
      <div class="card-grid">
        <article class="info-card">
          <h3>New Private User Default</h3>
          <p class="metric mono">${escapeHtml(privateDefault.status || "-")} / ${escapeHtml(privateDefault.tier || "-")}</p>
          <p class="subtext">Onboarding-friendly private default (assistant explanation and basic help/quote flows enabled).</p>
        </article>
        <article class="info-card">
          <h3>New Group Default</h3>
          <p class="metric mono">${escapeHtml(groupDefault.status || "-")} / ${escapeHtml(groupDefault.tier || "-")}</p>
          <p class="subtext">Group policy remains independently governed from private defaults.</p>
        </article>
        <article class="info-card">
          <h3>Onboarding Flags</h3>
          <p class="subtext">privateAssistantEnabled: ${onboarding.privateAssistantEnabled ? "true" : "false"}</p>
          <p class="subtext">serviceExplanationEnabled: ${onboarding.serviceExplanationEnabled ? "true" : "false"}</p>
          <p class="subtext">basicQuoteHelpEnabled: ${onboarding.basicQuoteHelpEnabled ? "true" : "false"}</p>
        </article>
        <article class="info-card">
          <h3>Pre-Sales Knowledge</h3>
          <p class="subtext">readiness: ${escapeHtml(preSales.readiness || "placeholder_only")}</p>
          <p class="subtext">catalogVersion: ${escapeHtml(preSales.catalogVersion || preSalesKnowledge.catalogVersion || "-")}</p>
          <p class="subtext">faqVersion: ${escapeHtml(preSales.faqVersion || preSalesKnowledge.faqVersion || "-")}</p>
          <p class="subtext">triageVersion: ${escapeHtml(preSales.triageVersion || preSalesKnowledge.triageVersion || "-")}</p>
          <p class="subtext">templatesVersion: ${escapeHtml(preSales.templatesVersion || preSalesKnowledge.templatesVersion || "-")}</p>
          <p class="subtext">service catalog: ${escapeHtml(preSalesServiceCatalog.schemaVersion || "-")} (${escapeHtml(preSalesServiceCatalog.source || "-")}, categories=${escapeHtml(preSalesServiceCatalog.categories ?? 0)}, entries=${escapeHtml(preSalesServiceCatalog.entries ?? 0)})</p>
          <p class="subtext">faq: ${escapeHtml(preSalesFaq.schemaVersion || "-")} (${escapeHtml(preSalesFaq.source || "-")}, entries=${escapeHtml(preSalesFaq.entries ?? 0)})</p>
        </article>
      </div>
      <article class="info-card" style="margin-top:0.8rem">
        <h3>Service Catalog Seed (${escapeHtml(preSalesCatalogPayload.catalogVersion || preSales.catalogVersion || "-")})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Service Offering</th><th>Category</th><th>Safe Orientation</th><th>Recommended Next Step</th></tr></thead>
            <tbody>
              ${
                serviceOfferings.length
                  ? serviceOfferings
                      .map((item) => {
                        const category = serviceCategories.find((entry) => entry.id === item.categoryId);
                        return `<tr>
                          <td><div>${escapeHtml(item.title)}</div><div class="subtext">${escapeHtml(item.shortDescription || "-")}</div></td>
                          <td>${escapeHtml(category?.title || item.categoryId || "-")}</td>
                          <td>${item.safeForBasicQuoteOrientation ? '<span class="badge status-approved">yes</span>' : '<span class="badge status-blocked">no</span>'}</td>
                          <td>${escapeHtml(item.recommendedNextStep || "-")}</td>
                        </tr>`;
                      })
                      .join("")
                  : '<tr><td colspan="4">No pre-sales service catalog entries available.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>
      <article class="info-card" style="margin-top:0.8rem">
        <h3>FAQ Seed (${escapeHtml(preSalesFaqPayload.faqVersion || preSales.faqVersion || "-")})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Question</th><th>Answer</th><th>Next Step Hint</th></tr></thead>
            <tbody>
              ${
                faqEntries.length
                  ? faqEntries
                      .map(
                        (item) => `<tr>
                        <td>${escapeHtml(item.question)}</td>
                        <td>${escapeHtml(item.answer)}</td>
                        <td>${escapeHtml(item.nextStepHint || "-")}</td>
                      </tr>`
                      )
                      .join("")
                  : '<tr><td colspan="3">No FAQ entries available.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>
    `;
  };

  const renderLicenses = () => {
    if (!state.plans.length) return renderEmpty("No license plan metadata available.");
    viewRoot.innerHTML = `
      <div class="card-grid">
        ${state.plans
          .map(
            (plan) => `<article class="info-card">
            <h3>${escapeHtml(plan.displayName || plan.tier)}</h3>
            <p class="metric mono">${escapeHtml(plan.tier)}</p>
            <p class="subtext">${escapeHtml(plan.description || "No description")}</p>
            <p class="subtext">active: ${plan.active ? "yes" : "no"}</p>
            <pre>${escapeHtml(JSON.stringify(plan.capabilityDefaults ?? {}, null, 2))}</pre>
          </article>`
          )
          .join("")}
      </div>
      <div class="state-card state-empty">Tier assignment actions live in Users and Groups screens to keep control-plane writes centralized in admin-api.</div>
    `;
  };

  const renderAudit = () => {
    if (!state.audit.length) return renderEmpty("No audit entries found.");

    viewRoot.innerHTML = `
      <div class="tools-row">
        <select id="audit-type">
          <option value="">All subjects</option>
          <option value="USER" ${state.filters.auditType === "USER" ? "selected" : ""}>USER</option>
          <option value="GROUP" ${state.filters.auditType === "GROUP" ? "selected" : ""}>GROUP</option>
        </select>
        <input id="audit-subject-id" value="${escapeHtml(state.filters.auditSubjectId)}" placeholder="subject id (optional)" />
        <button class="btn" data-action="audit-refresh">Apply Filters</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Before/After Summary</th></tr>
          </thead>
          <tbody>
            ${state.audit
              .map(
                (item) => `<tr>
                  <td class="mono">${escapeHtml(toPrettyDate(item.createdAt))}</td>
                  <td>${escapeHtml(item.actor)}</td>
                  <td class="mono">${escapeHtml(item.action)}</td>
                  <td class="mono">${escapeHtml(item.subjectType)}:${escapeHtml(item.subjectId)}</td>
                  <td>${escapeHtml(summarizeAuditDiff(item))}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderJobs = () => {
    viewRoot.innerHTML = `
      <div class="tools-row">
        <select id="jobs-status">
          <option value="">All statuses</option>
          <option value="SCHEDULED" ${state.filters.reminderStatus === "SCHEDULED" ? "selected" : ""}>SCHEDULED</option>
          <option value="SENT" ${state.filters.reminderStatus === "SENT" ? "selected" : ""}>SENT</option>
          <option value="FAILED" ${state.filters.reminderStatus === "FAILED" ? "selected" : ""}>FAILED</option>
          <option value="CANCELED" ${state.filters.reminderStatus === "CANCELED" ? "selected" : ""}>CANCELED</option>
        </select>
        <button class="btn" data-action="jobs-refresh">Refresh</button>
      </div>
      ${
        state.reminders.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Reminder</th><th>Status</th><th>When</th><th>Target</th><th>Message</th><th>Actions</th></tr></thead>
                <tbody>
                  ${state.reminders
                    .map(
                      (item) => `<tr>
                        <td class="mono">${escapeHtml(item.publicId || item.id)}</td>
                        <td><span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
                        <td class="mono">${escapeHtml(toPrettyDate(item.remindAt))}</td>
                        <td class="mono">${escapeHtml(item.waGroupId || item.waUserId || "-")}</td>
                        <td>${escapeHtml(item.message)}</td>
                        <td>
                          ${
                            item.status === "FAILED"
                              ? `<button class="btn" data-action="reminder-retry" data-id="${escapeHtml(item.id)}">Retry</button>`
                              : '<span class="subtext">n/a</span>'
                          }
                        </td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : '<div class="state-card state-empty">No reminders/jobs found for current filters.</div>'
      }
    `;
  };

  const renderCurrentView = () => {
    if (state.view === "dashboard") return renderDashboard();
    if (state.view === "users") return renderUsers();
    if (state.view === "groups") return renderGroups();
    if (state.view === "bundles") return renderBundles();
    if (state.view === "capabilities") return renderCapabilities();
    if (state.view === "settings") return renderSettings();
    if (state.view === "licenses") return renderLicenses();
    if (state.view === "audit") return renderAudit();
    if (state.view === "jobs") return renderJobs();
    renderEmpty("Unknown view.");
  };

  const ensurePlans = async () => {
    if (state.plans.length) return;
    const response = await api.listPlans();
    state.plans = response.plans || [];
  };

  const ensureGovernanceCatalog = async () => {
    if (!state.governanceBundles.length) {
      const bundlesResponse = await api.listGovernanceBundles();
      state.governanceBundles = bundlesResponse.items || [];
    }

    if (!state.governanceCapabilities.length) {
      const capabilitiesResponse = await api.listGovernanceCapabilities();
      state.governanceCapabilities = capabilitiesResponse.items || [];
    }
  };

  const loadDashboard = async () => {
    const status = await api.getStatus();
    state.dashboard = status;

    try {
      state.metrics = await api.getMetrics();
    } catch (error) {
      state.metrics = {};
      showGlobalMessage(`Metrics unavailable: ${toFriendlyError(error)}`, "warn");
    }
  };

  const loadUsers = async () => {
    await ensurePlans();
    const response = await api.listUsers(state.session.tenantId);
    state.users = response.items || [];
  };

  const loadGroups = async () => {
    await ensurePlans();
    const response = await api.listGroups(state.session.tenantId);
    state.groups = response.items || [];
  };

  const loadBundles = async () => {
    await ensureGovernanceCatalog();
  };

  const loadCapabilities = async () => {
    await ensureGovernanceCatalog();
  };

  const loadSettings = async () => {
    const [settings, preSalesKnowledge, preSalesCatalog, preSalesFaq] = await Promise.all([
      api.getGovernanceSettings(),
      api.getPreSalesKnowledge(),
      api.getPreSalesCatalog(),
      api.getPreSalesFaq()
    ]);

    state.settings = settings;
    state.preSalesKnowledge = preSalesKnowledge?.item ?? preSalesKnowledge;
    state.preSalesCatalog = preSalesCatalog;
    state.preSalesFaq = preSalesFaq;
  };

  const loadLicenses = async () => {
    const response = await api.listPlans();
    state.plans = response.plans || [];
  };

  const loadAudit = async () => {
    const query = new URLSearchParams();
    query.set("limit", "200");
    if (state.filters.auditType) query.set("subjectType", state.filters.auditType);
    if (state.filters.auditSubjectId) query.set("subjectId", state.filters.auditSubjectId);

    const response = await api.listAudit(query.toString());
    state.audit = response.items || [];
  };

  const loadJobs = async () => {
    const query = new URLSearchParams();
    query.set("limit", "200");
    if (state.session.tenantId) query.set("tenantId", state.session.tenantId);
    if (state.filters.reminderStatus) query.set("status", state.filters.reminderStatus);

    const response = await api.listReminders(query.toString());
    state.reminders = response.items || [];
  };

  const refreshCurrentView = async () => {
    state.loading = true;
    renderLoading();

    try {
      if (state.view === "dashboard") await loadDashboard();
      else if (state.view === "users") await loadUsers();
      else if (state.view === "groups") await loadGroups();
      else if (state.view === "bundles") await loadBundles();
      else if (state.view === "capabilities") await loadCapabilities();
      else if (state.view === "settings") await loadSettings();
      else if (state.view === "licenses") await loadLicenses();
      else if (state.view === "audit") await loadAudit();
      else if (state.view === "jobs") await loadJobs();

      renderCurrentView();
    } catch (error) {
      renderError(error);
      if (error?.kind === "unauthorized") {
        showGlobalMessage("Token is missing or invalid. Update session and retry.", "error");
      }
    } finally {
      state.loading = false;
    }
  };

  const setView = async (nextView) => {
    if (!VIEW_IDS.includes(nextView)) return;
    state.view = nextView;
    state.details.user = null;
    state.details.group = null;
    state.details.bundleEditor = null;

    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === nextView);
    });

    await refreshCurrentView();
  };

  const handleTierUpdate = async (kind, id) => {
    const inputs = kind === "user" ? viewRoot.querySelectorAll("[data-tier-select-user]") : viewRoot.querySelectorAll("[data-tier-select-group]");
    const input = Array.from(inputs).find((node) =>
      kind === "user" ? node.dataset.tierSelectUser === id : node.dataset.tierSelectGroup === id
    );
    const tier = input?.value;
    if (!tier) return;

    if (kind === "user") {
      await api.updateUserTier(id, { tier, actor: state.session.actor, tenantId: state.session.tenantId || undefined });
    } else {
      await api.updateGroupTier(id, { tier, actor: state.session.actor, tenantId: state.session.tenantId || undefined });
    }

    showGlobalMessage(`${kind} tier updated to ${tier}.`, "info");
  };

  const handleTableAction = async (action, id, metadata = {}) => {
    try {
      if (
        action === "users-refresh" ||
        action === "groups-refresh" ||
        action === "audit-refresh" ||
        action === "jobs-refresh" ||
        action === "bundles-refresh" ||
        action === "capabilities-refresh" ||
        action === "settings-refresh"
      ) {
        if (action === "audit-refresh") {
          state.filters.auditType = String(viewRoot.querySelector("#audit-type")?.value || "");
          state.filters.auditSubjectId = String(viewRoot.querySelector("#audit-subject-id")?.value || "").trim();
        }
        if (action === "jobs-refresh") {
          state.filters.reminderStatus = String(viewRoot.querySelector("#jobs-status")?.value || "");
        }
        await refreshCurrentView();
        return;
      }

      if (action === "bundle-create") {
        const key = String(viewRoot.querySelector("#bundle-create-key")?.value || "").trim();
        const displayName = String(viewRoot.querySelector("#bundle-create-name")?.value || "").trim();
        const description = String(viewRoot.querySelector("#bundle-create-description")?.value || "").trim();
        const active = Boolean(viewRoot.querySelector("#bundle-create-active")?.checked);
        const capabilitiesRaw = String(viewRoot.querySelector("#bundle-create-capabilities")?.value || "");
        const capabilityKeys = parseCapabilityCsv(capabilitiesRaw);

        if (!key || !displayName) {
          showGlobalMessage("Bundle key and display name are required.", "warn");
          return;
        }

        await api.createGovernanceBundle({
          key,
          displayName,
          description: description || null,
          active,
          capabilityKeys,
          actor: state.session.actor
        });
        state.governanceBundles = [];
        state.governanceCapabilities = [];
        state.details.bundleEditor = null;
        await ensureGovernanceCatalog();
        renderBundles();
        showGlobalMessage(`Bundle ${key} created.`, "info");
        return;
      }

      if (action === "bundle-edit") {
        const bundleKey = metadata.bundle;
        if (!bundleKey) return;
        const bundle = state.governanceBundles.find((item) => item.key === bundleKey);
        if (!bundle) return;
        state.details.bundleEditor = {
          key: bundle.key,
          displayName: bundle.displayName || bundle.key,
          description: bundle.description || "",
          active: Boolean(bundle.active),
          capabilities: [...(bundle.capabilities || [])]
        };
        renderBundles();
        return;
      }

      if (action === "bundle-edit-cancel") {
        state.details.bundleEditor = null;
        renderBundles();
        return;
      }

      if (action === "bundle-save") {
        const bundleKey = metadata.bundle;
        if (!bundleKey) return;
        const displayName = String(viewRoot.querySelector("#bundle-edit-name")?.value || "").trim();
        const description = String(viewRoot.querySelector("#bundle-edit-description")?.value || "").trim();
        const active = Boolean(viewRoot.querySelector("#bundle-edit-active")?.checked);
        const capabilityKeys = parseCapabilityCsv(String(viewRoot.querySelector("#bundle-edit-capabilities")?.value || ""));

        if (!displayName) {
          showGlobalMessage("Bundle display name is required.", "warn");
          return;
        }

        await api.updateGovernanceBundle(bundleKey, {
          displayName,
          description: description || null,
          active,
          capabilityKeys,
          actor: state.session.actor
        });
        state.governanceBundles = [];
        state.governanceCapabilities = [];
        await ensureGovernanceCatalog();
        state.details.bundleEditor = state.governanceBundles.find((item) => item.key === bundleKey) || null;
        renderBundles();
        showGlobalMessage(`Bundle ${bundleKey} updated.`, "info");
        return;
      }

      if (!id) return;

      if (action === "user-approve") {
        await api.updateUserAccess(id, { status: "APPROVED", actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        showGlobalMessage(`User ${id} approved.`, "info");
      }

      if (action === "user-block") {
        await api.updateUserAccess(id, { status: "BLOCKED", actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        showGlobalMessage(`User ${id} blocked.`, "warn");
      }

      if (action === "group-approve") {
        await api.updateGroupAccess(id, { status: "APPROVED", actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        showGlobalMessage(`Group ${id} approved.`, "info");
      }

      if (action === "group-block") {
        await api.updateGroupAccess(id, { status: "BLOCKED", actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        showGlobalMessage(`Group ${id} blocked.`, "warn");
      }

      if (action === "user-tier") {
        await handleTierUpdate("user", id);
      }

      if (action === "group-tier") {
        await handleTierUpdate("group", id);
      }

      if (action === "user-bundle-add" || action === "user-bundle-remove") {
        const bundleKey = metadata.bundle;
        if (!bundleKey) return;
        if (action === "user-bundle-add") {
          await api.assignUserBundle(id, bundleKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
          showGlobalMessage(`Bundle ${bundleKey} assigned to user ${id}.`, "info");
        } else {
          await api.removeUserBundle(id, bundleKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
          showGlobalMessage(`Bundle ${bundleKey} removed from user ${id}.`, "warn");
        }
        const governance = await api.getUserEffectiveGovernance(id, state.session.tenantId);
        if (state.details.user?.item?.waUserId === id) {
          state.details.user.governance = governance;
          renderUsers();
          return;
        }
      }

      if (action === "group-bundle-add" || action === "group-bundle-remove") {
        const bundleKey = metadata.bundle;
        if (!bundleKey) return;
        if (action === "group-bundle-add") {
          await api.assignGroupBundle(id, bundleKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
          showGlobalMessage(`Bundle ${bundleKey} assigned to group ${id}.`, "info");
        } else {
          await api.removeGroupBundle(id, bundleKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
          showGlobalMessage(`Bundle ${bundleKey} removed from group ${id}.`, "warn");
        }
        const query = new URLSearchParams();
        if (state.session.tenantId) query.set("tenantId", state.session.tenantId);
        const governance = await api.getGroupEffectiveGovernance(id, query.toString());
        if (state.details.group?.item?.waGroupId === id) {
          state.details.group.governance = governance;
          renderGroups();
          return;
        }
      }

      if (action === "user-capability-apply") {
        const capabilityKey = metadata.capability;
        if (!capabilityKey) return;
        const selector = Array.from(viewRoot.querySelectorAll("[data-override-select-user]")).find(
          (node) => node.dataset.overrideSelectUser === `${id}::${capabilityKey}`
        );
        const mode = selector?.value || "inherit";
        if (mode === "inherit") {
          await api.clearUserCapabilityOverride(id, capabilityKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        } else {
          await api.setUserCapabilityOverride(id, capabilityKey, {
            mode,
            actor: state.session.actor,
            tenantId: state.session.tenantId || undefined
          });
        }
        const governance = await api.getUserEffectiveGovernance(id, state.session.tenantId);
        if (state.details.user?.item?.waUserId === id) {
          state.details.user.governance = governance;
          renderUsers();
          return;
        }
      }

      if (action === "group-capability-apply") {
        const capabilityKey = metadata.capability;
        if (!capabilityKey) return;
        const selector = Array.from(viewRoot.querySelectorAll("[data-override-select-group]")).find(
          (node) => node.dataset.overrideSelectGroup === `${id}::${capabilityKey}`
        );
        const mode = selector?.value || "inherit";
        if (mode === "inherit") {
          await api.clearGroupCapabilityOverride(id, capabilityKey, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        } else {
          await api.setGroupCapabilityOverride(id, capabilityKey, {
            mode,
            actor: state.session.actor,
            tenantId: state.session.tenantId || undefined
          });
        }
        const query = new URLSearchParams();
        if (state.session.tenantId) query.set("tenantId", state.session.tenantId);
        const governance = await api.getGroupEffectiveGovernance(id, query.toString());
        if (state.details.group?.item?.waGroupId === id) {
          state.details.group.governance = governance;
          renderGroups();
          return;
        }
      }

      if (action === "user-details") {
        const user = state.users.find((item) => item.waUserId === id);
        await ensureGovernanceCatalog();
        const [usage, governance] = await Promise.all([api.getUserUsage(id, state.session.tenantId), api.getUserEffectiveGovernance(id, state.session.tenantId)]);
        state.details.user = { item: user ?? null, usage, governance };
        renderUsers();
        return;
      }

      if (action === "group-details") {
        const group = state.groups.find((item) => item.waGroupId === id);
        await ensureGovernanceCatalog();
        const query = new URLSearchParams();
        if (state.session.tenantId) query.set("tenantId", state.session.tenantId);
        const [usage, governance] = await Promise.all([api.getGroupUsage(id, state.session.tenantId), api.getGroupEffectiveGovernance(id, query.toString())]);
        state.details.group = { item: group ?? null, usage, governance };
        renderGroups();
        return;
      }

      if (action === "reminder-retry") {
        await api.retryReminder(id, { actor: state.session.actor, tenantId: state.session.tenantId || undefined });
        showGlobalMessage(`Reminder ${id} moved back to SCHEDULED.`, "info");
      }

      await refreshCurrentView();
    } catch (error) {
      showGlobalMessage(toFriendlyError(error), "error");
      if (error?.kind === "unauthorized") {
        renderError(error);
      }
    }
  };

  const wireEvents = () => {
    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.addEventListener("click", () => {
        void setView(button.dataset.view);
      });
    });

    document.getElementById("save-config-btn")?.addEventListener("click", async () => {
      saveSession();
      setFeedback("Session saved.");
      await refreshCurrentView();
    });

    document.getElementById("test-connection-btn")?.addEventListener("click", async () => {
      saveSession();
      setFeedback("Testing connection...");
      try {
        await api.getStatus();
        setFeedback("Connection OK.");
        showGlobalMessage("Connection test succeeded.", "info");
      } catch (error) {
        setFeedback(toFriendlyError(error));
        showGlobalMessage(toFriendlyError(error), "error");
      }
    });

    document.getElementById("clear-config-btn")?.addEventListener("click", () => {
      clearSession();
      setFeedback("Session cleared.");
      showGlobalMessage("Session cleared. Configure token and API URL.", "warn");
    });

    viewRoot.addEventListener("input", (event) => {
      const target = event.target;
      if (!target || typeof target !== "object" || !("id" in target)) return;

      if (target.id === "users-search") {
        state.filters.usersSearch = target.value;
        renderUsers();
      }

      if (target.id === "groups-search") {
        state.filters.groupsSearch = target.value;
        renderGroups();
      }
    });

    viewRoot.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || typeof target !== "object" || !("dataset" in target)) return;
      const action = target.dataset.action;
      if (!action) return;
      const id = target.dataset.id;
      void handleTableAction(action, id, {
        bundle: target.dataset.bundle,
        capability: target.dataset.capability
      });
    });
  };

  const init = async () => {
    uiVersionBadge.textContent = `UI ${uiConfig.uiVersion || "1.9.2"}`;
    fillFormFromSession();
    renderSessionBadge();
    wireEvents();
    await refreshCurrentView();
  };

  return {
    init,
    setView,
    refreshCurrentView,
    getState: () => ({ ...state })
  };
};

const fetchUiConfig = async () => {
  try {
    const response = await fetch("/ui-config");
    if (!response.ok) {
      return {
        defaultAdminApiBaseUrl: DEFAULT_SETTINGS.apiBase,
        uiVersion: "1.9.2"
      };
    }
    return await response.json();
  } catch {
    return {
      defaultAdminApiBaseUrl: DEFAULT_SETTINGS.apiBase,
      uiVersion: "1.9.2"
    };
  }
};

const bootstrap = async () => {
  const uiConfig = await fetchUiConfig();
  const app = createAdminUiApp({
    document,
    fetchImpl: (...args) => fetch(...args),
    storage: window.localStorage,
    uiConfig
  });
  await app.init();
  window.__zappyAdminUiApp = app;
};

if (typeof window !== "undefined") {
  void bootstrap();
}
