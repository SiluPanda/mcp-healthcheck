import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkHealth, isHealthy } from '../health.js';
import type { HealthCheckOptions } from '../types.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn().mockResolvedValue({ tools: [{ name: 'tool1' }, { name: 'tool2' }] });
const mockListResources = vi.fn().mockResolvedValue({ resources: [{ uri: 'file://a' }] });
const mockListPrompts = vi.fn().mockResolvedValue({ prompts: [{ name: 'prompt1' }] });
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockGetServerVersion = vi.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' });

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return {
      connect: mockConnect,
      listTools: mockListTools,
      listResources: mockListResources,
      listPrompts: mockListPrompts,
      close: mockClose,
      getServerVersion: mockGetServerVersion,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function () {
    return { close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return { close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(function () {
    return { close: vi.fn().mockResolvedValue(undefined) };
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const stdioOptions: HealthCheckOptions = {
  transport: { type: 'stdio', command: 'node', args: ['./server.js'] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockListTools.mockResolvedValue({ tools: [{ name: 'tool1' }, { name: 'tool2' }] });
  mockListResources.mockResolvedValue({ resources: [{ uri: 'file://a' }] });
  mockListPrompts.mockResolvedValue({ prompts: [{ name: 'prompt1' }] });
  mockGetServerVersion.mockReturnValue({ name: 'test-server', version: '1.0.0' });
});

describe('checkHealth()', () => {
  it('returns a healthy report when all checks pass', async () => {
    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('healthy');
    expect(report.totalMs).toBeGreaterThanOrEqual(0);
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.checks).toHaveLength(5); // connect, initialize, tools, resources, prompts
    expect(report.summary.passed).toBe(5);
    expect(report.summary.failed).toBe(0);
  });

  it('includes server info in the report', async () => {
    const report = await checkHealth(stdioOptions);
    expect(report.server).toEqual({
      name: 'test-server',
      version: '1.0.0',
      protocolVersion: '',
    });
  });

  it('returns unhealthy when connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('unhealthy');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].name).toBe('connect');
    expect(report.checks[0].passed).toBe(false);
    expect(report.checks[0].error?.code).toBe('TRANSPORT_ERROR');
  });

  it('returns unhealthy when spawn fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('spawn ENOENT'));

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('unhealthy');
    expect(report.checks[0].error?.code).toBe('SPAWN_ERROR');
  });

  it('returns unhealthy when getServerVersion returns undefined', async () => {
    mockGetServerVersion.mockReturnValueOnce(undefined);

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('unhealthy');
    const initCheck = report.checks.find((c) => c.name === 'initialize');
    expect(initCheck?.passed).toBe(false);
  });

  it('counts all capability checks as skipped when init fails', async () => {
    mockGetServerVersion.mockReturnValue(undefined);

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('unhealthy');
    // Tools, resources, prompts are all skipped because init failed = 3
    expect(report.summary.skipped).toBe(3);
    expect(report.summary.total).toBe(report.checks.length + 3);
  });

  it('skips tools check when skip includes "tools"', async () => {
    const report = await checkHealth({ ...stdioOptions, skip: ['tools'] });

    expect(report.checks.find((c) => c.name === 'tools')).toBeUndefined();
    expect(report.checks).toHaveLength(4); // connect, initialize, resources, prompts
    expect(report.summary.skipped).toBe(1);
  });

  it('skips resources check when skip includes "resources"', async () => {
    const report = await checkHealth({ ...stdioOptions, skip: ['resources'] });

    expect(report.checks.find((c) => c.name === 'resources')).toBeUndefined();
    expect(report.summary.skipped).toBe(1);
  });

  it('skips prompts check when skip includes "prompts"', async () => {
    const report = await checkHealth({ ...stdioOptions, skip: ['prompts'] });

    expect(report.checks.find((c) => c.name === 'prompts')).toBeUndefined();
    expect(report.summary.skipped).toBe(1);
  });

  it('skips all three capability checks', async () => {
    const report = await checkHealth({ ...stdioOptions, skip: ['tools', 'resources', 'prompts'] });

    expect(report.checks).toHaveLength(2); // connect, initialize
    expect(report.summary.skipped).toBe(3);
    expect(report.status).toBe('healthy');
  });

  it('returns degraded when tools check fails threshold', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      thresholds: { minTools: 10 },
    });

    expect(report.status).toBe('degraded');
    const toolsCheck = report.checks.find((c) => c.name === 'tools');
    expect(toolsCheck?.passed).toBe(false);
    expect(toolsCheck?.error?.code).toBe('THRESHOLD_VIOLATION');
  });

  it('applies maxTools threshold correctly', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      thresholds: { maxTools: 1 },
    });

    expect(report.status).toBe('degraded');
    const toolsCheck = report.checks.find((c) => c.name === 'tools');
    expect(toolsCheck?.passed).toBe(false);
    expect(toolsCheck?.error?.code).toBe('THRESHOLD_VIOLATION');
  });

  it('applies minResources threshold', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      thresholds: { minResources: 5 },
    });

    expect(report.status).toBe('degraded');
    const resourcesCheck = report.checks.find((c) => c.name === 'resources');
    expect(resourcesCheck?.passed).toBe(false);
  });

  it('applies minPrompts threshold', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      thresholds: { minPrompts: 5 },
    });

    expect(report.status).toBe('degraded');
    const promptsCheck = report.checks.find((c) => c.name === 'prompts');
    expect(promptsCheck?.passed).toBe(false);
  });

  it('includes tool names in tools check details', async () => {
    const report = await checkHealth(stdioOptions);

    const toolsCheck = report.checks.find((c) => c.name === 'tools');
    expect(toolsCheck?.details?.toolNames).toEqual(['tool1', 'tool2']);
    expect(toolsCheck?.details?.toolCount).toBe(2);
  });

  it('includes resource uris in resources check details', async () => {
    const report = await checkHealth(stdioOptions);

    const resourcesCheck = report.checks.find((c) => c.name === 'resources');
    expect(resourcesCheck?.details?.resourceUris).toEqual(['file://a']);
    expect(resourcesCheck?.details?.resourceCount).toBe(1);
  });

  it('includes prompt names in prompts check details', async () => {
    const report = await checkHealth(stdioOptions);

    const promptsCheck = report.checks.find((c) => c.name === 'prompts');
    expect(promptsCheck?.details?.promptNames).toEqual(['prompt1']);
    expect(promptsCheck?.details?.promptCount).toBe(1);
  });

  it('runs custom checks and includes them in the report', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      customChecks: [
        {
          name: 'my-custom-check',
          fn: async (_client) => ({ passed: true, message: 'Custom OK', details: { foo: 'bar' } }),
        },
      ],
    });

    expect(report.status).toBe('healthy');
    const custom = report.checks.find((c) => c.name === 'my-custom-check');
    expect(custom?.passed).toBe(true);
    expect(custom?.message).toBe('Custom OK');
    expect(custom?.details?.foo).toBe('bar');
  });

  it('handles failed custom checks and sets degraded status', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      customChecks: [
        {
          name: 'failing-custom',
          fn: async (_client) => ({ passed: false, message: 'Custom failed' }),
        },
      ],
    });

    expect(report.status).toBe('degraded');
    const custom = report.checks.find((c) => c.name === 'failing-custom');
    expect(custom?.passed).toBe(false);
  });

  it('handles custom check that throws', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      customChecks: [
        {
          name: 'throws-custom',
          fn: async (_client) => { throw new Error('boom'); },
        },
      ],
    });

    expect(report.status).toBe('degraded');
    const custom = report.checks.find((c) => c.name === 'throws-custom');
    expect(custom?.passed).toBe(false);
    expect(custom?.error?.code).toBe('CUSTOM_CHECK_ERROR');
  });

  it('handles listTools failure gracefully', async () => {
    mockListTools.mockRejectedValueOnce(new Error('tools/list not supported'));

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('degraded');
    const toolsCheck = report.checks.find((c) => c.name === 'tools');
    expect(toolsCheck?.passed).toBe(false);
    expect(toolsCheck?.error?.code).toBe('LIST_ERROR');
  });

  it('handles listResources failure gracefully', async () => {
    mockListResources.mockRejectedValueOnce(new Error('resources/list not supported'));

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('degraded');
    const check = report.checks.find((c) => c.name === 'resources');
    expect(check?.passed).toBe(false);
  });

  it('handles listPrompts failure gracefully', async () => {
    mockListPrompts.mockRejectedValueOnce(new Error('prompts/list not supported'));

    const report = await checkHealth(stdioOptions);

    expect(report.status).toBe('degraded');
    const check = report.checks.find((c) => c.name === 'prompts');
    expect(check?.passed).toBe(false);
  });

  it('works with http transport config', async () => {
    const report = await checkHealth({
      transport: { type: 'http', url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer token' } },
    });

    expect(report.status).toBe('healthy');
  });

  it('works with sse transport config', async () => {
    const report = await checkHealth({
      transport: { type: 'sse', url: 'http://localhost:3000/sse' },
    });

    expect(report.status).toBe('healthy');
  });

  it('throws when transport is missing', async () => {
    await expect(
      checkHealth({ transport: undefined as never })
    ).rejects.toThrow('options.transport is required');
  });

  it('uses default client info when not provided', async () => {
    const report = await checkHealth(stdioOptions);
    expect(report.status).toBe('healthy');
  });

  it('accepts custom clientInfo', async () => {
    const report = await checkHealth({
      ...stdioOptions,
      clientInfo: { name: 'my-app', version: '2.0.0' },
    });
    expect(report.status).toBe('healthy');
  });
});

describe('isHealthy()', () => {
  it('returns true when report status is healthy', async () => {
    const result = await isHealthy(stdioOptions);
    expect(result).toBe(true);
  });

  it('returns false when connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('refused'));
    const result = await isHealthy(stdioOptions);
    expect(result).toBe(false);
  });

  it('returns false when degraded', async () => {
    const result = await isHealthy({ ...stdioOptions, thresholds: { minTools: 100 } });
    expect(result).toBe(false);
  });
});
