# mcp-healthcheck

Programmatic health and liveness probe for MCP (Model Context Protocol) servers.

[![npm version](https://img.shields.io/npm/v/mcp-healthcheck.svg)](https://www.npmjs.com/package/mcp-healthcheck)
[![npm downloads](https://img.shields.io/npm/dt/mcp-healthcheck.svg)](https://www.npmjs.com/package/mcp-healthcheck)
[![license](https://img.shields.io/npm/l/mcp-healthcheck.svg)](https://github.com/SiluPanda/mcp-healthcheck/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/mcp-healthcheck.svg)](https://nodejs.org)

---

## Description

`mcp-healthcheck` connects to an MCP server over any supported transport (stdio, Streamable HTTP, or legacy SSE), performs the protocol handshake, enumerates the server's capabilities (tools, resources, prompts), measures latency for each operation, and returns a structured health report. It is designed to run headlessly in automated environments -- Kubernetes liveness/readiness probes, CI pipeline gates, monitoring dashboards -- where interactive debugging tools are not viable.

The package provides both a TypeScript/JavaScript API for programmatic use and a CLI for terminal and shell-script use. The API returns structured `HealthReport` objects with per-check status, latency, and error details. The CLI prints human-readable or JSON output and exits with conventional codes (0 for healthy, 1 for unhealthy, 2 for configuration errors, 3 for degraded).

The only runtime dependency is `@modelcontextprotocol/sdk`.

---

## Installation

```bash
npm install mcp-healthcheck @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency and must be installed alongside this package.

For CLI-only usage without installing locally:

```bash
npx mcp-healthcheck --stdio 'node ./server.js'
```

---

## Quick Start

### Programmatic (TypeScript)

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

console.log(report.status);  // 'healthy' | 'unhealthy' | 'degraded'
console.log(report.totalMs); // 342
console.log(report.checks);  // individual check results
```

### CLI

```bash
# stdio transport
mcp-healthcheck --stdio 'node ./server.js'

# Streamable HTTP transport
mcp-healthcheck --url https://mcp.example.com/mcp --header 'Authorization:Bearer sk-...'

# Legacy SSE transport
mcp-healthcheck --sse http://localhost:3000/sse

# JSON output for scripting
mcp-healthcheck --stdio 'node ./server.js' --format json

# Quiet mode (exit code only)
mcp-healthcheck --url http://localhost:3000/mcp --quiet
```

---

## Features

- **Three transport types** -- stdio (subprocess), Streamable HTTP, and legacy SSE.
- **Full MCP lifecycle verification** -- transport connectivity, protocol handshake, and capability enumeration (tools, resources, prompts).
- **Per-check latency measurement** -- high-resolution timing for every check using `performance.now()`.
- **Configurable thresholds** -- minimum/maximum tool count, minimum resource/prompt count, and maximum latency per check.
- **Custom checks** -- user-defined async functions that receive the connected MCP `Client` instance for domain-specific assertions.
- **Timeout enforcement** -- per-check timeout and overall timeout with automatic cleanup of remaining checks.
- **AbortSignal support** -- external cancellation via standard `AbortSignal` interface.
- **Auto-skip** -- checks for capabilities the server does not declare are automatically skipped with a passing result.
- **Structured health reports** -- machine-readable `HealthReport` objects with status, per-check results, summary counts, and server info.
- **HTTP handler factory** -- mount a health endpoint in Express, Koa, Fastify, or raw `http.createServer` with a single function call.
- **CLI with deterministic exit codes** -- 0 (healthy), 1 (unhealthy), 2 (config error), 3 (degraded).
- **Environment variable configuration** -- all CLI flags have environment variable equivalents for container and CI environments.
- **Subprocess cleanup** -- stdio transports are always terminated (SIGTERM, then SIGKILL after 5s) to prevent zombie processes.
- **Never throws** -- `checkHealth()` always returns a `HealthReport`, capturing all errors within the report structure.

---

## API Reference

### `checkHealth(options: HealthCheckOptions): Promise<HealthReport>`

The primary API. Connects to an MCP server, runs all health checks, and returns a structured report. This function never throws; all errors are captured in the returned report.

```typescript
import { checkHealth } from 'mcp-healthcheck';

const report = await checkHealth({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
});

if (report.status === 'healthy') {
  console.log(`${report.summary.passed}/${report.summary.total} checks passed in ${report.totalMs}ms.`);
} else {
  for (const check of report.checks.filter(c => !c.passed)) {
    console.error(`FAIL: ${check.name} -- ${check.error?.message}`);
  }
}
```

### `isHealthy(options: HealthCheckOptions): Promise<boolean>`

Convenience function that runs `checkHealth` and returns `true` only when the status is `'healthy'`. Returns `false` for both `'unhealthy'` and `'degraded'`.

```typescript
import { isHealthy } from 'mcp-healthcheck';

const healthy = await isHealthy({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
});

if (!healthy) {
  process.exit(1);
}
```

### `createHttpHandler(options: HealthCheckOptions): (req: IncomingMessage, res: ServerResponse) => void`

Creates an HTTP request handler that exposes a health check endpoint. Suitable for mounting in any Node.js HTTP framework or a raw `http.createServer`.

- **GET** request: runs `checkHealth(options)` and responds with `200 OK` (healthy or degraded) or `503 Service Unavailable` (unhealthy), with `Content-Type: application/json` and the `HealthReport` as the response body.
- **Any other method**: responds with `405 Method Not Allowed`.

```typescript
import http from 'node:http';
import { createHttpHandler } from 'mcp-healthcheck';

const handler = createHttpHandler({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  timeout: 10_000,
});

const server = http.createServer(handler);
server.listen(8080);
```

### Types

#### `HealthCheckOptions`

Main configuration object passed to `checkHealth`, `isHealthy`, and `createHttpHandler`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `transport` | `TransportConfig` | *required* | Transport configuration for connecting to the MCP server. |
| `timeout` | `number` | `30000` | Overall timeout in milliseconds for the entire health check. |
| `checkTimeout` | `number` | `10000` | Per-check timeout in milliseconds. |
| `skip` | `Array<'tools' \| 'resources' \| 'prompts'>` | `[]` | Checks to skip. `connect` and `initialize` cannot be skipped. |
| `thresholds` | `Thresholds` | `{}` | Threshold assertions for pass/fail evaluation. |
| `customChecks` | `Array<{ name: string; fn: CustomCheckFn; required?: boolean }>` | `[]` | Custom check functions to run after standard checks. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: 'mcp-healthcheck', version: '<pkg version>' }` | Client info sent in the MCP `initialize` request. |
| `signal` | `AbortSignal` | `undefined` | AbortSignal for external cancellation. |

#### `TransportConfig`

A discriminated union of three transport configurations:

**`StdioTransportConfig`**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `'stdio'` | -- | Transport discriminator. |
| `command` | `string` | *required* | Command to execute (e.g., `'node'`, `'python'`, `'npx'`). |
| `args` | `string[]` | `[]` | Arguments to pass to the command. |
| `env` | `Record<string, string>` | `process.env` | Environment variables for the subprocess. Merged with `process.env`. |
| `cwd` | `string` | `process.cwd()` | Working directory for the subprocess. |

**`HttpTransportConfig`**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `'http'` | -- | Transport discriminator. |
| `url` | `string` | *required* | URL of the MCP server's Streamable HTTP endpoint. |
| `headers` | `Record<string, string>` | `undefined` | Additional HTTP headers (e.g., authorization). |

**`SseTransportConfig`**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `'sse'` | -- | Transport discriminator. |
| `url` | `string` | *required* | URL of the SSE endpoint. |
| `headers` | `Record<string, string>` | `undefined` | Additional HTTP headers. |

#### `Thresholds`

| Property | Type | Description |
|----------|------|-------------|
| `maxLatencyMs` | `number` | Maximum allowed latency (ms) for any individual check. Exceeding this sets the overall status to `'degraded'`. |
| `minTools` | `number` | Minimum number of tools the server must expose. |
| `maxTools` | `number` | Maximum number of tools the server may expose. |
| `minResources` | `number` | Minimum number of resources the server must expose. |
| `minPrompts` | `number` | Minimum number of prompts the server must expose. |

#### `CustomCheckFn`

```typescript
type CustomCheckFn = (client: Client) => Promise<CustomCheckResult>;
```

A user-defined async function that receives the connected MCP `Client` instance and returns a `CustomCheckResult`.

#### `CustomCheckResult`

| Property | Type | Description |
|----------|------|-------------|
| `passed` | `boolean` | Whether the check passed. |
| `message` | `string` | Human-readable description of the result. |
| `details` | `Record<string, unknown>` | Optional arbitrary metadata to include in the report. |

#### `HealthReport`

The complete health report returned by `checkHealth`.

| Property | Type | Description |
|----------|------|-------------|
| `status` | `HealthStatus` | Overall health status: `'healthy'`, `'unhealthy'`, or `'degraded'`. |
| `totalMs` | `number` | Total wall-clock time for the entire health check (ms). |
| `timestamp` | `string` | ISO 8601 timestamp of when the health check was performed. |
| `checks` | `CheckResult[]` | Results for each individual check, in execution order. |
| `summary` | `{ total: number; passed: number; failed: number; skipped: number }` | Summary counts. |
| `server` | `{ name: string; version: string; protocolVersion: string }` | Server information, populated after a successful `initialize` check. |

#### `HealthStatus`

```typescript
type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';
```

- **`healthy`** -- all required checks passed and all thresholds met.
- **`unhealthy`** -- one or more required checks failed.
- **`degraded`** -- all required checks passed, but optional checks or latency thresholds failed.

#### `CheckResult`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Check name (e.g., `'connect'`, `'initialize'`, `'tools'`). |
| `passed` | `boolean` | Whether the check passed. |
| `durationMs` | `number` | Time in milliseconds this check took. |
| `message` | `string` | Human-readable result description. |
| `error` | `{ code: string; message: string; stack?: string }` | Error details if the check failed. Undefined on success. |
| `details` | `Record<string, unknown>` | Check-specific details (see below). |

**Specialized check result details:**

| Check | Details Shape |
|-------|--------------|
| `connect` | `{ transportType: 'stdio' \| 'http' \| 'sse' }` |
| `initialize` | `{ protocolVersion: string; serverName: string; serverVersion: string; capabilities: { tools?: boolean; resources?: boolean; prompts?: boolean; logging?: boolean } }` |
| `tools` | `{ toolCount: number; toolNames: string[] }` |
| `resources` | `{ resourceCount: number; resourceUris: string[] }` |
| `prompts` | `{ promptCount: number; promptNames: string[] }` |

---

## Configuration

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `30000` | Overall timeout for the entire health check (ms). |
| `checkTimeout` | `10000` | Per-check timeout (ms). |
| `skip` | `[]` | No checks skipped. |
| `thresholds` | `{}` | No threshold assertions. |
| `customChecks` | `[]` | No custom checks. |
| `clientInfo.name` | `'mcp-healthcheck'` | Client name sent in the `initialize` request. |
| `clientInfo.version` | Package version | Client version sent in the `initialize` request. |

### Check Sequence

Checks run in this fixed order. Each check depends on the previous required check succeeding.

| Order | Check | Can Skip? | Depends On | Verifies |
|-------|-------|-----------|------------|----------|
| 1 | `connect` | No | -- | Transport-level connectivity |
| 2 | `initialize` | No | `connect` | MCP protocol handshake |
| 3 | `tools` | Yes | `initialize` | `tools/list` succeeds, thresholds met |
| 4 | `resources` | Yes | `initialize` | `resources/list` succeeds, thresholds met |
| 5 | `prompts` | Yes | `initialize` | `prompts/list` succeeds, thresholds met |
| 6+ | Custom | N/A | `initialize` | User-defined logic |

If `connect` or `initialize` fails, all subsequent checks are skipped.

If the server does not declare a capability (e.g., `resources`), the corresponding check is automatically skipped with `passed: true`.

### Timeout Strategy

Timeouts are enforced at two levels:

- **Per-check timeout** (`checkTimeout`): each individual check is wrapped in a `Promise.race` with a timeout. If the check exceeds this, it fails with error code `CHECK_TIMEOUT`.
- **Overall timeout** (`timeout`): a master timer runs for the entire `checkHealth()` call. If it fires before all checks complete, remaining checks are skipped with error code `OVERALL_TIMEOUT`.

Both timeout levels use `AbortController` internally and compose with any caller-provided `signal`.

---

## Error Handling

`checkHealth()` never throws. All errors are captured within the returned `HealthReport`. Failed checks include an `error` object with a classification code, message, and optional stack trace.

### Error Codes

| Code | Source | Meaning |
|------|--------|---------|
| `TRANSPORT_ERROR` | Transport layer | Failed to establish transport connection (`ECONNREFUSED`, DNS failure, TLS error, subprocess crash). |
| `SPAWN_ERROR` | stdio transport | Failed to spawn subprocess (`ENOENT` command not found, `EACCES` permission denied). |
| `HANDSHAKE_ERROR` | MCP protocol | The `initialize` handshake failed (JSON-RPC error, version mismatch, malformed response). |
| `PROTOCOL_ERROR` | MCP protocol | A `tools/list`, `resources/list`, or `prompts/list` request returned a JSON-RPC error. |
| `CHECK_TIMEOUT` | Timeout system | An individual check exceeded `checkTimeout`. |
| `OVERALL_TIMEOUT` | Timeout system | The entire health check exceeded `timeout`; remaining checks were skipped. |
| `ABORTED` | External signal | The caller's `AbortSignal` was triggered. |
| `THRESHOLD_VIOLATION` | Threshold evaluation | A threshold assertion failed (e.g., tool count below `minTools`). |
| `CUSTOM_CHECK_ERROR` | Custom check | A custom check function threw an exception. |
| `UNKNOWN_ERROR` | Fallback | An unexpected error that does not match any known classification. |

### Dependency Failure Propagation

If a required check (`connect` or `initialize`) fails, all subsequent checks are skipped and recorded with a message indicating the prior failure. This provides a complete report structure even when early checks fail.

---

## Advanced Usage

### Custom Checks

Custom checks run after the standard checks and receive the connected MCP `Client` instance. Each check can be marked as `required` (failure makes status `'unhealthy'`) or optional (failure makes status `'degraded'`, which is the default).

```typescript
import { checkHealth } from 'mcp-healthcheck';

const report = await checkHealth({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  customChecks: [
    {
      name: 'has-search-tool',
      required: true,
      fn: async (client) => {
        const { tools } = await client.listTools();
        const hasSearch = tools.some(t => t.name === 'search');
        return {
          passed: hasSearch,
          message: hasSearch ? 'search tool is registered' : 'search tool is missing',
        };
      },
    },
  ],
});
```

Custom checks that throw an exception are treated as failures with error code `CUSTOM_CHECK_ERROR`. Both sync throws and rejected promises are handled.

### AbortSignal Cancellation

Pass an `AbortSignal` to cancel a health check externally:

```typescript
import { checkHealth } from 'mcp-healthcheck';

const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const report = await checkHealth({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  signal: controller.signal,
});
```

When aborted, the health check stops immediately and returns an unhealthy report with error code `ABORTED`.

### HTTP Transport with Thresholds

```typescript
import { checkHealth } from 'mcp-healthcheck';

const report = await checkHealth({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com/mcp',
    headers: { 'Authorization': 'Bearer sk-...' },
  },
  timeout: 15_000,
  checkTimeout: 5_000,
  thresholds: {
    maxLatencyMs: 2_000,
    minTools: 3,
  },
});
```

### HTTP Health Endpoint

Expose a health check as an HTTP endpoint in any Node.js application:

```typescript
import http from 'node:http';
import { createHttpHandler } from 'mcp-healthcheck';

const handler = createHttpHandler({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  timeout: 10_000,
});

const server = http.createServer(handler);
server.listen(8080);
// GET http://localhost:8080 -> 200 (healthy/degraded) or 503 (unhealthy)
```

### Kubernetes Liveness and Readiness Probes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  template:
    spec:
      containers:
        - name: mcp-server
          image: my-mcp-server:latest
          ports:
            - containerPort: 3000
        - name: healthcheck
          image: node:20-slim
          command: ['sleep', 'infinity']
          livenessProbe:
            exec:
              command:
                - mcp-healthcheck
                - '--url'
                - 'http://localhost:3000/mcp'
                - '--timeout'
                - '5000'
                - '--skip'
                - 'resources'
                - '--skip'
                - 'prompts'
                - '--quiet'
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 8
            failureThreshold: 3
          readinessProbe:
            exec:
              command:
                - mcp-healthcheck
                - '--url'
                - 'http://localhost:3000/mcp'
                - '--timeout'
                - '5000'
                - '--min-tools'
                - '5'
                - '--quiet'
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 8
            failureThreshold: 1
```

### CI Pipeline Gate

```yaml
- name: Wait for MCP server to be healthy
  run: |
    for i in $(seq 1 10); do
      npx mcp-healthcheck \
        --url http://localhost:3000/mcp \
        --timeout 5000 \
        --min-tools 3 \
        --format json \
        && exit 0
      echo "Attempt $i failed, retrying in 2s..."
      sleep 2
    done
    echo "MCP server failed to become healthy"
    exit 1
```

### Monitoring Dashboard Integration

```typescript
import { checkHealth } from 'mcp-healthcheck';

const servers = [
  { name: 'search-server', transport: { type: 'http' as const, url: 'https://search.internal/mcp' } },
  { name: 'db-server', transport: { type: 'http' as const, url: 'https://db.internal/mcp' } },
];

const results = await Promise.all(
  servers.map(async (s) => ({
    name: s.name,
    report: await checkHealth({ transport: s.transport, timeout: 10_000 }),
  })),
);

for (const { name, report } of results) {
  console.log(`${name}: ${report.status} (${report.totalMs}ms)`);
}
```

---

## CLI Reference

```
mcp-healthcheck [options]

Transport (exactly one required):
  --stdio <command>          Spawn an MCP server via stdio transport.
  --url <url>                Connect via Streamable HTTP transport.
  --sse <url>                Connect via legacy SSE transport.

Transport options:
  --header <key:value>       Add an HTTP header (repeatable). For --url and --sse only.
  --cwd <path>               Working directory for --stdio subprocess.
  --env <key=value>          Environment variable for --stdio subprocess (repeatable).

Check options:
  --timeout <ms>             Overall timeout in milliseconds. Default: 30000.
  --check-timeout <ms>       Per-check timeout in milliseconds. Default: 10000.
  --skip <check>             Skip a check (repeatable). Values: tools, resources, prompts.
  --min-tools <n>            Minimum expected tool count.
  --max-tools <n>            Maximum expected tool count.
  --min-resources <n>        Minimum expected resource count.
  --min-prompts <n>          Minimum expected prompt count.
  --max-latency <ms>         Maximum allowed latency per check.

Output options:
  --format <format>          Output format: human, json. Default: human.
  --quiet                    Suppress all output except the exit code.
  --verbose                  Show detailed check information.

Meta:
  --version                  Print version and exit.
  --help                     Print help and exit.
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Healthy. All checks passed, all thresholds met. |
| `1` | Unhealthy. One or more required checks failed. |
| `2` | Configuration error. Invalid flags, missing transport, or invalid transport config. |
| `3` | Degraded. All required checks passed, but optional thresholds or custom checks failed. |

### Environment Variables

All CLI flags can be set via environment variables. Explicit CLI flags override environment variables.

| Environment Variable | Equivalent Flag |
|---------------------|-----------------|
| `MCP_HEALTHCHECK_STDIO` | `--stdio` |
| `MCP_HEALTHCHECK_URL` | `--url` |
| `MCP_HEALTHCHECK_SSE` | `--sse` |
| `MCP_HEALTHCHECK_TIMEOUT` | `--timeout` |
| `MCP_HEALTHCHECK_CHECK_TIMEOUT` | `--check-timeout` |
| `MCP_HEALTHCHECK_FORMAT` | `--format` |
| `MCP_HEALTHCHECK_MIN_TOOLS` | `--min-tools` |
| `MCP_HEALTHCHECK_MAX_TOOLS` | `--max-tools` |
| `MCP_HEALTHCHECK_MIN_RESOURCES` | `--min-resources` |
| `MCP_HEALTHCHECK_MIN_PROMPTS` | `--min-prompts` |
| `MCP_HEALTHCHECK_MAX_LATENCY` | `--max-latency` |
| `MCP_HEALTHCHECK_SKIP` | `--skip` (comma-separated) |

### Human-Readable Output Example

```
$ mcp-healthcheck --stdio 'node ./server.js' --min-tools 2

  mcp-healthcheck v0.2.0

  Target: stdio -- node ./server.js
  Status: healthy

  PASS  connect         12ms   stdio transport connected
  PASS  initialize      45ms   protocol v2025-06-18, server: my-server v1.0.0
  PASS  tools           28ms   5 tools: search, create, update, delete, list
  PASS  resources       15ms   2 resources
  PASS  prompts          8ms   1 prompt

  Summary: 5/5 passed in 108ms
```

---

## TypeScript

This package is written in TypeScript and ships type declarations (`dist/index.d.ts`). All public types are exported from the main entry point:

```typescript
import {
  checkHealth,
  isHealthy,
  createHttpHandler,
  // Types
  type HealthCheckOptions,
  type HealthReport,
  type HealthStatus,
  type CheckResult,
  type ConnectCheckResult,
  type InitializeCheckResult,
  type ToolsCheckResult,
  type ResourcesCheckResult,
  type PromptsCheckResult,
  type CustomCheckCheckResult,
  type TransportConfig,
  type StdioTransportConfig,
  type HttpTransportConfig,
  type SseTransportConfig,
  type Thresholds,
  type CustomCheckFn,
  type CustomCheckResult,
} from 'mcp-healthcheck';
```

Requires TypeScript 5.0 or later. The package compiles to ES2022 with CommonJS modules.

---

## License

MIT
