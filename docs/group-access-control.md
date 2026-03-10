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
1. Allowed group + bot actually admin → `/chat off` succeeds.
2. Allowed group + bot not admin → `/chat off` fails with a clear admin-required message (from the actual operation result).
3. `/help` and `/groupinfo` do not hard-block or mislead when metadata says bot is not admin (stale/unknown paths are labeled).
4. `allowed_groups` gating still works.
5. Reply-to-origin still works for all replies.
