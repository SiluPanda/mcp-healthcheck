# mcp-healthcheck — Task Breakdown

This document breaks down all work required to implement `mcp-healthcheck` as described in SPEC.md into granular, actionable tasks.

---

## Phase 1: Project Scaffolding and Configuration

- [ ] **Install runtime dependency** — Add `@modelcontextprotocol/sdk` as a peer dependency (`^1.12.0`) and as a dev dependency. Run `npm install` to set up node_modules. | Status: not_done

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, and `eslint` as dev dependencies. Ensure versions are compatible with the existing `tsconfig.json` (ES2022 target, commonjs module). | Status: not_done

- [ ] **Configure package.json bin entry** — Add a `"bin"` field mapping `"mcp-healthcheck"` to `"dist/cli.js"`. This enables the CLI to be invoked as `mcp-healthcheck` after global install or via `npx`. | Status: not_done

- [ ] **Add shebang to CLI entry point** — Ensure `src/cli.ts` will compile with `#!/usr/bin/env node` at the top of `dist/cli.js`. Consider a build post-process step or prepend the shebang in the source file. | Status: not_done

- [ ] **Configure exports in package.json** — Verify `"main": "dist/index.js"` and `"types": "dist/index.d.ts"` are correct. Add `"exports"` field if needed for ESM/CJS dual support. Ensure `"files"` includes `"dist"`. | Status: not_done

- [ ] **Set up ESLint configuration** — Create or verify `.eslintrc` / `eslint.config.js` with TypeScript support. Ensure `npm run lint` works against the `src/` directory. | Status: not_done

- [ ] **Verify Vitest configuration** — Ensure Vitest runs with `npm run test`. Create `vitest.config.ts` if needed, or verify Vitest finds tests via convention (e.g., `src/__tests__/*.test.ts`). | Status: not_done

- [ ] **Create source directory structure** — Create the following file stubs under `src/`: `index.ts`, `types.ts`, `transport-factory.ts`, `check-runner.ts`, `report-builder.ts`, `cli.ts`, and `checks/` directory with `connect.ts`, `initialize.ts`, `tools.ts`, `resources.ts`, `prompts.ts`, `custom.ts`. | Status: not_done

---

## Phase 2: Type Definitions

- [ ] **Define TransportConfig types** — Implement `StdioTransportConfig`, `HttpTransportConfig`, `SseTransportConfig`, and the `TransportConfig` union type in `src/types.ts`. Include all fields: `type`, `command`, `args`, `env`, `cwd` (stdio); `type`, `url`, `headers` (http); `type`, `url`, `headers` (sse). | Status: not_done

- [ ] **Define CustomCheckFn and CustomCheckResult types** — Implement `CustomCheckFn` as an async function receiving an MCP `Client` and returning `CustomCheckResult` with `passed`, `message`, and optional `details`. | Status: not_done

- [ ] **Define Thresholds type** — Implement `Thresholds` interface with optional fields: `maxLatencyMs`, `minTools`, `maxTools`, `minResources`, `minPrompts`. | Status: not_done

- [ ] **Define HealthCheckOptions type** — Implement the main options interface with fields: `transport` (required), `timeout` (default 30000), `checkTimeout` (default 10000), `skip` (array of 'tools'|'resources'|'prompts'), `thresholds`, `customChecks` (array with `name`, `fn`, `required`), `clientInfo`, and `signal` (AbortSignal). | Status: not_done

- [ ] **Define HealthStatus type** — Implement `HealthStatus` as the union `'healthy' | 'unhealthy' | 'degraded'`. | Status: not_done

- [ ] **Define CheckResult and specialized result types** — Implement `CheckResult` base interface with `name`, `passed`, `durationMs`, `message`, `error` (with `code`, `message`, `stack`), and `details`. Implement extended interfaces: `ConnectCheckResult`, `InitializeCheckResult`, `ToolsCheckResult`, `ResourcesCheckResult`, `PromptsCheckResult`, `CustomCheckCheckResult` with their specific `details` shapes. | Status: not_done

- [ ] **Define HealthReport type** — Implement `HealthReport` with `status`, `totalMs`, `timestamp` (ISO 8601), `checks` array, `summary` (total, passed, failed, skipped), and optional `server` (name, version, protocolVersion). | Status: not_done

- [ ] **Define error code constants** — Create string constants or an enum for all error codes: `TRANSPORT_ERROR`, `SPAWN_ERROR`, `HANDSHAKE_ERROR`, `PROTOCOL_ERROR`, `CHECK_TIMEOUT`, `OVERALL_TIMEOUT`, `ABORTED`, `THRESHOLD_VIOLATION`, `CUSTOM_CHECK_ERROR`, `UNKNOWN_ERROR`. | Status: not_done

---

## Phase 3: Transport Factory

- [ ] **Implement StdioClientTransport creation** — In `src/transport-factory.ts`, handle `StdioTransportConfig` by creating a `StdioClientTransport` from the MCP SDK. Pass `command`, `args`, `env` (merged with `process.env`), and `cwd` (defaults to `process.cwd()`). | Status: not_done

- [ ] **Implement StreamableHTTPClientTransport creation** — Handle `HttpTransportConfig` by creating a `StreamableHTTPClientTransport`. Pass the `url` (validated) and `headers` to the transport constructor. | Status: not_done

- [ ] **Implement SSEClientTransport creation** — Handle `SseTransportConfig` by creating an `SSEClientTransport` from the SDK. Pass the `url` and `headers`. | Status: not_done

- [ ] **Add URL validation for HTTP/SSE transports** — Validate that the `url` field is a parseable URL before creating the transport. Throw a descriptive error if the URL is invalid. | Status: not_done

- [ ] **Export a single factory function** — Expose `createTransport(config: TransportConfig): Transport` that dispatches to the correct transport constructor based on `config.type`. | Status: not_done

---

## Phase 4: Individual Health Checks

### Connect Check

- [ ] **Implement connect check** — In `src/checks/connect.ts`, create a function that verifies transport-level connectivity. Since the MCP SDK's `Client.connect()` bundles transport connection and handshake, the connect check is a logical confirmation that the transport type was valid and no transport-layer error occurred (e.g., `ECONNREFUSED`, subprocess crash, `ENOENT`). Return a `ConnectCheckResult` with `transportType` in details. | Status: not_done

- [ ] **Classify transport-level errors for connect check** — Detect and classify errors: `ENOENT`/`EACCES` as `SPAWN_ERROR` for stdio; `ECONNREFUSED`/DNS/TLS failures as `TRANSPORT_ERROR` for HTTP/SSE. Set the appropriate error code in the `CheckResult.error`. | Status: not_done

### Initialize Check

- [ ] **Implement initialize check** — In `src/checks/initialize.ts`, call `client.connect(transport)` which performs the MCP handshake. On success, extract `protocolVersion`, `serverInfo.name`, `serverInfo.version`, and `capabilities` from the result. Return an `InitializeCheckResult` with these details. | Status: not_done

- [ ] **Handle handshake failures in initialize check** — Catch JSON-RPC errors, version mismatches, and malformed responses. Classify as `HANDSHAKE_ERROR`. Include the original error message and stack in the result. | Status: not_done

- [ ] **Separate connect vs. initialize error classification** — When `client.connect()` throws, classify transport-level errors (connection refused, spawn failure, DNS) under the `connect` check and protocol-level errors (handshake rejection, version mismatch) under the `initialize` check. | Status: not_done

### Tools Check

- [ ] **Implement tools check** — In `src/checks/tools.ts`, call `client.listTools()`. Collect all tools, handling pagination (follow `nextCursor` until undefined). Record `toolCount` and `toolNames`. Return a `ToolsCheckResult`. | Status: not_done

- [ ] **Implement tools threshold validation** — If `thresholds.minTools` is set and `toolCount < minTools`, fail the check with error code `THRESHOLD_VIOLATION`. Same for `thresholds.maxTools` if `toolCount > maxTools`. | Status: not_done

- [ ] **Implement tools auto-skip** — If the server did not declare the `tools` capability in its initialization response, auto-skip the tools check with `passed: true`, `durationMs: 0`, and a message indicating the server does not support tools. | Status: not_done

### Resources Check

- [ ] **Implement resources check** — In `src/checks/resources.ts`, call `client.listResources()`. Paginate, collect `resourceCount` and `resourceUris`. Return a `ResourcesCheckResult`. | Status: not_done

- [ ] **Implement resources threshold validation** — If `thresholds.minResources` is set and `resourceCount < minResources`, fail the check with `THRESHOLD_VIOLATION`. | Status: not_done

- [ ] **Implement resources auto-skip** — If the server did not declare `resources` capability, auto-skip with a passing result and descriptive message. | Status: not_done

### Prompts Check

- [ ] **Implement prompts check** — In `src/checks/prompts.ts`, call `client.listPrompts()`. Paginate, collect `promptCount` and `promptNames`. Return a `PromptsCheckResult`. | Status: not_done

- [ ] **Implement prompts threshold validation** — If `thresholds.minPrompts` is set and `promptCount < minPrompts`, fail with `THRESHOLD_VIOLATION`. | Status: not_done

- [ ] **Implement prompts auto-skip** — If the server did not declare `prompts` capability, auto-skip with a passing result. | Status: not_done

### Custom Checks

- [ ] **Implement custom check runner** — In `src/checks/custom.ts`, iterate through the `customChecks` array. For each, call `fn(client)`, wrap in try/catch, and produce a `CheckResult`. Use the user-provided `name` as the check name. | Status: not_done

- [ ] **Handle custom check exceptions** — If a custom check throws (sync or async), treat it as a failure with error code `CUSTOM_CHECK_ERROR` and use the thrown error's message. | Status: not_done

- [ ] **Apply per-check timeout to custom checks** — Each custom check must respect the `checkTimeout`. Wrap in `Promise.race` with a timer. If it times out, record as `CHECK_TIMEOUT`. | Status: not_done

- [ ] **Determine required vs. optional custom check impact** — If `required: true` and the custom check fails, the overall status is `unhealthy`. If `required: false` (default), a failure marks status as `degraded`. | Status: not_done

---

## Phase 5: Check Runner (Orchestration)

- [ ] **Implement check sequencing** — In `src/check-runner.ts`, execute checks in the fixed order: connect, initialize, tools, resources, prompts, then custom checks. Each check runs sequentially (not in parallel). | Status: not_done

- [ ] **Implement per-check timeout enforcement** — Wrap each check call in `Promise.race` with a timeout promise (rejects after `checkTimeout` ms). On timeout, record a failure with error code `CHECK_TIMEOUT`. | Status: not_done

- [ ] **Implement overall timeout enforcement** — Start a master timer when `checkHealth()` begins. If it fires before all checks complete, skip remaining checks and record them as failures with `OVERALL_TIMEOUT` and message `'Skipped: overall timeout exceeded'`. | Status: not_done

- [ ] **Implement skip logic** — If a check name (tools, resources, prompts) appears in the `skip` array, skip it entirely. Do not produce a `CheckResult` for skipped checks (or produce one with a skipped indicator). Increment `summary.skipped`. | Status: not_done

- [ ] **Handle dependency failures** — If `connect` or `initialize` fails, skip all subsequent checks and record them with error code `OVERALL_TIMEOUT` and message `'Skipped: previous required check failed'`. | Status: not_done

- [ ] **Implement AbortSignal support** — If the caller provides a `signal`, compose it with internal AbortControllers. When aborted, stop immediately and return an unhealthy report with error code `ABORTED`. | Status: not_done

- [ ] **Implement latency measurement** — Measure each check's duration using `performance.now()`. Record in `durationMs` field of each `CheckResult`. | Status: not_done

- [ ] **Implement maxLatencyMs threshold evaluation** — After all checks complete, if `thresholds.maxLatencyMs` is set and any check's `durationMs` exceeds it, set overall status to `degraded` (the check itself still passes, but the report reflects the latency violation). | Status: not_done

- [ ] **Implement client creation** — Create an MCP `Client` instance with `clientInfo` (defaulting to `{ name: 'mcp-healthcheck', version: '<package version>' }`). | Status: not_done

- [ ] **Implement resource cleanup in finally block** — Always call `client.close()` in a `finally` block. For stdio transports, terminate the subprocess: send `SIGTERM`, wait up to 5 seconds, then `SIGKILL` if still running. Ensure no zombie processes. | Status: not_done

---

## Phase 6: Report Builder

- [ ] **Implement status computation** — In `src/report-builder.ts`, compute overall `HealthStatus` from check results: all passed = `'healthy'`, any required check failed = `'unhealthy'`, only optional checks or latency thresholds failed = `'degraded'`. | Status: not_done

- [ ] **Implement summary computation** — Count `total`, `passed`, `failed`, and `skipped` checks from the results array. | Status: not_done

- [ ] **Implement timestamp generation** — Generate an ISO 8601 timestamp (`new Date().toISOString()`) for the `timestamp` field. | Status: not_done

- [ ] **Populate server info** — Extract `name`, `version`, and `protocolVersion` from the initialize check result (if it passed) and populate `HealthReport.server`. | Status: not_done

- [ ] **Compute totalMs** — Measure wall-clock time from the start to end of `checkHealth()` and set `totalMs`. | Status: not_done

- [ ] **Assemble and return HealthReport** — Combine all fields into the final `HealthReport` object and return it. | Status: not_done

---

## Phase 7: Main API (`checkHealth` and helpers)

- [ ] **Implement checkHealth function** — In `src/index.ts`, implement the main `checkHealth(options: HealthCheckOptions): Promise<HealthReport>` function. Wire together transport factory, check runner, and report builder. Ensure it never throws; all errors are captured in the report. | Status: not_done

- [ ] **Apply default values** — Apply defaults for all optional fields: `timeout` (30000), `checkTimeout` (10000), `skip` ([]), `thresholds` ({}), `customChecks` ([]), `clientInfo` ({ name: 'mcp-healthcheck', version from package.json }). | Status: not_done

- [ ] **Implement isHealthy helper** — Export `isHealthy(options): Promise<boolean>` that calls `checkHealth` and returns `report.status === 'healthy'`. | Status: not_done

- [ ] **Implement createHttpHandler helper** — Export `createHttpHandler(options): (req, res) => void` that creates an HTTP request handler. On `GET`, run `checkHealth` and respond with `200` (healthy/degraded) or `503` (unhealthy) with `Content-Type: application/json` and the `HealthReport` body. On any other method, respond with `405 Method Not Allowed`. | Status: not_done

- [ ] **Configure public exports** — In `src/index.ts`, export `checkHealth`, `isHealthy`, `createHttpHandler`, and all public types (`HealthCheckOptions`, `HealthReport`, `HealthStatus`, `CheckResult`, `TransportConfig`, `StdioTransportConfig`, `HttpTransportConfig`, `SseTransportConfig`, `Thresholds`, `CustomCheckFn`, `CustomCheckResult`, etc.). | Status: not_done

---

## Phase 8: CLI Implementation

- [ ] **Implement CLI argument parsing** — In `src/cli.ts`, use Node.js built-in `util.parseArgs` to parse CLI flags. Define all transport flags (`--stdio`, `--url`, `--sse`), transport options (`--header`, `--cwd`, `--env`), check options (`--timeout`, `--check-timeout`, `--skip`, `--min-tools`, `--max-tools`, `--min-resources`, `--min-prompts`, `--max-latency`), output options (`--format`, `--quiet`, `--verbose`), and meta flags (`--version`, `--help`). | Status: not_done

- [ ] **Implement environment variable fallback** — Read environment variables (`MCP_HEALTHCHECK_STDIO`, `MCP_HEALTHCHECK_URL`, `MCP_HEALTHCHECK_SSE`, `MCP_HEALTHCHECK_TIMEOUT`, `MCP_HEALTHCHECK_CHECK_TIMEOUT`, `MCP_HEALTHCHECK_FORMAT`, `MCP_HEALTHCHECK_MIN_TOOLS`, `MCP_HEALTHCHECK_MAX_TOOLS`, `MCP_HEALTHCHECK_MIN_RESOURCES`, `MCP_HEALTHCHECK_MIN_PROMPTS`, `MCP_HEALTHCHECK_MAX_LATENCY`, `MCP_HEALTHCHECK_SKIP`). Explicit flags override env vars. | Status: not_done

- [ ] **Implement transport config construction from CLI args** — Parse `--stdio <command>` into a `StdioTransportConfig` (split command string into command and args). Parse `--url <url>` into `HttpTransportConfig`. Parse `--sse <url>` into `SseTransportConfig`. Validate that exactly one transport is specified. | Status: not_done

- [ ] **Implement repeatable flag handling** — Handle `--header` (repeatable, parse `key:value`), `--skip` (repeatable), and `--env` (repeatable, parse `key=value`). | Status: not_done

- [ ] **Implement --help flag** — Print the full usage text as specified in the spec and exit with code 0. | Status: not_done

- [ ] **Implement --version flag** — Read the version from `package.json` and print it. Exit with code 0. | Status: not_done

- [ ] **Implement CLI validation** — Validate inputs: exactly one transport flag must be present; `--header` and `--cwd`/`--env` are only valid with their respective transports; numeric flags must be valid positive integers. Exit with code 2 and a descriptive error message on validation failure. | Status: not_done

- [ ] **Map CLI args to HealthCheckOptions** — Construct a `HealthCheckOptions` object from parsed CLI arguments and call `checkHealth()`. | Status: not_done

- [ ] **Implement human-readable output format** — Format the `HealthReport` as human-readable terminal output matching the spec example: header with version, target line, status, per-check rows with PASS/FAIL/SKIP indicators, duration, and message. Summary line at the end. | Status: not_done

- [ ] **Implement verbose output mode** — In `--verbose` mode, show detailed check information including tool names, resource URIs, prompt names, capability details, and full error information. | Status: not_done

- [ ] **Implement JSON output format** — With `--format json`, output the `HealthReport` as a JSON string to stdout. No additional formatting. | Status: not_done

- [ ] **Implement --quiet mode** — Suppress all stdout output. Only the exit code communicates the result. | Status: not_done

- [ ] **Implement exit codes** — Exit with code 0 (healthy), 1 (unhealthy), 2 (configuration error), or 3 (degraded) based on the report status and CLI validation. | Status: not_done

---

## Phase 9: Error Handling and Edge Cases

- [ ] **Ensure checkHealth never throws** — Wrap the entire `checkHealth` function body in a try/catch. Any unexpected error produces an unhealthy report with error code `UNKNOWN_ERROR`. | Status: not_done

- [ ] **Handle subprocess cleanup on error** — For stdio transports, ensure subprocess is terminated in the `finally` block: `SIGTERM` first, then `SIGKILL` after 5 seconds if still running. Check `child.exitCode === null` before sending signals. | Status: not_done

- [ ] **Handle AbortSignal already aborted** — If the provided `signal` is already aborted when `checkHealth` is called, return an unhealthy report immediately with error code `ABORTED`. | Status: not_done

- [ ] **Handle paginated tool/resource/prompt lists** — Correctly follow `nextCursor` in `listTools`, `listResources`, and `listPrompts` responses until cursor is undefined. Accumulate all items across pages. | Status: not_done

- [ ] **Handle server declaring capability but throwing MethodNotFound** — If the server declares `tools` capability but `listTools()` throws a `MethodNotFound` JSON-RPC error, record it as a failure with `PROTOCOL_ERROR`. | Status: not_done

- [ ] **Handle concurrent check cancellation** — When overall timeout fires while a per-check timeout is active, ensure both are properly cleaned up and only one failure is recorded for that check. | Status: not_done

- [ ] **Prevent resource leaks on multiple sequential calls** — Ensure each `checkHealth` call is fully self-contained: transport created and destroyed, client created and closed, all timers cleared. No shared state between calls. | Status: not_done

---

## Phase 10: Unit Tests

### Transport Factory Tests

- [ ] **Test stdio transport creation** — Verify `createTransport` creates a `StdioClientTransport` when given a `StdioTransportConfig`. Verify `command`, `args`, `env`, and `cwd` are passed correctly. | Status: not_done

- [ ] **Test HTTP transport creation** — Verify `createTransport` creates a `StreamableHTTPClientTransport` when given an `HttpTransportConfig`. Verify `url` and `headers` are applied. | Status: not_done

- [ ] **Test SSE transport creation** — Verify `createTransport` creates an `SSEClientTransport` when given an `SseTransportConfig`. Verify `url` and `headers` are applied. | Status: not_done

- [ ] **Test URL validation** — Verify that an invalid URL in HTTP/SSE config throws a descriptive error. | Status: not_done

### Check Runner Tests

- [ ] **Test check sequencing** — Mock the client and verify checks execute in order: connect, initialize, tools, resources, prompts, custom. | Status: not_done

- [ ] **Test per-check timeout enforcement** — Mock a check that hangs indefinitely. Verify it is terminated after `checkTimeout` ms with error code `CHECK_TIMEOUT`. | Status: not_done

- [ ] **Test overall timeout enforcement** — Set a short overall timeout with multiple checks. Verify that remaining checks are skipped with `OVERALL_TIMEOUT` when the master timer fires. | Status: not_done

- [ ] **Test skip behavior** — Set `skip: ['tools', 'prompts']`. Verify those checks are not executed and `summary.skipped` reflects the correct count. | Status: not_done

- [ ] **Test auto-skip when capabilities are missing** — Mock a server that does not declare `resources` capability. Verify the resources check is auto-skipped with `passed: true`. | Status: not_done

- [ ] **Test dependency failure propagation** — Make the `connect` check fail. Verify all subsequent checks are skipped with appropriate messages. | Status: not_done

- [ ] **Test AbortSignal cancellation** — Create an AbortController and abort it mid-check. Verify the health check returns immediately with `ABORTED`. | Status: not_done

### Individual Check Tests

- [ ] **Test connect check success (stdio)** — Mock a successful subprocess spawn. Verify `passed: true` and `details.transportType === 'stdio'`. | Status: not_done

- [ ] **Test connect check failure (ENOENT)** — Mock a command-not-found error. Verify `passed: false` and `error.code === 'SPAWN_ERROR'`. | Status: not_done

- [ ] **Test connect check failure (ECONNREFUSED)** — Mock a connection refused error for HTTP. Verify `passed: false` and `error.code === 'TRANSPORT_ERROR'`. | Status: not_done

- [ ] **Test initialize check success** — Mock a successful handshake response. Verify `passed: true` and extracted `protocolVersion`, `serverName`, `serverVersion`, `capabilities`. | Status: not_done

- [ ] **Test initialize check failure (handshake error)** — Mock a JSON-RPC error response. Verify `passed: false` and `error.code === 'HANDSHAKE_ERROR'`. | Status: not_done

- [ ] **Test tools check success** — Mock `listTools()` returning 3 tools. Verify `toolCount: 3` and correct `toolNames`. | Status: not_done

- [ ] **Test tools check with pagination** — Mock paginated `listTools()` with 2 pages. Verify all tools across pages are accumulated. | Status: not_done

- [ ] **Test tools check threshold failure (minTools)** — Set `minTools: 5` but return 3 tools. Verify `passed: false` and `error.code === 'THRESHOLD_VIOLATION'`. | Status: not_done

- [ ] **Test tools check threshold failure (maxTools)** — Set `maxTools: 2` but return 3 tools. Verify `passed: false` and `error.code === 'THRESHOLD_VIOLATION'`. | Status: not_done

- [ ] **Test resources check success** — Mock `listResources()` returning 2 resources. Verify counts and URIs. | Status: not_done

- [ ] **Test resources check threshold failure** — Set `minResources: 3` but return 1. Verify failure with `THRESHOLD_VIOLATION`. | Status: not_done

- [ ] **Test prompts check success** — Mock `listPrompts()` returning prompts. Verify counts and names. | Status: not_done

- [ ] **Test prompts check threshold failure** — Set `minPrompts: 2` but return 0. Verify failure. | Status: not_done

- [ ] **Test custom check success** — Provide a custom check that returns `{ passed: true, message: 'ok' }`. Verify it appears in the report. | Status: not_done

- [ ] **Test custom check failure (required)** — Provide a required custom check that fails. Verify overall status is `unhealthy`. | Status: not_done

- [ ] **Test custom check failure (optional)** — Provide an optional custom check that fails. Verify overall status is `degraded`. | Status: not_done

- [ ] **Test custom check throws exception** — Provide a custom check that throws. Verify it is recorded as a failure with `CUSTOM_CHECK_ERROR`. | Status: not_done

- [ ] **Test custom check throws synchronous exception** — Verify synchronous throws in custom check functions are properly caught. | Status: not_done

### Report Builder Tests

- [ ] **Test all-passed produces healthy status** — Provide all-passing check results. Verify `status === 'healthy'`. | Status: not_done

- [ ] **Test required failure produces unhealthy status** — Include a failed required check. Verify `status === 'unhealthy'`. | Status: not_done

- [ ] **Test optional failure produces degraded status** — Include only optional/latency failures. Verify `status === 'degraded'`. | Status: not_done

- [ ] **Test summary counts** — Verify `total`, `passed`, `failed`, and `skipped` are correctly computed. | Status: not_done

- [ ] **Test timestamp format** — Verify `timestamp` is a valid ISO 8601 string. | Status: not_done

- [ ] **Test server info population** — Verify `server` field is populated from the initialize check result. | Status: not_done

### Threshold Tests

- [ ] **Test maxLatencyMs threshold** — Set `maxLatencyMs: 100` and have a check take 200ms. Verify overall status is `degraded` but the check itself passes. | Status: not_done

- [ ] **Test minTools threshold at boundary** — Set `minTools: 3` and return exactly 3 tools. Verify the check passes. | Status: not_done

- [ ] **Test maxTools threshold at boundary** — Set `maxTools: 3` and return exactly 3 tools. Verify the check passes. | Status: not_done

### CLI Tests

- [ ] **Test --stdio flag parsing** — Verify `--stdio 'node ./server.js'` is correctly parsed into a `StdioTransportConfig`. | Status: not_done

- [ ] **Test --url flag parsing** — Verify `--url https://example.com/mcp` is parsed into `HttpTransportConfig`. | Status: not_done

- [ ] **Test --sse flag parsing** — Verify `--sse http://localhost:3000/sse` is parsed into `SseTransportConfig`. | Status: not_done

- [ ] **Test no transport flag exits with code 2** — Verify CLI exits with code 2 and error message when no transport flag is provided. | Status: not_done

- [ ] **Test multiple transport flags exits with code 2** — Verify CLI exits with code 2 when both `--stdio` and `--url` are provided. | Status: not_done

- [ ] **Test --header parsing** — Verify `--header 'Authorization:Bearer token'` is parsed correctly. Test with multiple `--header` flags. | Status: not_done

- [ ] **Test --env parsing** — Verify `--env 'KEY=value'` is parsed correctly. Test with multiple `--env` flags. | Status: not_done

- [ ] **Test --skip parsing** — Verify `--skip tools --skip prompts` produces `skip: ['tools', 'prompts']`. | Status: not_done

- [ ] **Test environment variable fallback** — Set `MCP_HEALTHCHECK_URL` env var, run CLI without `--url` flag, and verify it uses the env var value. | Status: not_done

- [ ] **Test flag precedence over env vars** — Set `MCP_HEALTHCHECK_TIMEOUT=5000` and pass `--timeout 3000`. Verify `timeout` is `3000`. | Status: not_done

- [ ] **Test MCP_HEALTHCHECK_SKIP comma separation** — Set `MCP_HEALTHCHECK_SKIP=tools,prompts`. Verify both are skipped. | Status: not_done

- [ ] **Test human output formatting** — Verify human-readable output matches the spec format: header, target, status, check rows with PASS/FAIL indicators, summary. | Status: not_done

- [ ] **Test JSON output formatting** — Verify `--format json` outputs valid JSON matching the `HealthReport` structure. | Status: not_done

- [ ] **Test --quiet suppresses output** — Verify no stdout output in quiet mode. | Status: not_done

- [ ] **Test exit code 0 for healthy** — Run CLI against a healthy mock server. Verify exit code 0. | Status: not_done

- [ ] **Test exit code 1 for unhealthy** — Run CLI against a failing server. Verify exit code 1. | Status: not_done

- [ ] **Test exit code 2 for config error** — Provide invalid flags. Verify exit code 2. | Status: not_done

- [ ] **Test exit code 3 for degraded** — Run CLI against a server that triggers degraded status. Verify exit code 3. | Status: not_done

---

## Phase 11: Integration Tests

- [ ] **Create a minimal test MCP server** — Build a simple MCP server (using `@modelcontextprotocol/sdk` `McpServer`) that registers a few tools, resources, and prompts. Bundle it with the test suite for use in integration tests. | Status: not_done

- [ ] **Integration test: healthy stdio server** — Spawn the test server via stdio, run `checkHealth`, assert `status === 'healthy'`, verify tool/resource/prompt counts and names match. | Status: not_done

- [ ] **Integration test: server that crashes on startup** — Spawn a command that immediately exits with code 1. Assert `status === 'unhealthy'` and the connect check fails with `SPAWN_ERROR` or `TRANSPORT_ERROR`. | Status: not_done

- [ ] **Integration test: server that hangs during handshake** — Start a server that reads stdin but never responds. Set a short `checkTimeout`. Assert `initialize` check fails with `CHECK_TIMEOUT`. | Status: not_done

- [ ] **Integration test: server with no tools** — Start a minimal server that declares `tools` capability but returns empty tools list. Verify `toolCount: 0`. Verify it fails when `minTools: 1` is set. | Status: not_done

- [ ] **Integration test: server that does not declare resources** — Start a server without resources capability. Verify resources check is auto-skipped with `passed: true`. | Status: not_done

- [ ] **Integration test: threshold violations** — Run against the test server with various threshold settings and verify correct pass/fail outcomes. | Status: not_done

- [ ] **Integration test: custom check with real client** — Run a custom check that calls `client.listTools()` and verifies a specific tool exists. | Status: not_done

- [ ] **Integration test: AbortSignal cancellation** — Start a slow server, create an AbortController, abort after 500ms, verify early return with `ABORTED`. | Status: not_done

- [ ] **Integration test: overall timeout** — Set a very short overall timeout (e.g., 100ms) against a slow server. Verify remaining checks are skipped with `OVERALL_TIMEOUT`. | Status: not_done

- [ ] **Integration test: no zombie processes** — Run a stdio health check, verify the subprocess is fully terminated after `checkHealth` returns. Check no orphan processes remain. | Status: not_done

- [ ] **Integration test: multiple sequential checkHealth calls** — Call `checkHealth` 3 times in sequence against the same server config. Verify no resource leaks, all calls return complete reports. | Status: not_done

---

## Phase 12: HTTP Handler Tests

- [ ] **Test createHttpHandler returns 200 for healthy server** — Mock a healthy `checkHealth` result. Send a GET request. Verify 200 status, `application/json` content type, and valid `HealthReport` body. | Status: not_done

- [ ] **Test createHttpHandler returns 200 for degraded server** — Mock a degraded result. Verify 200 status. | Status: not_done

- [ ] **Test createHttpHandler returns 503 for unhealthy server** — Mock an unhealthy result. Verify 503 status with `HealthReport` body. | Status: not_done

- [ ] **Test createHttpHandler returns 405 for non-GET methods** — Send POST, PUT, DELETE requests. Verify 405 response. | Status: not_done

---

## Phase 13: `isHealthy` Helper Tests

- [ ] **Test isHealthy returns true for healthy** — Mock `checkHealth` returning a healthy report. Verify `isHealthy` returns `true`. | Status: not_done

- [ ] **Test isHealthy returns false for unhealthy** — Mock `checkHealth` returning an unhealthy report. Verify `isHealthy` returns `false`. | Status: not_done

- [ ] **Test isHealthy returns false for degraded** — Mock `checkHealth` returning a degraded report. Verify `isHealthy` returns `false` (only `healthy` is true). | Status: not_done

---

## Phase 14: Edge Case Tests

- [ ] **Test paginated tools across multiple pages** — Mock `listTools` returning tools with `nextCursor` on the first call and more tools on the second. Verify all tools are collected. | Status: not_done

- [ ] **Test server declares tools but listTools throws MethodNotFound** — Verify check fails with `PROTOCOL_ERROR`. | Status: not_done

- [ ] **Test server does not declare resources — auto-skip** — Verify resources check produces `passed: true` with auto-skip message. | Status: not_done

- [ ] **Test custom check returns rejected promise** — Verify treated as failure with `CUSTOM_CHECK_ERROR`. | Status: not_done

- [ ] **Test AbortSignal triggered mid-check** — Abort while a check is in progress. Verify immediate return. | Status: not_done

- [ ] **Test overall timeout fires while per-check timeout is active** — Verify only one failure is recorded and cleanup runs. | Status: not_done

- [ ] **Test stdio server writes garbage to stdout before JSON-RPC** — Verify the health check handles non-JSON output gracefully. | Status: not_done

- [ ] **Test HTTP URL returning HTML instead of JSON-RPC** — Verify connect or initialize check fails appropriately. | Status: not_done

---

## Phase 15: Documentation

- [ ] **Write README.md** — Create a comprehensive README covering: overview, installation, quick-start examples (stdio, HTTP, SSE), API reference for `checkHealth`, `isHealthy`, and `createHttpHandler`, CLI usage with all flags, environment variables, exit codes, threshold configuration, custom checks, Kubernetes probe example, CI pipeline example, and links to the SPEC.md. | Status: not_done

- [ ] **Add JSDoc comments to all public exports** — Add JSDoc to `checkHealth`, `isHealthy`, `createHttpHandler`, and all exported types/interfaces. Include parameter descriptions, return types, default values, and usage examples. | Status: not_done

- [ ] **Add inline code comments for non-obvious logic** — Document the connect/initialize split logic, timeout composition, subprocess cleanup strategy, and error classification logic with clear inline comments. | Status: not_done

---

## Phase 16: Build and Publish Preparation

- [ ] **Verify TypeScript compilation** — Run `npm run build` and verify it produces correct output in `dist/` with `.js`, `.d.ts`, and `.d.ts.map` files for all modules. | Status: not_done

- [ ] **Verify CLI executable after build** — Run `node dist/cli.js --help` and verify it prints usage. Run `node dist/cli.js --version` and verify it prints the version. | Status: not_done

- [ ] **Verify lint passes** — Run `npm run lint` and fix any issues. | Status: not_done

- [ ] **Verify all tests pass** — Run `npm run test` and ensure 100% pass rate. | Status: not_done

- [ ] **Bump version in package.json** — Set version to `0.1.0` (or appropriate initial version) in `package.json`. | Status: not_done

- [ ] **Verify package contents** — Run `npm pack --dry-run` and verify only `dist/` files are included. No source files, test files, or unnecessary files should be in the published package. | Status: not_done

- [ ] **Verify peer dependency declaration** — Ensure `package.json` declares `"peerDependencies": { "@modelcontextprotocol/sdk": "^1.12.0" }`. | Status: not_done

- [ ] **Test npx invocation** — After building, verify `npx . --help` works correctly from the project root. | Status: not_done
