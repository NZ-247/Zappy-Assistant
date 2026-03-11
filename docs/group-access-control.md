# Group Scope, Admin Access & Reply Semantics

## Reply-to-origin
- All WhatsApp replies sent from gateway now include the quoted/original message when available.
- If quoting fails (e.g., missing message payload), gateway logs a debug note and falls back to plain send.
- Applies to commands, AI replies, moderation/hand-off, confirmations, and tool suggestions.

## Group scope & chat modes
- Group traffic is **direction-first**: if a group message is not a command, mention, or reply-to-bot, it is ignored silently.
- A group must be **allowed**; user permissions + command scope are the gates. Bot-admin metadata is **not** a hard gate anymore.
- Per-group chat mode: `ON` (default) or `OFF`.
  - `chat=OFF`: only prefix commands and backend/system flows are processed; mentions/replies without commands are ignored.
  - `chat=ON`: AI/triggers in groups run only when the bot is mentioned (`@`) or the user replies to a bot message.
- Direct (1:1) chats are not affected.

## Bot admin status (informational only)
- LID group metadata is unreliable; false negatives caused admin commands to be blocked. Pre-gating on `botIsAdmin=false` was removed.
- Admin-required actions now run **operation-first**: we try an actual admin-only Baileys call (e.g., `groupInviteCode`) and decide from the real result.
- Metadata is still fetched for context/diagnostics but no longer blocks execution; status is labeled as `verified yes`, `verified no`, or `unknown / not recently verified`.
- Participant updates (`group-participants.update`) still refresh status, but a failed/late metadata refresh no longer stops commands.

## Mention & reply detection
- Mentions come from `contextInfo.mentionedJid`; values are normalized (strip device suffix, normalize domain) and compared against bot aliases (raw, normalized, user-only).
- Reply-to-bot uses `contextInfo.participant` of the quoted message plus stanza id; same normalization and alias matching rules apply.
- Debug logs (dev only) include remoteJid, participant, mention arrays (raw/normalized), quoted ids, and bot aliases used for comparison.
- LID/PN variants are handled by comparing both full JIDs and user-only identifiers.

## Contextual /help
- In groups, `/help` starts with a status block: group name/id, allowed flag, bot admin flag, chat mode, AI status, requester role/profile, and any missing prerequisites.
- The command list is shown after the status block; direct chats keep the leaner help text but include requester context when relevant.

## Allowed groups commands
- `/add gp allowed_groups` (group, admin): allow current group.
- `/rm gp allowed_groups` (group, admin): remove current group.
- `/list gp allowed_groups` (admin): list all allowed groups with chat mode/admin flag.
- `/chat on|off` (group, admin): toggle group chat mode.

## Bot admin user list
- `/add user admins <mention|reply>`: promote user to bot admin (persists, also sets permissionRole=ADMIN when safe).
- `/rm user admins <mention|reply>`: remove user from admin list.
- `/list user admins`: list current admins.

## Identity helpers
- `/whoami`: current user info + group state (allowed/chat/admin) when in group.
- `/userinfo`: info about mentioned/replied user.
- `/groupinfo`: current group id/name, allowed status, chat mode, bot-admin flag.

## Common helpers (core)
- Located at `packages/core/src/common/bot-common.ts`.
- Functions: resolveTargetUserFromMentionOrReply, requireGroupContext, shouldRespondInGroupChat, shouldReplyToMessage, buildQuotedReplyOptions, resolveAllowedGroupAccess, resolveBotAdminAccess.

## Group chat routing (chat=ON)
- Plain group messages with no mention/reply are ignored quietly.
- Mention or reply-to-bot marks the message as directed: it is routed to AI/tool-intent; if it maps to an existing command/module the tool flow runs, otherwise persona-based AI answers.
- Command prefixes (`/`) continue to bypass mention/reply requirements.

## Manual smoke tests
1. Plain group text → ignored.
2. Explicit `@bot` mention via WhatsApp UI → bot replies.
3. Reply to a previous bot message → bot replies.
4. Mention + natural-language reminder request → routed to reminder/tool behavior.
5. Reply-to-bot + follow-up task request → routed correctly.
