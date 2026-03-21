import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { TransportConfig } from './types.js';

export type AnyTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

export function createTransport(config: TransportConfig): AnyTransport {
  switch (config.type) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    case 'http':
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    case 'sse':
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown transport type: ${(_exhaustive as TransportConfig).type}`);
    }
  }
}

export async function createConnectedClient(
  config: TransportConfig,
  clientInfo: { name: string; version: string }
): Promise<{ client: Client; transport: AnyTransport; cleanup: () => Promise<void> }> {
  const client = new Client(clientInfo);
  const transport = createTransport(config);

  const cleanup = async (): Promise<void> => {
    try {
      await transport.close();
    } catch {
      // ignore cleanup errors
    }
  };

  return { client, transport, cleanup };
}
