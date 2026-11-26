import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,"127.0.0.1");
assert.equal(url.pathname,"/zappy_scope_test");
const db = new PrismaClient();
const script = await readFile(new URL("./conversation-legacy-dry-run.sql",import.meta.url),"utf8");
const sql = script.slice(script.indexOf("WITH legacy"), script.lastIndexOf("ROLLBACK;")).trim();
const counts = async () => new Map((await db.$queryRawUnsafe(sql)).map(row=>[[row.kind,row.role,row.result].join("/"),Number(row.count)]));
try {
  const before = await counts();
  const t = await db.tenant.create({data:{name:randomUUID()}});
  const users = await Promise.all([1,2].map(()=>db.user.create({data:{tenantId:t.id,waUserId:randomUUID()+"@lid"}})));
  const c = await db.conversation.create({data:{tenantId:t.id}});
  const [a,b]=users;
  const common={tenantId:t.id,conversationId:c.id};
  const rows = [
    ...users.map(user=>({...common,userId:user.id,waUserId:user.waUserId,body:"fixture",direction:"INBOUND",waMessageId:user.id})),
    ...[a,b].map(recipient=>({...common,userId:a.id,waUserId:a.waUserId,body:"fixture reply",direction:"OUTBOUND",rawJson:{
      key:{remoteJid:recipient.waUserId},message:{extendedTextMessage:{contextInfo:{stanzaId:a.id}}}
    }}))
  ];
  await db.message.createMany({data:rows});
  await db.conversationMemory.createMany({data:[
    {...common,role:"user",waUserId:a.waUserId,content:"A"},
    ...[a.id,b.id,"missing"].map(turn=>({...common,role:"assistant",waUserId:a.waUserId,content:"reply",metadataJson:{inboundWaMessageId:turn}})),
    {...common,role:"assistant",waUserId:"unresolved",content:"orphan"}
  ]});
  const after=await counts();
  assert.deepEqual(after,await counts());
  for(const [key,delta] of Object.entries({
    "Message/INBOUND/attributable":2, "Message/OUTBOUND/attributable":1,"Message/OUTBOUND/no_verified_turn":1,
    "ConversationMemory/user/attributable":1,"ConversationMemory/assistant/attributable":1,
    "ConversationMemory/assistant/no_verified_turn":2,"ConversationMemory/assistant/ambiguous_owner":1
  })) assert.equal((after.get(key)??0)-(before.get(key)??0),delta,key);
  assert.equal(await db.conversationMemory.count({where:common}),5);
  console.log("Dry-run repeated twice. Correct classification for two interleaved owners, mismatched recipient, mismatched turn, missing turn and unresolved identity.");
} finally { await db.$disconnect(); }
