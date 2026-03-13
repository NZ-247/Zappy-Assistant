# COMMAND_REGISTRY_BLUEPRINT.md

# Zappy Assistant — Command Registry Blueprint

This document defines the **official structure and behavior of the command registry system** used by Zappy Assistant.

The command registry is the **single source of truth** for all commands supported by the assistant.

It exists to ensure:

- consistent command discovery
- registry-driven help generation
- predictable command parsing
- centralized metadata
- safe extensibility when new modules are added

---

# 1. Architectural role

The command registry acts as the **command metadata authority**.

It must define:

- command names
- aliases
- usage
- description
- category
- required role
- scope
- bot admin requirement
- prefix compatibility

The registry **does not implement business logic**.

It only describes commands and enables:

- parsing
- routing
- help generation

Command execution must occur inside module command handlers.

---

# 2. Registry location

The registry lives in:

```
packages/core/src/commands/registry/
```

Expected structure:

```
commands/
registry/
command-types.ts
command-groups.ts
index.ts
```

---

# 3. CommandDefinition contract

Each command must follow a `CommandDefinition` structure.

Example interface:

```ts
interface CommandDefinition {
  name: string
  aliases?: string[]

  category: CommandCategory

  description: string
  usage: string
  examples?: string[]

  scope: CommandScope
  requiredRole?: CommandRole

  botAdminRequired?: boolean

  allowMention?: boolean
  allowReply?: boolean
}
```

# 4. Categories

Commands must belong to a category.

Categories should be human readable and stable.

Current categories:
```
Core
Identity
Groups
Reminders
Tasks
Notes
Moderation
Admin
System
```
Future categories may include:
```
Media
Search
Fun
Integrations
Automation
```

# 5. Command scope

Scope determines where commands are valid.

direct
group
both

Examples:

Command	Scope
/task add	direct
/mute	group
/help	both

# 6. Role requirements

Commands may require elevated permissions.

Possible roles:
```
USER
ADMIN
OWNER
PRIVILEGED
ROOT
```
Examples:
```
Command	Required Role
/help	USER
/add user admins	ADMIN
/alias link	ROOT
```

# 7. Bot admin requirement

Some commands require the bot itself to be a group admin.

Example:
```
/mute
/kick
/hidetag

If botAdminRequired = true:
```
The system must check:
```
Group.botIsAdmin
```
Before executing the command.

# 8. Registry assembly

Commands must be grouped by module.

Example:
```
export const taskCommands: CommandDefinition[] = [...]
export const noteCommands: CommandDefinition[] = [...]
export const groupCommands: CommandDefinition[] = [...]
```

The registry index merges them:
```
export const commandRegistry = [
  ...coreCommands,
  ...taskCommands,
  ...noteCommands,
  ...groupCommands
]
```

# 9. Prefix awareness

Commands must not hardcode the prefix.

The prefix comes from:

`BOT_PREFIX`

Defined in:

`.env`

Prefix helpers must be used when rendering usage strings.

Example:

`/task add`

Should be rendered dynamically:

`${prefix}task add`

# 10. Help generation

The help system must be generated from registry metadata.

The help renderer must:

 - group commands by category

 - filter by scope

 - filter by role

 - include usage examples

 - include admin/bot-admin indicators

Example output:
```
Tasks
/task add <title>
/task list
/task done <id>
```

# 11. Handling incomplete commands

If a command is recognized but arguments are missing:

Example:

`/task`

The system must respond with usage:

Usage:
```
/task add <title>
/task list
/task done <id>
```

Instead of falling into AI.

# 12. Aliases

Commands may include aliases.

Example:
```
/note
/notes
```
Both map to the same command handler.

Aliases must be declared in registry metadata.

# 13. Command execution flow
```
User message
      ↓
Command parser
      ↓
Registry lookup
      ↓
Command handler
      ↓
Module use case
      ↓
Response action
```

The registry never executes commands directly.

# 14. Rules when adding new commands

When adding a command:

 - Add metadata to registry

 - Add handler in module presentation layer

 - Add use-case in module application layer

 - Update help automatically via registry

Never:

 - implement command logic inside registry

 - bypass registry

 - hardcode help text

# 15. Future evolution

Future improvements may include:

 - command auto-completion

 - dynamic capability discovery

 - admin UI command reference

 - permission visualizer

 - API-driven command discovery

The registry structure must remain compatible with those future features.