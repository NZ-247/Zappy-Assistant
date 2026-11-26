// Supply a disposable database pre-migrated with prisma migrate deploy. Never load a deploy .env.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Orchestrator } from "@zappy/core";
import { AiService } from "@zappy/ai";
import { createOllamaChatAdapter, persistInboundMessage, persistOutboundMessage, conversationMemoryRepository as memory,
  messagesRepository, ensureTenantContext, identityRepository, prisma } from "@zappy/adapters";
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/zappy_scope_test");
const db = new PrismaClient();
const tenant = async () => db.tenant.create({ data: { name: "scope-fixture-" + randomUUID() } });
const t = await tenant(), other = await tenant();
const phones = [1,2,3].map(() => String(BigInt("0x" + randomUUID().replaceAll("-","").slice(0,12))));
const jid = i => phones[i] + "@s.whatsapp.net";
const person = async (tenant, id) => (await ensureTenantContext({ defaultTenantName: tenant.name, waUserId: id, userName: "Nome sintético igual" })).user;
try {
  const entrants = await Promise.all(Array.from({length:8},()=>person(t,jid(0))));
  assert.equal(new Set(entrants.map(user=>user.id)).size,1);
  const a = entrants[0], b = await person(t,jid(1)), c = await person(other,jid(2));
  assert.notEqual(a.id,b.id);
  const group = await db.group.create({data:{tenantId:t.id,name:"synthetic",waGroupId:randomUUID()+"@g.us"}});
  const input = (u, wa=u.waUserId, g) => ({tenantId:u.tenantId, userId:u.id, waUserId:wa, groupId:g?.id, waGroupId:g?.waGroupId, text:"fixture", waMessageId:randomUUID()});
  const key = (u,conversationId,g) => ({conversationId,scope:{tenantId:u.tenantId, channel:"whatsapp",chatType:g?"group":"direct",ownerId:g?.id??u.id}});
  const first = await Promise.all(Array.from({length:12},()=>persistInboundMessage(input(a))));
  assert.equal(new Set(first.map(x=>x.conversationId)).size,1);
  const ka = key(a,first[0].conversationId);
  const kb = key(b,(await persistInboundMessage(input(b))).conversationId);
  const kc = key(c,(await persistInboundMessage(input(c))).conversationId);
  const kg = key(a,(await persistInboundMessage(input(a,a.waUserId,group))).conversationId,group);
  assert.equal((await persistInboundMessage(input(b,b.waUserId,group))).conversationId,kg.conversationId);
  assert.equal((await persistOutboundMessage(input(a))).conversationId,ka.conversationId);
  assert.equal(new Set([ka,kb,kc,kg].map(k=>k.conversationId)).size,4);
  await assert.rejects(persistInboundMessage({...input(a),tenantId:other.id}));
  const lid = phones[1]+"@lid";
  const lidUser = await person(t,lid);
  assert.notEqual(lidUser.id,b.id);
  const prior = key(lidUser,(await persistInboundMessage(input(lidUser))).conversationId);
  await memory.appendMemory({...prior, role:"user",content:"LEGIT_ALIAS"});
  await identityRepository.linkAlias({tenantId:t.id, phoneNumber:phones[0], lidJid:lid,actor:"fixture"});
  assert.equal((await persistInboundMessage(input(a,lid))).conversationId,ka.conversationId);
  assert.equal((await memory.loadRecent({...ka,limit:10}))[0].content,"LEGIT_ALIAS");

  // A stale inferred alias without a link audit must not open the primary owner's history.
  const stale = randomUUID()+"@lid";
  await db.user.update({where:{id:c.id},data:{lidJid:stale}});
  await assert.rejects(persistInboundMessage(input(c,stale)),/unverified_direct_alias/);

  const legacy = await db.conversation.create({data:{tenantId:t.id}});
  await db.conversationMemory.createMany({data:[a,b].map(u=>({tenantId:t.id,conversationId:legacy.id,role:"assistant",waUserId:u.waUserId,content:"LEGACY"}))});
  for (const k of [kb,kc,kg,{...ka,conversationId:legacy.id}]) {
    const wrong = {...k,conversationId:k.conversationId===legacy.id?legacy.id:ka.conversationId};
    assert.deepEqual(await memory.loadRecent({...wrong,limit:24}),[]);
    assert.deepEqual(await messagesRepository.getRecentMessages({...wrong,limit:24}),[]);
    await assert.rejects(memory.appendMemory({...wrong,role:"user",content:"intruder"}));
    await assert.rejects(memory.trimOldMemory({...wrong,keep:0}));
  }
  for (const [k,tag] of [[kb,"ONLY_B"],[kc,"OTHER_TENANT"],[kg,"GROUP_ONLY"]]) {
    await memory.appendMemory({...k,role:"user",content:tag});
  }
  const requests=[];
  const real = process.env.ISOLATION_OLLAMA_URL;
  const model = "qwen3:1.7b";
  const llm = createOllamaChatAdapter({baseUrl:real??"http://fixture.invalid",model,timeoutMs:20000},async (url,init)=>{
    assert.equal(url.pathname,"/api/chat");
    const {messages}=JSON.parse(init.body);
    assert.ok(!/\d{8,}/.test(messages[0].content));
    requests.push(messages.slice(1));
    return real ? fetch(url,init) : Response.json({message:{content:"Ok."},done:true});
  });
  const ai = new AiService({llm,memory,config:{enabled:true,memoryWindow:10}});
  const orchestrator = new Orchestrator({
    flagsRepository: { resolveFlags: async () => ({}) }, triggersRepository: { findActiveByScope: async () => [] },
    consent: { getConsent: async () => ({status:"ACCEPTED",termsVersion:"2026-03"}) },
    adminAccess: { isAdmin: async () => true }, rateLimit:{allow:async()=>true}, cooldown:{canFire:async()=>true},
    identity: { getIdentity: async () => ({permissionRole:"ROOT",relationshipProfile:"creator_root"}) },
    aiAssistant: ai, llm, messagesRepository, conversationMemory: memory
  });
  for(const [u,k,tag] of [[a,ka,"ONLY_A"],[b,kb,"ONLY_B"],[a,ka,"AGAIN_A"]]){
    const event = {...input(u),text:tag+" Responda apenas OK.",isGroup:false,timestamp:new Date()};
    const persisted = await persistInboundMessage(event);
    const replies = await orchestrator.handleInboundMessage({...event,conversationId:persisted.conversationId,conversationScope:k.scope});
    assert.equal(replies.filter(r=>r.kind==="reply_text").length,1);
    const stored = await memory.loadRecent({...k,limit:24});
    assert.ok(stored.some(row => row.role==="assistant" && row.metadataJson?.inboundWaMessageId===event.waMessageId),
      "Ollama must complete this turn before it is counted");
  }
  assert.equal(requests.length,3);
  assert.match(JSON.stringify(requests[2]),/ONLY_A/);
  assert.match(JSON.stringify(requests[2]),/LEGIT_ALIAS/);
  assert.doesNotMatch(JSON.stringify(requests[2]),/ONLY_B|OTHER_TENANT|GROUP_ONLY|LEGACY/);
  assert.doesNotMatch(JSON.stringify(requests[1]),/ONLY_A|LEGIT_ALIAS/);
  await Promise.all(Array.from({length:8},(_,i)=>memory.appendMemory({...ka,role:"user",content:"prune"+i,keepLatest:3})));
  assert.equal((await memory.loadRecent({...ka,limit:100})).length,3);
  assert.ok((await memory.loadRecent({...kb,limit:100})).length>0);
  assert.equal(await db.conversationMemory.count({where:{conversationId:legacy.id}}),2);
  console.log(JSON.stringify({database:"isolated",model,transport:real?"Ollama HTTP":"HTTP fixture",interleavedRequests:requests.length,
    concurrentIdentityResolutions:entrants.length, concurrentCreates:first.length,distinctScopes:4,foreignMarkers:0,legacyRowsIntact:2}));
} finally { await db.$disconnect(); await prisma.$disconnect(); }
