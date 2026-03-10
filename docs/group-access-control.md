# Group Scope, Admin Access & Reply Semantics

## Reply-to-origin
- All WhatsApp replies sent from gateway now include the quoted/original message when available.
- If quoting fails (e.g., missing message payload), gateway logs a debug note and falls back to plain send.
- Applies to commands, AI replies, moderation/hand-off, confirmations, and tool suggestions.

## Group scope & chat modes
- Group traffic is **direction-first**: if a group message is not a command, mention, or reply-to-bot, it is ignored silently.
- A group must be **allowed**; bot admin is required only for commands flagged as needing group-admin power (e.g. `/chat on|off`, allowed-group commands). Warnings are never emitted for plain, non-command chatter.
- Per-group chat mode: `ON` (default) or `OFF`.
  - `chat=OFF`: only prefix commands and backend/system flows are processed; mentions/replies without commands are ignored.
  - `chat=ON`: AI/triggers in groups run only when the bot is mentioned (`@`) or the user replies to a bot message.
- Direct (1:1) chats are not affected.

## Bot admin status refresh
- On every inbound group message, the gateway refreshes bot admin status from live WhatsApp group metadata when stale or previously false.
- Group participant updates that involve the bot (`group-participants.update`) also trigger an immediate refresh.
- `Group.botIsAdmin` and `botAdminCheckedAt` are auto-repaired in the database when the live state says the bot is admin.
- If metadata fetch fails, a concise warning is logged and the previous known state is kept (no user-facing spam).

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

## Manual smoke tests
1. Bot is admin in group → no false “promova a admin” warning on normal traffic.
2. Plain non-directed group message → ignored silently (no admin warning).
3. `/help` in group → contextual status block (allowed/chat/admin/AI/requester) followed by command list.
4. Command that requires bot group-admin (e.g., `/chat on` in a non-admin group) → warning appears instead of proceeding.
5. Mention or reply-to-bot still triggers AI/commands as expected when chat=ON.
