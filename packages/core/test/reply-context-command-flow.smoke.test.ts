import { strict as assert } from "node:assert";
import test from "node:test";
import { handleWebSearchCommand } from "../src/modules/web-search/presentation/commands/web-search-commands.js";

test("reply-context flow routes replied text into search command execution", async () => {
  let capturedQuery = "";

  const actions = await handleWebSearchCommand({
    commandKey: "search",
    cmd: "search",
    ctx: {
      event: {
        quotedWaMessageId: "msg-smoke-1",
        quotedText: "status docker compose"
      }
    } as any,
    deps: {
      search: {
        search: async (input) => {
          capturedQuery = input.query;
          return {
            provider: "duckduckgo",
            results: [
              {
                title: "Docker Compose Status",
                snippet: "Official docs",
                link: "https://docs.docker.com/compose/"
              }
            ]
          };
        }
      },
      config: {
        enabled: true,
        maxResults: 3
      }
    }
  });

  assert.equal(capturedQuery, "status docker compose");
  assert.equal(actions?.[0]?.kind, "reply_text");
});
