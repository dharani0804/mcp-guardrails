# mcp-guardrails

Confirm-before-act guardrails for [Model Context Protocol](https://modelcontextprotocol.io) servers.

When an AI assistant can spend money or take actions that are hard to undo, "the model decided to" is not good enough. `mcp-guardrails` puts one rule in front of every risky tool call:

| The action is… | What happens |
|---|---|
| over the hard limit | **blocked**, even if the user says yes |
| under the auto-approve line | **approved** right away |
| in between, and the client supports [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) | the user gets a **confirm form** |
| in between, and the client doesn't | the tool returns **`needs_confirmation`** with a one-time token; the assistant asks out loud and calls again with the token |

Every decision goes into an **audit log**.

Tokens are single use, expire after 5 minutes by default, and are bound to the exact action (kind, amount and details), so a "yes" for $80 cleats can never approve a $1,500 TV.

## Install

```bash
npm install mcp-guardrails @modelcontextprotocol/sdk
```

## Use

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActionGuard } from "mcp-guardrails";

const server = new McpServer({ name: "shop", version: "1.0.0" });
// Amounts are in cents: auto-approve under $50, refuse over $2,000.
const purchases = new ActionGuard({ autoApproveBelow: 5_000, hardLimit: 200_000 });

server.registerTool(
  "buy",
  {
    inputSchema: {
      item: z.string(),
      cents: z.number().int(),
      confirmationToken: z.string().optional().describe("Only after the user agreed out loud"),
    },
  },
  async ({ item, cents, confirmationToken }) => {
    const outcome = await purchases.check(
      server.server,
      { kind: "purchase", amount: cents, summary: `Buy ${item}?`, details: { item } },
      confirmationToken,
    );
    if (outcome.status !== "approved") {
      const text = outcome.status === "needs_confirmation" ? outcome.prompt : `Not buying: ${outcome.status}`;
      return { content: [{ type: "text", text }], structuredContent: { ...outcome } };
    }
    // ...actually buy it here...
    return { content: [{ type: "text", text: `Bought ${item}.` }] };
  },
);
```

For actions that should **always** ask, like canceling a subscription, use `autoApproveBelow: 0`.

## Why it matters

Voice assistants such as Alexa+ and agent frameworks increasingly call MCP tools that act in the real world. The 2025-11-25 MCP spec added elicitation, but many clients don't support it yet. This library gives one consistent safety rule across both kinds of client, and keeps the policy, the token checks and the audit trail out of each tool's business logic.

It was extracted from [Household CFO](https://github.com/dharani0804/household-cfo), an Alexa+ MCP server that runs a family's budget by voice.

## Develop

```bash
npm install
npm test        # unit tests plus an end-to-end test with a real MCP server and client
npm run build
```

## License

MIT
