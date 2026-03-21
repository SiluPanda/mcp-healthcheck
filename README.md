# mcp-healthcheck

Programmatic health and liveness probe for MCP (Model Context Protocol) servers. Connect over stdio, Streamable HTTP, or legacy SSE and get a structured health report back.

## Installation

```bash
npm install mcp-healthcheck
```

`@modelcontextprotocol/sdk` is a peer dependency — install it alongside this package:

```bash
npm install @modelcontextprotocol/sdk
```

## Quick Start

```typescript
import { checkHealth } from 'mcp-healthcheck';

const report = await checkHealth({
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['./my-mcp-server.js'],
  },
  timeout: 10_000,
});

console.log(report.status);   // 'healthy' | 'unhealthy' | 'degraded'
console.log(report.totalMs);  // total elapsed ms
console.log(report.checks);   // per-check results
```

## Transport Types

### stdio

Spawns an MCP server as a subprocess:

```typescript
await checkHealth({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'my-mcp-server'],
    env: { MY_VAR: 'value' },
    cwd: '/path/to/dir',
  },
});
```

### Streamable HTTP

Connects to a remote HTTP MCP endpoint:

```typescript
await checkHealth({
  transport: {
    type: 'http',
    url: 'http://localhost:3000/mcp',
    headers: { Authorization: 'Bearer token' },
  },
});
```

### Legacy SSE

Connects via the older SSE transport:

```typescript
await checkHealth({
  transport: {
    type: 'sse',
    url: 'http://localhost:3000/sse',
  },
});
```

## Options

```typescript
interface HealthCheckOptions {
  transport: TransportConfig;        // required: how to connect
  timeout?: number;                  // overall timeout ms (default: 30000)
  checkTimeout?: number;             // per-check timeout ms (default: 10000)
  skip?: ('tools' | 'resources' | 'prompts')[];  // checks to skip
  thresholds?: Thresholds;           // pass/fail thresholds
  customChecks?: CustomCheck[];      // user-defined checks
  clientInfo?: { name: string; version: string };  // client identity
}

interface Thresholds {
  maxLatencyMs?: number;   // fail if any check exceeds this latency
  minTools?: number;       // fail if server exposes fewer tools
  maxTools?: number;       // fail if server exposes more tools
  minResources?: number;   // fail if server exposes fewer resources
  minPrompts?: number;     // fail if server exposes fewer prompts
}
```

## HealthReport Shape

```typescript
interface HealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  totalMs: number;
  timestamp: string;  // ISO 8601
  checks: CheckResult[];
  summary: { total: number; passed: number; failed: number; skipped: number };
  server?: { name: string; version: string; protocolVersion: string };
}

interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  message: string;
  error?: { code: string; message: string };
  details?: Record<string, unknown>;
}
```

### Status semantics

- **healthy** — all checks passed
- **unhealthy** — connect or initialize failed
- **degraded** — connect and initialize passed, but one or more capability checks failed

## Custom Checks

Pass user-defined checks that receive the connected `Client` instance:

```typescript
await checkHealth({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  customChecks: [
    {
      name: 'my-tool-exists',
      fn: async (client) => {
        const { tools } = await client.listTools();
        const found = tools.some((t) => t.name === 'my-tool');
        return {
          passed: found,
          message: found ? 'my-tool is present' : 'my-tool not found',
        };
      },
    },
  ],
});
```

## `isHealthy` Convenience Function

Returns `true` iff the status is `'healthy'`:

```typescript
import { isHealthy } from 'mcp-healthcheck';

if (!(await isHealthy({ transport: { type: 'stdio', command: 'node', args: ['./server.js'] } }))) {
  console.error('MCP server is not healthy');
  process.exit(1);
}
```

## Checks Performed

| Check | Description |
|-------|-------------|
| `connect` | Opens the transport connection |
| `initialize` | Verifies the MCP handshake completed and extracts server info |
| `tools` | Calls `tools/list` and validates count thresholds |
| `resources` | Calls `resources/list` and validates count thresholds |
| `prompts` | Calls `prompts/list` and validates count thresholds |
| custom | User-supplied check functions |

## License

MIT
