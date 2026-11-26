BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- All output is aggregate. Never select message bodies, prompt text, display names or complete JSON.
WITH legacy AS (
 SELECT id, "tenantId", "groupId" FROM "Conversation" c WHERE to_jsonb(c)->>'channel' IS NULL
), owners AS (
 SELECT DISTINCT u."tenantId", u.id, j.jid,
 ((j.jid=u."waUserId" OR EXISTS (
 SELECT 1 FROM "AuditLog" a WHERE a.entity='User' AND a."entityId"=u.id AND a.action='UPDATE'
 AND a.metadata->>'action'='link_alias' AND a.metadata->>'lidJid'=u."lidJid" AND a.metadata->>'phoneNumber'=u."phoneNumber"
 )) AND NOT (u."waUserId" LIKE '%@lid' AND j.jid = replace(u."waUserId",'@lid','@s.whatsapp.net'))) proven
 FROM "User" u CROSS JOIN LATERAL unnest(ARRAY[u."waUserId", u."lidJid", u."pnJid"]) j(jid)
 WHERE j.jid IS NOT NULL
), unique_owner AS (
 SELECT "tenantId",jid,min(id) id FROM owners GROUP BY 1,2 HAVING count(*)=1 AND bool_and(proven)
), messages AS (
 SELECT m.id, m.direction::text role, m."tenantId", m."conversationId", m."waMessageId",
 m."rawJson"#>>'{key,remoteJid}' destination,
 coalesce(m."rawJson"#>>'{message,extendedTextMessage,contextInfo,stanzaId}',
          m."rawJson"#>>'{message,imageMessage,contextInfo,stanzaId}') turn,
 CASE WHEN m."tenantId"=c."tenantId" AND m."waGroupId" IS NOT NULL AND g."waGroupId"=m."waGroupId" THEN g.id
 WHEN m."tenantId"=c."tenantId" AND c."groupId" IS NULL AND m."waGroupId" IS NULL
 AND m."userId"=u.id THEN u.id END owner
 FROM "Message" m JOIN legacy c ON c.id=m."conversationId"
 LEFT JOIN unique_owner u ON u."tenantId"=m."tenantId" AND u.jid=m."waUserId"
 LEFT JOIN "Group" g ON g.id=c."groupId" AND g."tenantId"=c."tenantId"
), turns AS (
 SELECT "tenantId","conversationId","waMessageId", min(owner) owner FROM messages
 WHERE role='INBOUND' AND "waMessageId" IS NOT NULL GROUP BY 1,2,3 HAVING count(*)=1 AND count(owner)=1
), memories AS (
 SELECT m.role::text role, m."tenantId",m."conversationId",m."metadataJson"->>'inboundWaMessageId' turn,
 CASE WHEN c."tenantId"=m."tenantId" AND g.id IS NOT NULL THEN g.id
 WHEN c."tenantId"=m."tenantId" AND c."groupId" IS NULL THEN u.id END owner
 FROM "ConversationMemory" m JOIN legacy c ON c.id=m."conversationId"
 LEFT JOIN unique_owner u ON u."tenantId"=m."tenantId" AND u.jid=m."waUserId"
 LEFT JOIN "Group" g ON g.id=c."groupId" AND g."tenantId"=c."tenantId"
), classified AS (
 SELECT 'Message' kind,m.role,CASE WHEN m.owner IS NULL THEN 'ambiguous_owner'
 WHEN m.role='INBOUND' OR (t.owner=m.owner AND EXISTS (
 SELECT 1 FROM unique_owner u WHERE u."tenantId"=m."tenantId" AND u.id=m.owner AND u.jid=m.destination
 UNION ALL SELECT 1 FROM "Group" g WHERE g."tenantId"=m."tenantId" AND g.id=m.owner AND g."waGroupId"=m.destination
 )) THEN 'attributable' ELSE 'no_verified_turn' END result
 FROM messages m LEFT JOIN turns t ON (t."tenantId",t."conversationId",t."waMessageId")=(m."tenantId",m."conversationId",m.turn)
 UNION ALL
 SELECT 'ConversationMemory',m.role,CASE WHEN m.owner IS NULL THEN 'ambiguous_owner'
 WHEN (m.role='user' AND EXISTS (SELECT 1 FROM messages i WHERE i.role='INBOUND' AND
 (i."tenantId",i."conversationId",i.owner)=(m."tenantId",m."conversationId",m.owner))) OR (m.role='assistant' AND t.owner=m.owner) THEN 'attributable' ELSE 'no_verified_turn' END
 FROM memories m LEFT JOIN turns t ON (t."tenantId",t."conversationId",t."waMessageId")=(m."tenantId",m."conversationId",m.turn)
)
SELECT kind,role,result,count(*) FROM classified GROUP BY 1,2,3 ORDER BY 1,2,3;
ROLLBACK;
