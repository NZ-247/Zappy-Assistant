// Execute from the containment checkout. Synthetic ports, no persistent or external I/O.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const fromCheckout = path => import(pathToFileURL(resolve(path)));
const {AiService} = await fromCheckout("packages/ai/dist/index.js");
const {Orchestrator} = await fromCheckout("packages/core/dist/index.js");
for (const profile of ["member","creator_root","mother_privileged"]) {
  let reads=0, writes=0, requests=0;
  const read = async () => { reads++; return []; };
  const write = async () => { writes++; };
  const memory = {listRecentMemory:read,loadRecent:read,appendMemory:write,append:write};
  const llm = {chat:async ({messages,system})=>{
    requests++;
    assert.ok(system.includes("Zappy"));
    assert.ok(!/\d{8,}/.test(system));
    assert.deepEqual(messages,[{role:"user",content:"Diga a cor da nuvem sintética."}]);
    return "Branca.";
  }};
  for (const window of [0,10]) {
    const aiAssistant = new AiService({llm,memory,config:{enabled:true,memoryWindow:window}});
    const core = new Orchestrator({flagsRepository:{resolveFlags:async()=>({})},triggersRepository:{findActiveByScope:async()=>[]},
      messagesRepository:{getRecentMessages:read},conversationMemory:memory,aiAssistant,llm,llmMemoryMessages:window,
      identity:{getIdentity:async()=>({role: profile==="creator_root"?"ROOT":"MEMBER",relationshipProfile:profile})},
      consent:{getConsent:async()=>({status:"ACCEPTED",termsVersion:"2026-03"})},cooldown:{canFire:async()=>true},rateLimit:{allow:async()=>true},
      adminAccess:{isAdmin:async()=>true}});
    for(const conversationId of ["fixture",undefined]){
      await core.handleInboundMessage({tenantId:"fixture", waUserId:"fixture", isGroup:false, conversationId,
        waMessageId:"fixture-"+window+conversationId, timestamp:new Date(),text:"Diga a cor da nuvem sintética."});
    }
  }
  assert.deepEqual({reads,writes,requests},{reads:0,writes:0,requests:4});
  console.log(JSON.stringify({profile,reads,writes,requests,currentTurnAndPersona:true}));
}
