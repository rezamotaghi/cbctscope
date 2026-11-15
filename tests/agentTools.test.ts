// The in-page agent offers its model exactly the MCP server's tools. The server is started
// over stdio the way a host starts it and asked for tools/list; the page's tool list
// (components/cbct/agent/tools.ts) must equal it name for name, description for
// description and input schema for input schema. Both come from lib/shared/verbs.mjs, so
// this fails if either side stops reading from it or converts a schema differently.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGE_TOOLS } from '../components/cbct/agent/tools';

const SERVER = path.join(process.cwd(), 'mcp', 'server.mjs');

describe('the page tool list equals the MCP server tool list', () => {
  let client: Client;
  let listed: { name: string; description?: string; inputSchema: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    client = new Client({ name: 'cbctscope-tools-test', version: '0' }, { versionNegotiation: { mode: 'legacy' } });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], stderr: 'pipe' }));
    listed = (await client.listTools()).tools as typeof listed;
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('lists the fifteen verbs in the same order', () => {
    expect(listed.length).toBe(15);
    expect(PAGE_TOOLS.map((t) => t.name)).toEqual(listed.map((t) => t.name));
  });

  it('carries the same descriptions', () => {
    expect(PAGE_TOOLS.map((t) => t.description)).toEqual(listed.map((t) => t.description));
  });

  it('carries the same input schemas', () => {
    for (const [i, t] of listed.entries()) {
      const { $schema: _ignored, ...schema } = t.inputSchema;
      void _ignored;
      expect(PAGE_TOOLS[i].parameters, `schema of ${t.name}`).toEqual(schema);
    }
  });
});
