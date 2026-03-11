# Bot LID alias handling

WhatsApp groups may address the bot using either its phone-number JID (`556692207782@s.whatsapp.net`) or an anonymous LID identifier (`144251207811240@lid`). Native mentions and replies often carry the LID form, which previously was not part of our alias set and caused `mentionMatched=false` / `replyMatched=false`.

## What we capture
- **Self metadata (Baileys creds):** if `creds.me.lid` is present, we persist it on startup.
- **Replies to the bot:** when an inbound message quotes a message we sent (`quotedMessage.key.fromMe === true` or the quoted `waMessageId` exists as an OUTBOUND message), we learn the quoted participant if it is a `@lid`.

The learned LID is cached in Redis under `bot:self:lid:<botId>` (suffix uses the stripped bot JID) and kept in-memory; dev mode logs when a new alias is saved.

## Alias construction
`buildBotAliases` now returns:
- raw bot PN JID (with device if present)
- normalized PN JID (`@s.whatsapp.net`)
- stripped PN user part
- bot LID JID when known
- stripped LID user part

Mention and reply matching walk this full alias set, so both PN and LID forms trigger `mentionMatched`, `replyMatched`, and therefore `directedToBot` routing.

## Manual checks
1) Mention the bot in a group → `mentionMatched=true`, `directedToBot=true`.
2) Reply to a bot message → `replyMatched=true`, `directedToBot=true`.
3) Mention + natural-language reminder → routed to tool-intent/reminder.
4) Plain group chatter without mentions/replies → ignored (noop).
