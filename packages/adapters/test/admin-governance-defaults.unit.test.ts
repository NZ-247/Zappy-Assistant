import { strict as assert } from "node:assert";
import test from "node:test";
import { createAdminGovernanceRepository } from "../src/admin/repository.js";

const buildFakePrisma = () => {
  const tenants = new Map<string, { id: string; name: string }>();
  const users = new Map<string, any>();
  const groups = new Map<string, any>();
  const userAccess = new Map<string, any>();
  const groupAccess = new Map<string, any>();

  const now = new Date("2026-04-16T10:00:00.000Z");
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const keyForUserAccess = (tenantId: string, waUserId: string) => `${tenantId}:${waUserId}`;
  const keyForGroupAccess = (tenantId: string, waGroupId: string) => `${tenantId}:${waGroupId}`;

  return {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => tenants.get(where.id) ?? null,
      findFirst: async ({ where }: { where: { name: string } }) => {
        for (const row of tenants.values()) {
          if (row.name === where.name) return row;
        }
        return null;
      },
      create: async ({ data }: { data: { name: string } }) => {
        const row = { id: nextId("tenant"), name: data.name };
        tenants.set(row.id, row);
        return row;
      }
    },
    user: {
      findUnique: async ({ where }: { where: { waUserId: string } }) => users.get(where.waUserId) ?? null,
      create: async ({ data }: { data: any }) => {
        const row = {
          id: nextId("user"),
          tenantId: data.tenantId,
          waUserId: data.waUserId,
          phoneNumber: data.phoneNumber ?? null,
          displayName: data.displayName ?? data.waUserId,
          role: data.role ?? "member",
          permissionRole: null
        };
        users.set(row.waUserId, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const current = [...users.values()].find((item) => item.id === where.id);
        if (!current) throw new Error("user_not_found");
        const next = { ...current, ...data };
        users.set(next.waUserId, next);
        return next;
      }
    },
    group: {
      findUnique: async ({ where }: { where: { waGroupId: string } }) => groups.get(where.waGroupId) ?? null,
      create: async ({ data }: { data: any }) => {
        const row = {
          id: nextId("group"),
          tenantId: data.tenantId,
          waGroupId: data.waGroupId,
          name: data.name ?? data.waGroupId
        };
        groups.set(row.waGroupId, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const current = [...groups.values()].find((item) => item.id === where.id);
        if (!current) throw new Error("group_not_found");
        const next = { ...current, ...data };
        groups.set(next.waGroupId, next);
        return next;
      }
    },
    botAdmin: {
      findUnique: async () => null
    },
    userAccess: {
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const key = keyForUserAccess(where.tenantId_waUserId.tenantId, where.tenantId_waUserId.waUserId);
        const existing = userAccess.get(key);
        if (existing) {
          const next = { ...existing, ...update, updatedAt: now };
          userAccess.set(key, next);
          return next;
        }
        const row = {
          id: nextId("user-access"),
          ...create,
          approvedBy: create.approvedBy ?? null,
          approvedAt: create.approvedAt ?? null,
          createdAt: now,
          updatedAt: now
        };
        userAccess.set(key, row);
        return row;
      }
    },
    groupAccess: {
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const key = keyForGroupAccess(where.tenantId_waGroupId.tenantId, where.tenantId_waGroupId.waGroupId);
        const existing = groupAccess.get(key);
        if (existing) {
          const next = { ...existing, ...update, updatedAt: now };
          groupAccess.set(key, next);
          return next;
        }
        const row = {
          id: nextId("group-access"),
          ...create,
          approvedBy: create.approvedBy ?? null,
          approvedAt: create.approvedAt ?? null,
          createdAt: now,
          updatedAt: now
        };
        groupAccess.set(key, row);
        return row;
      }
    }
  };
};

test("first-seen private users materialize as APPROVED + FREE by default", async () => {
  const repository = createAdminGovernanceRepository({
    prisma: buildFakePrisma() as any
  });

  const user = await repository.getOrMaterializeUserAccess({
    waUserId: "u-private-default"
  });

  assert.equal(user.status, "APPROVED");
  assert.equal(user.tier, "FREE");
  assert.equal(user.approvedBy, "system:private-default");
  assert.ok(user.approvedAt instanceof Date);
});

test("group defaults remain independent and start as PENDING + FREE", async () => {
  const repository = createAdminGovernanceRepository({
    prisma: buildFakePrisma() as any
  });

  const group = await repository.getOrMaterializeGroupAccess({
    waGroupId: "g-group-default"
  });

  assert.equal(group.status, "PENDING");
  assert.equal(group.tier, "FREE");
});

test("governance settings expose pre-sales placeholders for future Services.NET knowledge hooks", async () => {
  const repository = createAdminGovernanceRepository({
    prisma: buildFakePrisma() as any
  });

  const settings = await repository.getGovernanceDefaults();

  assert.equal(settings.preSales.readiness, "placeholder_only");
  assert.equal(settings.preSales.serviceCatalog.schemaVersion, "services_net.service_catalog.v1");
  assert.equal(settings.preSales.serviceCatalog.entries, 0);
  assert.equal(settings.preSales.faq.schemaVersion, "services_net.faq.v1");
  assert.equal(settings.preSales.faq.entries, 0);
});
