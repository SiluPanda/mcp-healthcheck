import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CheckResult, Thresholds } from './types.js';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}

export async function runConnectCheck(
  client: Client,
  transport: unknown,
  timeoutMs: number
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await withTimeout(
      client.connect(transport as Parameters<typeof client.connect>[0]),
      timeoutMs,
      'connect',
    );
    return {
      name: 'connect',
      passed: true,
      durationMs: Date.now() - start,
      message: 'Connected to MCP server successfully',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.toLowerCase().includes('spawn') ? 'SPAWN_ERROR' : 'TRANSPORT_ERROR';
    return {
      name: 'connect',
      passed: false,
      durationMs: Date.now() - start,
      message: `Failed to connect: ${msg}`,
      error: { code, message: msg },
    };
  }
}

export async function runInitializeCheck(
  client: Client,
  _clientInfo: { name: string; version: string },
  _timeoutMs: number
): Promise<{ result: CheckResult; serverInfo?: { name: string; version: string; protocolVersion: string } }> {
  const start = Date.now();
  // The SDK automatically initializes during connect(); here we just verify the server version is available.
  try {
    const serverVersion = client.getServerVersion();
    const durationMs = Date.now() - start;
    if (!serverVersion) {
      return {
        result: {
          name: 'initialize',
          passed: false,
          durationMs,
          message: 'Server version not available after connect',
          error: { code: 'INITIALIZE_ERROR', message: 'No server version returned' },
        },
      };
    }
    return {
      result: {
        name: 'initialize',
        passed: true,
        durationMs,
        message: `Initialized with server ${serverVersion.name} v${serverVersion.version}`,
        details: { name: serverVersion.name, version: serverVersion.version },
      },
      serverInfo: {
        name: serverVersion.name,
        version: serverVersion.version,
        protocolVersion: '',
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: {
        name: 'initialize',
        passed: false,
        durationMs: Date.now() - start,
        message: `Initialization failed: ${msg}`,
        error: { code: 'INITIALIZE_ERROR', message: msg },
      },
    };
  }
}

export async function runToolsCheck(
  client: Client,
  thresholds: Thresholds | undefined,
  timeoutMs: number
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(client.listTools(), timeoutMs, 'tools/list');
    const tools = response.tools ?? [];
    const toolCount = tools.length;
    const toolNames = tools.map((t) => t.name);
    const durationMs = Date.now() - start;

    if (thresholds?.minTools !== undefined && toolCount < thresholds.minTools) {
      return {
        name: 'tools',
        passed: false,
        durationMs,
        message: `Tool count ${toolCount} is below minimum ${thresholds.minTools}`,
        error: { code: 'THRESHOLD_VIOLATION', message: `Expected at least ${thresholds.minTools} tools, got ${toolCount}` },
        details: { toolCount, toolNames },
      };
    }
    if (thresholds?.maxTools !== undefined && toolCount > thresholds.maxTools) {
      return {
        name: 'tools',
        passed: false,
        durationMs,
        message: `Tool count ${toolCount} exceeds maximum ${thresholds.maxTools}`,
        error: { code: 'THRESHOLD_VIOLATION', message: `Expected at most ${thresholds.maxTools} tools, got ${toolCount}` },
        details: { toolCount, toolNames },
      };
    }

    return {
      name: 'tools',
      passed: true,
      durationMs,
      message: `Listed ${toolCount} tool(s)`,
      details: { toolCount, toolNames },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'tools',
      passed: false,
      durationMs: Date.now() - start,
      message: `tools/list failed: ${msg}`,
      error: { code: 'LIST_ERROR', message: msg },
    };
  }
}

export async function runResourcesCheck(
  client: Client,
  thresholds: Thresholds | undefined,
  timeoutMs: number
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(client.listResources(), timeoutMs, 'resources/list');
    const resources = response.resources ?? [];
    const resourceCount = resources.length;
    const resourceUris = resources.map((r) => r.uri);
    const durationMs = Date.now() - start;

    if (thresholds?.minResources !== undefined && resourceCount < thresholds.minResources) {
      return {
        name: 'resources',
        passed: false,
        durationMs,
        message: `Resource count ${resourceCount} is below minimum ${thresholds.minResources}`,
        error: { code: 'THRESHOLD_VIOLATION', message: `Expected at least ${thresholds.minResources} resources, got ${resourceCount}` },
        details: { resourceCount, resourceUris },
      };
    }

    return {
      name: 'resources',
      passed: true,
      durationMs,
      message: `Listed ${resourceCount} resource(s)`,
      details: { resourceCount, resourceUris },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'resources',
      passed: false,
      durationMs: Date.now() - start,
      message: `resources/list failed: ${msg}`,
      error: { code: 'LIST_ERROR', message: msg },
    };
  }
}

export async function runPromptsCheck(
  client: Client,
  thresholds: Thresholds | undefined,
  timeoutMs: number
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(client.listPrompts(), timeoutMs, 'prompts/list');
    const prompts = response.prompts ?? [];
    const promptCount = prompts.length;
    const promptNames = prompts.map((p) => p.name);
    const durationMs = Date.now() - start;

    if (thresholds?.minPrompts !== undefined && promptCount < thresholds.minPrompts) {
      return {
        name: 'prompts',
        passed: false,
        durationMs,
        message: `Prompt count ${promptCount} is below minimum ${thresholds.minPrompts}`,
        error: { code: 'THRESHOLD_VIOLATION', message: `Expected at least ${thresholds.minPrompts} prompts, got ${promptCount}` },
        details: { promptCount, promptNames },
      };
    }

    return {
      name: 'prompts',
      passed: true,
      durationMs,
      message: `Listed ${promptCount} prompt(s)`,
      details: { promptCount, promptNames },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'prompts',
      passed: false,
      durationMs: Date.now() - start,
      message: `prompts/list failed: ${msg}`,
      error: { code: 'LIST_ERROR', message: msg },
    };
  }
}
