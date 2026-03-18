# mcp-healthcheck — Specification

## 1. Overview

`mcp-healthcheck` is a programmatic health and liveness probe library for MCP (Model Context Protocol) servers. It connects to an MCP server over any supported transport (stdio, Streamable HTTP, or legacy SSE), performs the protocol handshake, enumerates the server's capabilities (tools, resources, prompts), measures latency for each operation, and returns a structured health report. It is designed to run headlessly in automated environments where interactive debugging tools are not viable.

The gap this package fills is specific and well-defined. The official MCP Inspector (`@modelcontextprotocol/inspector`) is a browser-based React application paired with a Node.js proxy, designed for interactive debugging during development. It requires a human operator to click through a UI, inspect responses, and visually verify behavior. Nothing in the MCP ecosystem provides a non-interactive, scriptable health check that can answer the question "is this MCP server healthy?" with a machine-readable result and a deterministic exit code. DevOps engineers deploying MCP servers behind Kubernetes, CI pipelines gating on server readiness, and monitoring dashboards tracking fleet health all need exactly this capability.

`mcp-healthcheck` provides both a TypeScript/JavaScript API for programmatic use and a CLI for terminal and shell-script use. The API returns structured `HealthReport` objects with per-check status, latency, and error details. The CLI prints human-readable or JSON output and exits with conventional codes (0 for healthy, 1 for unhealthy, 2 for configuration/usage errors). Both interfaces support configurable timeouts, selective check skipping, custom user-defined checks, and threshold-based pass/fail for latency and tool counts.

---

## 2. Goals and Non-Goals

### Goals

- Provide a single function (`checkHealth`) that connects to an MCP server and returns a comprehensive health report.
- Support all MCP transport types: stdio (spawn a subprocess), Streamable HTTP (connect to a URL), and legacy SSE (connect to an older HTTP+SSE endpoint).
- Verify the full MCP lifecycle: transport connectivity, protocol handshake (`initialize` / `initialized`), capability enumeration (`tools/list`, `resources/list`, `prompts/list`), and optional custom checks.
- Measure and report round-trip latency for each individual check.
- Provide a CLI (`mcp-healthcheck`) with JSON and human-readable output, deterministic exit codes, and environment variable configuration for CI/Kubernetes integration.
- Support threshold-based assertions: minimum/maximum tool count, maximum latency per check, and required capability presence.
- Allow user-defined custom check functions that receive the connected MCP `Client` instance.
- Clean up resources reliably: always close the MCP client connection and terminate spawned subprocesses, even on timeout or error.
- Keep dependencies minimal: depend only on `@modelcontextprotocol/sdk` and its transitive dependencies.

### Non-Goals

- **Not an interactive debugger.** This package does not provide a UI, REPL, or interactive exploration mode. Use the MCP Inspector for that.
- **Not a tool invocation tester.** This package verifies that `tools/list` succeeds and returns the expected shape; it does not call `tools/call` on individual tools. Testing tool execution requires domain-specific arguments and expected outputs, which belongs in integration test suites, not health checks.
- **Not a continuous monitoring daemon.** This package performs a single point-in-time health check and returns. For continuous monitoring, wrap it in a cron job, Kubernetes probe, or a monitoring agent that invokes it periodically.
- **Not a load tester.** This package makes one connection and one request per check type. It does not simulate concurrent clients or measure throughput.
- **Not a protocol conformance validator.** This package checks that a server responds to standard MCP requests. It does not validate that responses conform to the full protocol specification (schema correctness, required fields, etc.). Use `mcp-schema-lint` for protocol conformance.

---

## 3. Target Users

### DevOps / Platform Engineers

Deploying MCP servers in Kubernetes clusters and need liveness and readiness probes that speak the MCP protocol rather than just checking TCP port availability.

### CI/CD Pipeline Operators

Running integration test suites that depend on MCP servers and need a gate step that verifies the server started correctly, registered the expected tools, and responds within acceptable latency before tests begin.

### Monitoring / Observability Teams

Building dashboards that track the health of a fleet of MCP servers, collecting tool counts, latency metrics, and error rates over time.

### MCP Server Developers

Verifying during development that their server starts cleanly, completes the handshake, and exposes the expected capabilities, without needing to open the Inspector UI every time.

### AI Application Developers

Building MCP host applications that connect to multiple MCP servers and need to verify server health before routing tool calls, enabling graceful degradation when a server is unhealthy.

---

## 4. Core Concepts

### MCP (Model Context Protocol)

MCP is Anthropic's open protocol for connecting AI models to external tools and data sources. It defines a client-server architecture where an MCP host (like Claude Desktop or an AI application) creates MCP client instances that connect to MCP servers. Servers expose capabilities that the AI model can use: tools (executable functions), resources (readable data), and prompts (reusable interaction templates).

### Transports

MCP supports multiple transport mechanisms for client-server communication:

- **stdio**: The client spawns the MCP server as a child process and communicates via stdin/stdout. Messages are newline-delimited JSON-RPC. This is the most common transport for local MCP servers.
- **Streamable HTTP**: The client sends JSON-RPC requests as HTTP POST to a server URL. The server may respond with a single JSON response or open an SSE stream. Supports session management via `Mcp-Session-Id` headers. This is the standard transport for remote MCP servers.
- **SSE (legacy)**: The deprecated HTTP+SSE transport from MCP protocol version 2024-11-05. The client opens an SSE connection to receive an endpoint URL, then sends JSON-RPC via POST to that endpoint. Retained for backward compatibility.

### Protocol Lifecycle

Every MCP session follows a three-phase lifecycle:

1. **Initialization**: The client sends an `initialize` request containing its `protocolVersion`, `capabilities`, and `clientInfo`. The server responds with its own `protocolVersion`, `capabilities`, and `serverInfo`. The client then sends a `notifications/initialized` notification to complete the handshake.
2. **Operation**: The client can now call `tools/list`, `resources/list`, `prompts/list`, `tools/call`, `resources/read`, `prompts/get`, and other operations.
3. **Shutdown**: The client closes the transport connection. For stdio, this means closing stdin and terminating the subprocess. For HTTP transports, this means sending an HTTP DELETE with the session ID (if applicable) and closing any open SSE streams.

### Tools, Resources, and Prompts

- **Tools**: Executable functions with a `name`, `description`, `inputSchema` (JSON Schema), and optional `outputSchema`. Enumerated via `tools/list`.
- **Resources**: Data sources identified by URI with a `name`, `description`, and `mimeType`. Enumerated via `resources/list`. Read via `resources/read`.
- **Prompts**: Reusable interaction templates with a `name`, `description`, and `arguments` array. Enumerated via `prompts/list`. Retrieved via `prompts/get`.

### Health Semantics

A health check answers a binary question: is this MCP server healthy? The answer is derived from a series of individual checks, each of which produces a `pass` or `fail` result:

- **Healthy**: All required checks passed. The server is connected, completed the handshake, and responded to enumeration requests within acceptable latency. Tool/resource/prompt counts meet configured thresholds.
- **Unhealthy**: One or more required checks failed. The report includes which checks failed, what error occurred, and how long each check took.
- **Degraded** (optional): All required checks passed, but one or more optional checks (like custom checks or latency thresholds) failed. The server is functional but not performing optimally.

---

## 5. API Design

### Installation

```bash
npm install mcp-healthcheck
```

### Peer Dependency

```json
{
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

### Main Export: `checkHealth`

The primary API is a single async function that takes a configuration object and returns a health report.

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

console.log(report.status);    // 'healthy' | 'unhealthy' | 'degraded'
console.log(report.totalMs);   // 342
console.log(report.checks);    // individual check results
```

### Type Definitions

```typescript
// ── Transport Configuration ──────────────────────────────────────────

/** Configuration for spawning an MCP server as a subprocess via stdio. */
interface StdioTransportConfig {
  type: 'stdio';

  /** The command to execute (e.g., 'node', 'python', 'npx'). */
  command: string;

  /** Arguments to pass to the command (e.g., ['./server.js']). */
  args?: string[];

  /** Environment variables to set for the subprocess. Merged with process.env. */
  env?: Record<string, string>;

  /** Working directory for the subprocess. Defaults to process.cwd(). */
  cwd?: string;
}

/** Configuration for connecting to an MCP server via Streamable HTTP. */
interface HttpTransportConfig {
  type: 'http';

  /** The URL of the MCP server's HTTP endpoint (e.g., 'http://localhost:3000/mcp'). */
  url: string;

  /** Additional HTTP headers to include in requests (e.g., authorization). */
  headers?: Record<string, string>;
}

/** Configuration for connecting to an MCP server via legacy SSE transport. */
interface SseTransportConfig {
  type: 'sse';

  /** The base URL of the SSE endpoint (e.g., 'http://localhost:3000/sse'). */
  url: string;

  /** Additional HTTP headers to include in requests. */
  headers?: Record<string, string>;
}

type TransportConfig = StdioTransportConfig | HttpTransportConfig | SseTransportConfig;

// ── Check Configuration ──────────────────────────────────────────────

/** A user-defined custom check function. */
type CustomCheckFn = (client: import('@modelcontextprotocol/sdk/client/index.js').Client) => Promise<CustomCheckResult>;

interface CustomCheckResult {
  /** Whether the check passed. */
  passed: boolean;

  /** Human-readable description of the check result. */
  message: string;

  /** Arbitrary metadata to include in the report. */
  details?: Record<string, unknown>;
}

/** Thresholds for pass/fail assertions on the health check results. */
interface Thresholds {
  /** Maximum allowed latency in milliseconds for any individual check.
   *  If any check exceeds this, the overall status becomes 'degraded'. */
  maxLatencyMs?: number;

  /** Minimum number of tools the server must expose.
   *  If tools/list returns fewer, the tools check fails. */
  minTools?: number;

  /** Maximum number of tools the server may expose.
   *  If tools/list returns more, the tools check fails. */
  maxTools?: number;

  /** Minimum number of resources the server must expose. */
  minResources?: number;

  /** Minimum number of prompts the server must expose. */
  minPrompts?: number;
}

// ── Main Options ─────────────────────────────────────────────────────

interface HealthCheckOptions {
  /** Transport configuration for connecting to the MCP server. Required. */
  transport: TransportConfig;

  /**
   * Overall timeout in milliseconds for the entire health check.
   * If the total check time exceeds this, remaining checks are skipped
   * and the report is marked unhealthy with a timeout error.
   * Default: 30_000 (30 seconds).
   */
  timeout?: number;

  /**
   * Per-check timeout in milliseconds.
   * Applied individually to each check (connect, initialize, listTools, etc.).
   * Default: 10_000 (10 seconds).
   */
  checkTimeout?: number;

  /**
   * Checks to skip. Valid values: 'tools', 'resources', 'prompts'.
   * The 'connect' and 'initialize' checks cannot be skipped.
   * Default: [] (no checks skipped).
   */
  skip?: Array<'tools' | 'resources' | 'prompts'>;

  /**
   * Threshold assertions for pass/fail evaluation.
   * Default: {} (no thresholds enforced).
   */
  thresholds?: Thresholds;

  /**
   * Custom check functions to run after the standard checks.
   * Each receives the connected and initialized MCP Client instance.
   * Default: [] (no custom checks).
   */
  customChecks?: Array<{
    /** A unique name for this check, used in the report. */
    name: string;

    /** The check function. */
    fn: CustomCheckFn;

    /**
     * Whether this check is required for the server to be considered healthy.
     * If false, a failure marks the status as 'degraded' instead of 'unhealthy'.
     * Default: false.
     */
    required?: boolean;
  }>;

  /**
   * Client info to send in the initialize request.
   * Default: { name: 'mcp-healthcheck', version: '<package version>' }.
   */
  clientInfo?: {
    name: string;
    version: string;
  };

  /**
   * AbortSignal for external cancellation.
   * When aborted, the health check stops immediately and returns
   * an unhealthy report with an 'aborted' error.
   */
  signal?: AbortSignal;
}

// ── Health Report ────────────────────────────────────────────────────

/** Overall health status. */
type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

/** Result of a single check. */
interface CheckResult {
  /** Name of the check (e.g., 'connect', 'initialize', 'tools', 'resources', 'prompts'). */
  name: string;

  /** Whether this check passed. */
  passed: boolean;

  /** Time in milliseconds this check took. */
  durationMs: number;

  /** Human-readable description of the result. */
  message: string;

  /** Error details if the check failed. Undefined on success. */
  error?: {
    /** Error classification code. */
    code: string;

    /** Human-readable error message. */
    message: string;

    /** Original error stack trace, if available. */
    stack?: string;
  };

  /** Check-specific details. */
  details?: Record<string, unknown>;
}

/** Result of the 'connect' check. */
interface ConnectCheckResult extends CheckResult {
  name: 'connect';
  details?: {
    /** The transport type used. */
    transportType: 'stdio' | 'http' | 'sse';
  };
}

/** Result of the 'initialize' check. */
interface InitializeCheckResult extends CheckResult {
  name: 'initialize';
  details?: {
    /** The protocol version negotiated with the server. */
    protocolVersion: string;

    /** The server's self-reported name. */
    serverName: string;

    /** The server's self-reported version. */
    serverVersion: string;

    /** The capabilities the server declared. */
    capabilities: {
      tools?: boolean;
      resources?: boolean;
      prompts?: boolean;
      logging?: boolean;
    };
  };
}

/** Result of the 'tools' check. */
interface ToolsCheckResult extends CheckResult {
  name: 'tools';
  details?: {
    /** Number of tools returned by the server. */
    toolCount: number;

    /** Names of all tools returned. */
    toolNames: string[];
  };
}

/** Result of the 'resources' check. */
interface ResourcesCheckResult extends CheckResult {
  name: 'resources';
  details?: {
    /** Number of resources returned by the server. */
    resourceCount: number;

    /** URIs of all resources returned. */
    resourceUris: string[];
  };
}

/** Result of the 'prompts' check. */
interface PromptsCheckResult extends CheckResult {
  name: 'prompts';
  details?: {
    /** Number of prompts returned by the server. */
    promptCount: number;

    /** Names of all prompts returned. */
    promptNames: string[];
  };
}

/** Result of a user-defined custom check. */
interface CustomCheckCheckResult extends CheckResult {
  /** Name matches the user-provided custom check name. */
  name: string;
}

/** The complete health report returned by checkHealth. */
interface HealthReport {
  /** Overall health status. */
  status: HealthStatus;

  /** Total wall-clock time for the entire health check, in milliseconds. */
  totalMs: number;

  /** ISO 8601 timestamp of when the health check was performed. */
  timestamp: string;

  /** Results for each individual check, in execution order. */
  checks: CheckResult[];

  /** Summary counts. */
  summary: {
    /** Total number of checks executed. */
    total: number;

    /** Number of checks that passed. */
    passed: number;

    /** Number of checks that failed. */
    failed: number;

    /** Number of checks that were skipped. */
    skipped: number;
  };

  /** Server information, populated after a successful initialize check. */
  server?: {
    name: string;
    version: string;
    protocolVersion: string;
  };
}
```

### Example: Basic Stdio Health Check

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
  console.log(`Server is healthy. ${report.summary.passed}/${report.summary.total} checks passed in ${report.totalMs}ms.`);
} else {
  console.error(`Server is ${report.status}.`);
  for (const check of report.checks.filter(c => !c.passed)) {
    console.error(`  FAIL: ${check.name} — ${check.error?.message}`);
  }
  process.exit(1);
}
```

### Example: HTTP Transport with Thresholds

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

### Example: Custom Checks

```typescript
import { checkHealth } from 'mcp-healthcheck';

const report = await checkHealth({
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['./server.js'],
  },
  customChecks: [
    {
      name: 'has-search-tool',
      required: true,
      fn: async (client) => {
        const { tools } = await client.listTools();
        const hasSearch = tools.some(t => t.name === 'search');
        return {
          passed: hasSearch,
          message: hasSearch
            ? 'search tool is registered'
            : 'search tool is missing',
        };
      },
    },
  ],
});
```

### Example: AbortSignal for External Cancellation

```typescript
import { checkHealth } from 'mcp-healthcheck';

const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const report = await checkHealth({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  signal: controller.signal,
});
```

### Helper Export: `isHealthy`

A convenience function that runs the check and returns a boolean.

```typescript
import { isHealthy } from 'mcp-healthcheck';

const healthy: boolean = await isHealthy({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
});
```

### Helper Export: `createHttpHandler`

Creates an HTTP request handler suitable for mounting in an Express/Koa/Fastify app or a raw `http.createServer`, exposing a health check endpoint.

```typescript
import http from 'node:http';
import { createHttpHandler } from 'mcp-healthcheck';

const handler = createHttpHandler({
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
  timeout: 10_000,
});

// Returns 200 with JSON body when healthy, 503 when unhealthy.
const server = http.createServer(handler);
server.listen(8080);
```

**Signature:**

```typescript
function createHttpHandler(
  options: HealthCheckOptions,
): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;
```

**Behavior:**

- `GET` request: Runs `checkHealth(options)` and responds with:
  - `200 OK` with `Content-Type: application/json` and the `HealthReport` body if status is `'healthy'` or `'degraded'`.
  - `503 Service Unavailable` with `Content-Type: application/json` and the `HealthReport` body if status is `'unhealthy'`.
- Any other HTTP method: Responds with `405 Method Not Allowed`.

---

## 6. CLI Design

### Installation and Invocation

```bash
# Global install
npm install -g mcp-healthcheck
mcp-healthcheck --stdio 'node ./server.js'

# npx (no install)
npx mcp-healthcheck --url https://mcp.example.com/mcp

# Package script
# package.json: { "scripts": { "health": "mcp-healthcheck --stdio 'node ./server.js'" } }
npm run health
```

### CLI Binary Name

`mcp-healthcheck`

### Commands and Flags

The CLI has no subcommands. It accepts transport configuration and check options as flags.

```
mcp-healthcheck [options]

Transport (exactly one required):
  --stdio <command>          Spawn an MCP server via stdio transport.
                             The value is the shell command to execute.
                             Example: --stdio 'node ./server.js'
  --url <url>                Connect to an MCP server via Streamable HTTP.
                             Example: --url https://mcp.example.com/mcp
  --sse <url>                Connect via legacy SSE transport.
                             Example: --sse http://localhost:3000/sse

Transport options:
  --header <key:value>       Add an HTTP header (repeatable). Only for --url and --sse.
                             Example: --header 'Authorization:Bearer sk-...'
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
  --format <format>          Output format. Values: human, json. Default: human.
  --quiet                    Suppress all output except the exit code.
  --verbose                  Show detailed check information including tool/resource names.

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

### Human-Readable Output Example

```
$ mcp-healthcheck --stdio 'node ./server.js' --min-tools 2

  mcp-healthcheck v0.1.0

  Target: stdio — node ./server.js
  Status: healthy

  PASS  connect         12ms   stdio transport connected
  PASS  initialize      45ms   protocol v2025-06-18, server: my-server v1.0.0
  PASS  tools           28ms   5 tools: search, create, update, delete, list
  PASS  resources       15ms   2 resources
  PASS  prompts          8ms   1 prompt

  Summary: 5/5 passed in 108ms
```

### JSON Output Example

```
$ mcp-healthcheck --url https://mcp.example.com/mcp --format json
```

Outputs the `HealthReport` object as a JSON string to stdout.

### Environment Variables

All CLI flags can be set via environment variables. Environment variables are overridden by explicit flags.

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

---

## 7. Configuration

### Programmatic Configuration

All configuration is passed via the `HealthCheckOptions` object to `checkHealth()`. There is no config file format for the programmatic API. See Section 5 for the full type definition.

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `30_000` | Overall timeout for the entire health check (ms). |
| `checkTimeout` | `10_000` | Per-check timeout (ms). |
| `skip` | `[]` | No checks skipped. |
| `thresholds` | `{}` | No threshold assertions. |
| `customChecks` | `[]` | No custom checks. |
| `clientInfo.name` | `'mcp-healthcheck'` | Client name sent in `initialize`. |
| `clientInfo.version` | Package version from `package.json` | Client version sent in `initialize`. |

### Transport Default Behavior

- **stdio**: If `env` is not provided, the subprocess inherits `process.env`. If `cwd` is not provided, it defaults to `process.cwd()`.
- **http**: No default headers. If the server requires authentication, the caller must provide it via `headers`.
- **sse**: Same as http.

---

## 8. Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      checkHealth()                          │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Transport    │   │   Check      │   │   Report       │  │
│  │  Factory      │──▶│   Runner     │──▶│   Builder      │  │
│  │              │   │              │   │                │  │
│  │  Creates the │   │  Executes    │   │  Aggregates    │  │
│  │  appropriate │   │  checks in   │   │  CheckResults  │  │
│  │  MCP SDK     │   │  sequence    │   │  into a        │  │
│  │  transport   │   │  with per-   │   │  HealthReport  │  │
│  │  instance    │   │  check       │   │                │  │
│  │              │   │  timeouts    │   │                │  │
│  └──────────────┘   └──────────────┘   └────────────────┘  │
│         │                  │                                │
│         ▼                  │                                │
│  ┌──────────────┐          │                                │
│  │  MCP Client  │◀─────────┘                                │
│  │  (from SDK)  │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

### Internal Modules

1. **`transport-factory.ts`** — Reads the `TransportConfig` and instantiates the appropriate MCP SDK transport class (`StdioClientTransport`, `StreamableHTTPClientTransport`, or `SSEClientTransport`). Handles stdio subprocess spawning, URL validation, and header injection.

2. **`check-runner.ts`** — Orchestrates the check sequence. Creates an MCP `Client` instance, connects to the transport, and runs each check function in order. Enforces per-check and overall timeouts. If a check fails and is required, subsequent checks may still run (to provide a complete report) but the overall status will be `unhealthy`.

3. **`checks/connect.ts`** — Verifies that the transport layer connects successfully. For stdio, this means the subprocess started and stdin/stdout are open. For HTTP/SSE, this means the initial HTTP request succeeded.

4. **`checks/initialize.ts`** — Calls `client.connect(transport)` which performs the MCP `initialize` / `initialized` handshake. Extracts server info, protocol version, and declared capabilities from the `InitializeResult`.

5. **`checks/tools.ts`** — Calls `client.listTools()` and records the tool count and tool names. Validates against `thresholds.minTools` and `thresholds.maxTools` if configured.

6. **`checks/resources.ts`** — Calls `client.listResources()` and records the resource count and URIs. Validates against `thresholds.minResources` if configured.

7. **`checks/prompts.ts`** — Calls `client.listPrompts()` and records the prompt count and names. Validates against `thresholds.minPrompts` if configured.

8. **`checks/custom.ts`** — Runs each user-provided custom check function, passing the connected `Client` instance. Wraps each in a try/catch and timeout.

9. **`report-builder.ts`** — Takes the array of `CheckResult` objects, computes the overall `HealthStatus`, calculates summary counts, and constructs the final `HealthReport`.

10. **`cli.ts`** — Parses CLI arguments, maps them to `HealthCheckOptions`, calls `checkHealth()`, formats the output, and exits with the appropriate code.

### Data Flow

1. **Input**: `HealthCheckOptions` is provided by the caller (or parsed from CLI args).
2. **Transport creation**: The transport factory creates an SDK transport instance.
3. **Client creation**: A new `Client({ name, version })` is instantiated.
4. **Connect + Initialize**: `client.connect(transport)` is called, which internally sends `initialize` and `notifications/initialized`. This is a single SDK call that covers both the `connect` and `initialize` logical checks. Internally, the check runner starts a timer before calling `connect`, and records the `connect` check result when the transport is connected but before the handshake completes. However, because the SDK's `connect()` method performs both transport connection and protocol initialization atomically, the implementation splits timing by wrapping transport-level events: transport `onopen` marks the connect check complete, and `connect()` resolution marks the initialize check complete.

   **Implementation detail**: Because the MCP SDK's `Client.connect()` bundles transport connection and protocol handshake into a single call, the health checker cannot trivially separate "transport connected" from "handshake completed" without hooking into transport internals. The practical implementation treats `connect()` success as proof that both transport and handshake succeeded, and reports the timing under the `initialize` check. The `connect` check is reported with near-zero duration as a logical confirmation that the transport type was valid and the connection did not fail at the transport layer (e.g., `ECONNREFUSED`, subprocess crash). If `connect()` throws, the error is classified as a `connect` failure or an `initialize` failure based on the error type: transport-level errors (connection refused, spawn failure, DNS failure) are reported under `connect`; protocol-level errors (handshake rejection, version mismatch) are reported under `initialize`.

5. **Enumeration checks**: `listTools`, `listResources`, and `listPrompts` are called sequentially (not in parallel, to avoid overwhelming the server and to produce clear per-check latency measurements). Each call is wrapped in a per-check timeout using `Promise.race` with a timer.
6. **Custom checks**: Each custom check function is called sequentially with the connected client.
7. **Cleanup**: `client.close()` is called in a `finally` block. For stdio transports, the subprocess is terminated with `SIGTERM` if still running, followed by `SIGKILL` after a 5-second grace period.
8. **Report assembly**: All check results are passed to the report builder, which computes the overall status and summary.

### Timeout Strategy

Timeouts are enforced at two levels:

- **Per-check timeout** (`checkTimeout`, default 10s): Each individual check (connect, initialize, tools, resources, prompts, each custom check) is wrapped in a `Promise.race` with a timeout rejection. If the check times out, it is recorded as a failure with error code `CHECK_TIMEOUT`.

- **Overall timeout** (`timeout`, default 30s): A master timer starts when `checkHealth()` is called. If it fires before all checks complete, remaining checks are skipped and recorded as failures with error code `OVERALL_TIMEOUT`. The function resolves (does not reject) with the partial report. Cleanup (client close, subprocess termination) still runs.

Both timeouts are implemented using `AbortController` internally. The caller-provided `signal` is composed with the internal signals so that external cancellation is respected.

### Connection Lifecycle

```
checkHealth() called
  │
  ├── Create transport (StdioClientTransport / StreamableHTTPClientTransport / SSEClientTransport)
  │     └── For stdio: spawn subprocess
  │     └── For http/sse: validate URL
  │
  ├── Create Client({ name: 'mcp-healthcheck', version: '0.1.0' })
  │
  ├── client.connect(transport)  ◄── performs initialize handshake
  │     ├── Sends: { method: 'initialize', params: { protocolVersion, capabilities, clientInfo } }
  │     ├── Receives: { result: { protocolVersion, capabilities, serverInfo } }
  │     └── Sends: { method: 'notifications/initialized' }
  │
  ├── client.listTools()
  │     ├── Sends: { method: 'tools/list' }
  │     └── Receives: { result: { tools: [...] } }
  │
  ├── client.listResources()  (if not skipped and server declares resources capability)
  │     ├── Sends: { method: 'resources/list' }
  │     └── Receives: { result: { resources: [...] } }
  │
  ├── client.listPrompts()  (if not skipped and server declares prompts capability)
  │     ├── Sends: { method: 'prompts/list' }
  │     └── Receives: { result: { prompts: [...] } }
  │
  ├── Custom checks (sequentially)
  │     └── Each: customCheck.fn(client)
  │
  └── finally:
        ├── client.close()
        └── For stdio: terminate subprocess (SIGTERM, then SIGKILL after 5s)
```

---

## 9. Health Check Details

### Check Sequence

Checks run in this fixed order. Each check depends on the previous check succeeding (except custom checks, which run even if enumeration checks fail, as long as the client is connected).

| Order | Check Name | Can Skip? | Depends On | What It Verifies |
|-------|-----------|-----------|------------|------------------|
| 1 | `connect` | No | Nothing | Transport-level connectivity. Subprocess spawned (stdio), HTTP endpoint reachable (http/sse). |
| 2 | `initialize` | No | `connect` | MCP protocol handshake succeeds. Server returns `InitializeResult` with valid `protocolVersion`, `serverInfo`, and `capabilities`. |
| 3 | `tools` | Yes | `initialize` | `tools/list` returns successfully. Tool count meets thresholds. Server declared `tools` capability. |
| 4 | `resources` | Yes | `initialize` | `resources/list` returns successfully. Resource count meets thresholds. If the server did not declare the `resources` capability, this check is auto-skipped with a `passed: true` result and a message noting the server does not support resources. |
| 5 | `prompts` | Yes | `initialize` | `prompts/list` returns successfully. Prompt count meets thresholds. Same auto-skip behavior as resources. |
| 6+ | Custom checks | N/A (always run) | `initialize` | User-defined logic succeeds. |

### Check: `connect`

**What it does**: Validates that the transport layer can establish a connection.

- **stdio**: The subprocess was spawned successfully, its stdout is readable, and its stdin is writable. Failures: `ENOENT` (command not found), `EACCES` (permission denied), subprocess crash on startup.
- **http**: An HTTP request to the configured URL does not fail with a network error. Failures: `ECONNREFUSED`, DNS resolution failure, TLS errors, HTTP 4xx/5xx on the initialization POST.
- **sse**: An HTTP GET to the SSE endpoint returns a `text/event-stream` response. Failures: same as http, plus non-SSE content type.

**Reported details**: `{ transportType: 'stdio' | 'http' | 'sse' }`

### Check: `initialize`

**What it does**: Completes the MCP `initialize` / `initialized` handshake.

- Sends `initialize` with `protocolVersion: '2025-06-18'` (or the latest supported version), client capabilities (empty, since the health checker does not need sampling/elicitation/roots), and `clientInfo`.
- Receives `InitializeResult` with `protocolVersion`, `serverInfo`, and `capabilities`.
- Sends `notifications/initialized`.

**Failure modes**:
- Server does not respond within `checkTimeout`.
- Server responds with a JSON-RPC error (e.g., unsupported protocol version).
- Server's response is malformed (missing required fields).

**Reported details**: `{ protocolVersion, serverName, serverVersion, capabilities: { tools, resources, prompts, logging } }`

### Check: `tools`

**What it does**: Calls `client.listTools()` and collects results.

- Paginates through all pages if the server uses cursor-based pagination (follows `nextCursor` until it is `undefined`).
- Counts total tools and collects tool names.
- Validates against `thresholds.minTools` and `thresholds.maxTools`.

**Failure modes**:
- Server returns a JSON-RPC error (e.g., `MethodNotFound` if tools capability was declared but the handler is missing).
- Timeout exceeded.
- Tool count below `minTools` or above `maxTools`.

**Auto-skip**: If the server did not declare `tools` in its capabilities during initialization, this check is auto-skipped. The result is `{ passed: true, message: 'Server does not declare tools capability (skipped)', durationMs: 0 }`.

**Reported details**: `{ toolCount, toolNames }`

### Check: `resources`

**What it does**: Calls `client.listResources()` and collects results.

- Paginates through all pages.
- Counts total resources and collects URIs.
- Validates against `thresholds.minResources`.

**Auto-skip**: If the server did not declare `resources` in its capabilities, this check is auto-skipped with a passing result.

**Reported details**: `{ resourceCount, resourceUris }`

### Check: `prompts`

**What it does**: Calls `client.listPrompts()` and collects results.

- Paginates through all pages.
- Counts total prompts and collects names.
- Validates against `thresholds.minPrompts`.

**Auto-skip**: If the server did not declare `prompts` in its capabilities, this check is auto-skipped with a passing result.

**Reported details**: `{ promptCount, promptNames }`

### Custom Checks

**What they do**: Run user-provided async functions with the connected `Client` instance.

- Each custom check receives the `Client` and must return a `CustomCheckResult` with `passed`, `message`, and optional `details`.
- Each is wrapped in a per-check timeout.
- If a custom check throws, it is treated as a failure. The thrown error's message is used as the check's error message.
- If `required` is true and the check fails, the overall status is `unhealthy`. If `required` is false (default), the overall status is `degraded`.

### Latency Measurement

Every check's `durationMs` is measured using `performance.now()` (or `Date.now()` as fallback) to capture high-resolution wall-clock time. Latency is measured from the moment the check function begins to the moment it resolves or rejects.

If `thresholds.maxLatencyMs` is set and any check exceeds it, the overall status is `degraded` (not `unhealthy`, since the check itself succeeded — it was just slow). The check result's `passed` field remains `true`, but the report builder notes the latency violation when computing the overall status.

---

## 10. Error Handling

### Error Classification

Errors are classified into error codes reported in `CheckResult.error.code`:

| Error Code | Source | Meaning |
|-----------|--------|---------|
| `TRANSPORT_ERROR` | Transport layer | Failed to establish transport connection. Subprocess crash, `ECONNREFUSED`, DNS failure, TLS error. |
| `SPAWN_ERROR` | stdio transport | Failed to spawn the subprocess. Command not found (`ENOENT`), permission denied (`EACCES`). |
| `HANDSHAKE_ERROR` | MCP protocol | The `initialize` request failed. Server returned a JSON-RPC error, version mismatch, or malformed response. |
| `PROTOCOL_ERROR` | MCP protocol | A `tools/list`, `resources/list`, or `prompts/list` request returned a JSON-RPC error. |
| `CHECK_TIMEOUT` | Timeout system | An individual check exceeded `checkTimeout`. |
| `OVERALL_TIMEOUT` | Timeout system | The entire health check exceeded `timeout`. Remaining checks were skipped. |
| `ABORTED` | External signal | The caller's `AbortSignal` was triggered. |
| `THRESHOLD_VIOLATION` | Threshold evaluation | A threshold assertion failed (e.g., tool count below minimum). The check result's `passed` is `false`. |
| `CUSTOM_CHECK_ERROR` | Custom check | A custom check function threw an exception. |
| `UNKNOWN_ERROR` | Fallback | An unexpected error that doesn't match any known pattern. |

### Error Propagation

`checkHealth()` never throws. It always returns a `HealthReport`. All errors are captured and reported within the `checks` array. The overall `status` reflects the worst-case outcome.

If the transport fails to connect or the handshake fails, subsequent checks are skipped and recorded with error code `OVERALL_TIMEOUT` and a message like `'Skipped: previous required check failed'`.

### Subprocess Cleanup on Error

For stdio transports, the subprocess is always cleaned up in the `finally` block:

1. `client.close()` is called, which closes the transport.
2. If the subprocess is still running (checked via `child.exitCode === null`), send `SIGTERM`.
3. Wait up to 5 seconds for the process to exit.
4. If still running, send `SIGKILL`.

This ensures no zombie processes are left behind, even if the health check times out or is aborted.

---

## 11. Testing Strategy

### Unit Tests

Unit tests mock the MCP SDK's `Client` and transport classes to test the health check logic in isolation.

- **Transport factory tests**: Verify that the correct transport class is instantiated for each `TransportConfig` type. Verify that stdio args, env, and cwd are passed correctly. Verify that HTTP headers are applied.
- **Check runner tests**: Verify check sequencing, per-check timeout enforcement, overall timeout enforcement, skip behavior, and auto-skip when capabilities are missing.
- **Individual check tests**: For each check (connect, initialize, tools, resources, prompts), mock the `Client` methods and verify correct `CheckResult` construction for success, failure, timeout, and edge cases.
- **Report builder tests**: Verify status computation rules: all passed = healthy, any required failed = unhealthy, only optional failed = degraded. Verify summary counts. Verify timestamp format.
- **Threshold tests**: Verify that `minTools`, `maxTools`, `minResources`, `minPrompts`, and `maxLatencyMs` produce correct pass/fail results.
- **CLI parsing tests**: Verify argument parsing, environment variable fallback, flag precedence over env vars, and error messages for invalid input.
- **Output formatting tests**: Verify human-readable and JSON output formats.

### Integration Tests

Integration tests spawn a real MCP server subprocess and run `checkHealth` against it.

- **Healthy server**: Start a known-good MCP server (e.g., `@modelcontextprotocol/server-filesystem` or a minimal test server bundled with the test suite), run `checkHealth`, assert `status === 'healthy'`, and verify tool/resource counts.
- **Server that crashes on startup**: Spawn a command that immediately exits with code 1. Assert `status === 'unhealthy'` and `connect` check failed with `SPAWN_ERROR` or `TRANSPORT_ERROR`.
- **Server that hangs during handshake**: Start a server that reads stdin but never responds. Assert that `checkTimeout` is enforced and the `initialize` check fails with `CHECK_TIMEOUT`.
- **Server with no tools**: Start a minimal server that declares the `tools` capability but returns an empty tools list. Assert that the check passes with `toolCount: 0` but fails if `minTools: 1` is set.
- **HTTP transport**: Start an MCP server with Streamable HTTP transport and run `checkHealth` against its URL.

### Edge Cases to Test

- Server returns paginated tools (multiple pages via `nextCursor`).
- Server declares `tools` capability but `listTools` throws `MethodNotFound`.
- Server does not declare `resources` capability — verify auto-skip.
- Custom check throws a synchronous exception.
- Custom check returns a rejected promise.
- `AbortSignal` is triggered mid-check.
- Overall timeout fires while a check is in progress.
- Subprocess spawned via stdio writes garbage to stdout before the first JSON-RPC message.
- Connection to an HTTP URL that returns HTML (not JSON-RPC).
- Multiple `checkHealth` calls in sequence (verify no resource leaks).

### Test Framework

Tests use Vitest, matching the project's existing configuration. Mock MCP servers for unit tests are created using the `@modelcontextprotocol/sdk`'s `McpServer` class running in-process or as a spawned subprocess.

---

## 12. Dependencies

### Runtime Dependencies

| Dependency | Purpose | Why Not Avoid It |
|-----------|---------|-----------------|
| `@modelcontextprotocol/sdk` | Provides `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport`, `SSEClientTransport`, and all MCP type definitions. | This is the official SDK for MCP. Reimplementing the protocol client would be incorrect — the SDK handles protocol version negotiation, JSON-RPC framing, transport lifecycle, and error types. It is the only way to reliably connect to arbitrary MCP servers. |

### No Other Runtime Dependencies

The package does not depend on any HTTP framework, CLI parsing library, or utility library at runtime. CLI argument parsing is implemented with Node.js built-in `process.argv` parsing (using `util.parseArgs` from Node.js 18+). HTTP handler creation uses the built-in `node:http` module. Timing uses `performance.now()` from the built-in `perf_hooks` module.

### Dev Dependencies

| Dependency | Purpose |
|-----------|---------|
| `typescript` | TypeScript compiler. |
| `vitest` | Test runner. |
| `eslint` | Linter. |
| `@modelcontextprotocol/sdk` | Also a dev dependency for creating mock servers in tests. |

---

## 13. Performance Considerations

### Connection Overhead

Each `checkHealth` call creates a new transport connection, performs the handshake, runs checks, and tears down the connection. There is no connection pooling. This is intentional: health checks should test the full connection lifecycle, and reusing connections would mask connection-establishment failures.

For Kubernetes probes that run every 10-30 seconds, the overhead of connection setup (typically 50-200ms for stdio, 100-500ms for HTTP) is acceptable. If connection overhead becomes a concern, the caller can increase the probe `periodSeconds` in Kubernetes configuration.

### Timeout Budgets

Checks run sequentially, so the total time is the sum of all check durations. With the default `checkTimeout` of 10 seconds and 5 standard checks, the worst-case per-check budget allows 10 seconds each. However, the overall `timeout` of 30 seconds acts as a hard ceiling. A reasonable configuration for Kubernetes probes is:

```yaml
livenessProbe:
  exec:
    command: ['mcp-healthcheck', '--stdio', 'node server.js', '--timeout', '8000', '--check-timeout', '3000', '--quiet']
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 3
```

### Parallel Checks

Enumeration checks (`tools/list`, `resources/list`, `prompts/list`) run sequentially, not in parallel. This is a deliberate design choice:

1. Some MCP servers are single-threaded (stdio servers are inherently serial).
2. Sequential execution produces clearer per-check latency measurements.
3. Sequential execution avoids overwhelming lightweight servers with concurrent requests.

If parallel enumeration is needed in the future, it can be added as an opt-in flag without breaking the API.

### Memory

The health checker does not accumulate large data structures. Tool names, resource URIs, and prompt names are stored as string arrays for the report but are not deeply inspected. For servers with thousands of tools (unlikely but possible), pagination is followed to completion, which could produce a large array. A future optimization could add a `maxPages` option to limit pagination depth.

### Subprocess Management

For stdio transports, the subprocess is spawned fresh on each health check and terminated afterward. Subprocess cleanup uses `SIGTERM` with a 5-second grace period before `SIGKILL`. The health checker does not attempt to reuse subprocesses across calls. If the caller needs to check the same server repeatedly, they should call `checkHealth()` in a loop or timer, and each call will spawn and tear down the subprocess independently.

---

## 14. Future Considerations

The following features are explicitly out of scope for v1 but may be added in later versions.

### Continuous Monitoring Mode

A `watch` or `monitor` mode that runs health checks on a configurable interval and emits events or metrics. v1 is strictly one-shot.

### Prometheus / OpenTelemetry Metrics Export

Exposing health check results as Prometheus metrics (gauges for tool count, histograms for latency) or OpenTelemetry spans. v1 returns structured data; integration with specific metrics systems is left to the caller.

### Tool Invocation Checks

Calling `tools/call` on specific tools with user-provided arguments and validating the response. This is a natural extension of the `customChecks` API but requires careful design around argument specification and response validation.

### Parallel Server Checks

Checking multiple MCP servers in a single `checkHealth` call, returning a combined report. v1 checks a single server; the caller can use `Promise.all` to check multiple servers in parallel.

### Config File Support

Reading health check configuration from a `.mcp-healthcheck.json` or `.mcp-healthcheck.yaml` file. v1 uses programmatic options and CLI flags only.

### Authentication Providers

Integrating with the MCP SDK's OAuth authentication providers (`ClientCredentialsProvider`, `PrivateKeyJwtProvider`) for servers that require OAuth flows. v1 supports static headers via `headers` for bearer tokens; full OAuth flows are deferred.

### gRPC Transport

If the MCP ecosystem adopts a gRPC transport in the future, support can be added via a new `TransportConfig` variant without breaking the existing API.

### Resource and Prompt Deep Checks

Reading a specific resource via `resources/read` or retrieving a specific prompt via `prompts/get` as part of the health check. These go beyond enumeration and test actual data retrieval, which may be valuable for thorough health checks.

---

## 15. Example Use Cases

### 15.1 Kubernetes Liveness/Readiness Probe

A Kubernetes deployment runs an MCP server as a sidecar. The liveness probe uses the `mcp-healthcheck` CLI to verify the server is alive. The readiness probe adds a `--min-tools` threshold to ensure the server has fully initialized and registered all expected tools before the pod is marked as ready.

**Deployment manifest:**

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

### 15.2 CI Pipeline Gate

A GitHub Actions workflow starts an MCP server, waits for it to be healthy, then runs integration tests.

**Workflow step:**

```yaml
- name: Start MCP server
  run: node ./mcp-server.js &

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

- name: Run integration tests
  run: npm test
```

### 15.3 Monitoring Dashboard Integration

A Node.js monitoring service polls multiple MCP servers and pushes results to a time-series database.

```typescript
import { checkHealth, HealthReport } from 'mcp-healthcheck';

interface ServerTarget {
  name: string;
  options: Parameters<typeof checkHealth>[0];
}

const servers: ServerTarget[] = [
  {
    name: 'search-server',
    options: {
      transport: { type: 'http', url: 'https://search.internal/mcp' },
      timeout: 10_000,
      thresholds: { minTools: 3, maxLatencyMs: 2000 },
    },
  },
  {
    name: 'db-server',
    options: {
      transport: { type: 'http', url: 'https://db.internal/mcp' },
      timeout: 10_000,
      thresholds: { minTools: 5, minResources: 1 },
    },
  },
];

async function pollAll(): Promise<void> {
  const results = await Promise.all(
    servers.map(async (server) => {
      const report = await checkHealth(server.options);
      return { name: server.name, report };
    }),
  );

  for (const { name, report } of results) {
    // Push to your metrics backend
    metrics.gauge(`mcp.${name}.status`, report.status === 'healthy' ? 1 : 0);
    metrics.gauge(`mcp.${name}.latency_ms`, report.totalMs);
    metrics.gauge(`mcp.${name}.tool_count`,
      report.checks.find(c => c.name === 'tools')?.details?.toolCount ?? 0,
    );
  }
}

setInterval(pollAll, 30_000);
```

### 15.4 CLI Quick-Check During Development

A developer has just modified their MCP server and wants to verify it still starts and registers the expected tools.

```bash
$ mcp-healthcheck --stdio 'node ./src/server.ts' --verbose

  mcp-healthcheck v0.1.0

  Target: stdio — node ./src/server.ts
  Status: healthy

  PASS  connect         8ms    stdio transport connected
  PASS  initialize     34ms    protocol v2025-06-18, server: my-weather-server v2.1.0
                                capabilities: tools, resources
  PASS  tools          22ms    3 tools:
                                 - get_weather
                                 - get_forecast
                                 - get_alerts
  PASS  resources      11ms    1 resource:
                                 - config://api-settings
  SKIP  prompts         0ms    Server does not declare prompts capability (skipped)

  Summary: 4/4 passed, 1 skipped in 75ms
```

### 15.5 Programmatic Health Monitoring in a Node.js Host Application

An MCP host application checks server health before routing tool calls, implementing graceful degradation.

```typescript
import { checkHealth, HealthReport } from 'mcp-healthcheck';

class McpServerPool {
  private servers: Map<string, { config: Parameters<typeof checkHealth>[0]; healthy: boolean }> = new Map();

  addServer(name: string, config: Parameters<typeof checkHealth>[0]): void {
    this.servers.set(name, { config, healthy: false });
  }

  async refreshHealth(): Promise<void> {
    const checks = Array.from(this.servers.entries()).map(
      async ([name, entry]) => {
        const report = await checkHealth(entry.config);
        entry.healthy = report.status === 'healthy';
        return { name, status: report.status, totalMs: report.totalMs };
      },
    );

    const results = await Promise.all(checks);
    for (const r of results) {
      console.log(`[${r.name}] ${r.status} (${r.totalMs}ms)`);
    }
  }

  getHealthyServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([, entry]) => entry.healthy)
      .map(([name]) => name);
  }
}

const pool = new McpServerPool();

pool.addServer('search', {
  transport: { type: 'http', url: 'https://search.internal/mcp' },
  timeout: 5_000,
});

pool.addServer('database', {
  transport: { type: 'http', url: 'https://db.internal/mcp' },
  timeout: 5_000,
});

// Refresh health every 30 seconds
setInterval(() => pool.refreshHealth(), 30_000);
```
