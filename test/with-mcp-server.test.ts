import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ActionGuard } from "../src/index.js";

/** A tiny real MCP server with one guarded tool, the way the README shows it. */
async function connect() {
  const guard = new ActionGuard({ autoApproveBelow: 5_000, hardLimit: 200_000 });
  const server = new McpServer({ name: "shop", version: "1.0.0" });
  const bought: string[] = [];

  server.registerTool(
    "buy",
    { inputSchema: { item: z.string(), cents: z.number().int(), confirmationToken: z.string().optional() } },
    async ({ item, cents, confirmationToken }) => {
      const outcome = await guard.check(server.server, { kind: "purchase", amount: cents, summary: `Buy ${item}?`, details: { item } }, confirmationToken);
      if (outcome.status === "approved") bought.push(item);
      return { content: [{ type: "text", text: outcome.status }], structuredContent: { ...outcome } };
    },
  );

  const client = new Client({ name: "test", version: "1.0.0" }); // no elicitation support
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, guard, bought };
}

describe("ActionGuard inside a real MCP server", () => {
  it("asks for confirmation with a token, then completes the purchase", async () => {
    const { client, guard, bought } = await connect();

    const first = await client.callTool({ name: "buy", arguments: { item: "cleats", cents: 8_000 } });
    expect(first.structuredContent).toMatchObject({ status: "needs_confirmation" });
    expect(bought).toEqual([]);

    const token = (first.structuredContent as { confirmationToken: string }).confirmationToken;
    const second = await client.callTool({ name: "buy", arguments: { item: "cleats", cents: 8_000, confirmationToken: token } });
    expect(second.structuredContent).toEqual({ status: "approved", via: "token" });
    expect(bought).toEqual(["cleats"]);
    expect(guard.auditLog.map((e) => e.outcome)).toEqual(["needs_confirmation", "approved"]);
  });

  it("won't let a token approve a different purchase", async () => {
    const { client, bought } = await connect();
    const first = await client.callTool({ name: "buy", arguments: { item: "cleats", cents: 8_000 } });
    const token = (first.structuredContent as { confirmationToken: string }).confirmationToken;

    const swapped = await client.callTool({ name: "buy", arguments: { item: "tv", cents: 150_000, confirmationToken: token } });
    expect(swapped.structuredContent).toMatchObject({ status: "needs_confirmation" });
    expect(bought).toEqual([]);
  });
});
