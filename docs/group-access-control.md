# Group Scope, Admin Access & Reply Semantics

## Reply-to-origin
- All WhatsApp replies sent from gateway now include the quoted/original message when available.
- If quoting fails (e.g., missing message payload), gateway logs a debug note and falls back to plain send.
- Applies to commands, AI replies, moderation/hand-off, confirmations, and tool suggestions.

## Group scope & chat modes
- A group must be **allowed** and the bot must be **group admin** to operate.
- Per-group chat mode: `ON` (default) or `OFF`.
  - `chat=OFF`: only prefix commands and backend/system flows are processed; regular chat/AI is ignored.
  - `chat=ON`: AI/triggers in groups only run when the bot is mentioned (`@`) or the user replies to a bot message.
- Direct (1:1) chats are not affected.

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

## Manual test checklist
1. Group `chat=OFF`, plain non-command message → ignored.
2. Group `chat=ON`, non-mentioned plain message → ignored.
3. Group `chat=ON`, `@bot` mention → AI/command reply with quote.
4. Reply to a bot message in group → AI reply with quote.
5. Command reply is quoted to triggering message.
6. `/whoami` returns user + group state.
7. `/userinfo` works on mention/reply.
8. `/groupinfo` shows current group state (allowed/chat/admin).
9. Allowed_groups gating: disallowed group blocked until `/add gp allowed_groups` by admin.
10. Bot admin list commands add/remove/list correctly.
