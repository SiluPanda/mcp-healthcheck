import type { HealthCheckOptions, HealthReport, HealthStatus, CheckResult } from './types.js';
import { createConnectedClient } from './transport.js';
import {
  runConnectCheck,
  runInitializeCheck,
  runToolsCheck,
  runResourcesCheck,
  runPromptsCheck,
} from './checks.js';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CHECK_TIMEOUT = 10_000;
const DEFAULT_CLIENT_INFO = { name: 'mcp-healthcheck', version: '0.2.0' };

function computeStatus(checks: CheckResult[], connectPassed: boolean, initPassed: boolean): HealthStatus {
  if (!connectPassed || !initPassed) {
    return 'unhealthy';
  }
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) {
    return 'healthy';
  }
  return 'degraded';
}

function makeSummary(checks: CheckResult[], skippedCount: number) {
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  return { total: checks.length + skippedCount, passed, failed, skipped: skippedCount };
}

function makeUnhealthyReport(
  startMs: number,
  connectResult: CheckResult,
  _message: string
): HealthReport {
  return {
    status: 'unhealthy',
    totalMs: Date.now() - startMs,
    timestamp: new Date().toISOString(),
    checks: [connectResult],
    summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
  };
}

export async function checkHealth(options: HealthCheckOptions): Promise<HealthReport> {
  if (!options.transport) {
    throw new Error('options.transport is required');
  }

  const overallTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  const checkTimeout = options.checkTimeout ?? DEFAULT_CHECK_TIMEOUT;
  const clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
  const skip = options.skip ?? [];
  const startMs = Date.now();

  const { client, transport, cleanup } = await createConnectedClient(options.transport, clientInfo);

  const checks: CheckResult[] = [];
  let connectPassed = false;
  let initPassed = false;
  let serverInfo: { name: string; version: string; protocolVersion: string } | undefined;

  try {
    // Connect check
    const connectResult = await runConnectCheck(client, transport, Math.min(checkTimeout, overallTimeout));
    checks.push(connectResult);
    connectPassed = connectResult.passed;

    if (!connectPassed) {
      return makeUnhealthyReport(startMs, connectResult, connectResult.message);
    }

    // Initialize check
    const initOutcome = await runInitializeCheck(client, clientInfo, checkTimeout);
    checks.push(initOutcome.result);
    initPassed = initOutcome.result.passed;
    if (initOutcome.serverInfo) {
      serverInfo = initOutcome.serverInfo;
    }

    if (!initPassed) {
      const status = computeStatus(checks, connectPassed, initPassed);
      const skippedCount = 3 + (options.customChecks?.length ?? 0); // 3 capability checks (tools, resources, prompts) all skipped due to init failure
      return {
        status,
        totalMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
        checks,
        summary: makeSummary(checks, skippedCount),
        server: serverInfo,
      };
    }

    // Tools check
    let skippedCount = 0;
    if (!skip.includes('tools')) {
      checks.push(await runToolsCheck(client, options.thresholds, checkTimeout));
    } else {
      skippedCount++;
    }

    // Resources check
    if (!skip.includes('resources')) {
      checks.push(await runResourcesCheck(client, options.thresholds, checkTimeout));
    } else {
      skippedCount++;
    }

    // Prompts check
    if (!skip.includes('prompts')) {
      checks.push(await runPromptsCheck(client, options.thresholds, checkTimeout));
    } else {
      skippedCount++;
    }

    // Custom checks
    for (const customCheck of options.customChecks ?? []) {
      const checkStart = Date.now();
      try {
        let timer: ReturnType<typeof setTimeout>;
        const result = await Promise.race([
          customCheck.fn(client),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Custom check timed out after ${checkTimeout}ms`)), checkTimeout);
          }),
        ]);
        clearTimeout(timer!);
        checks.push({
          name: customCheck.name,
          passed: result.passed,
          durationMs: Date.now() - checkStart,
          message: result.message,
          details: result.details,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({
          name: customCheck.name,
          passed: false,
          durationMs: Date.now() - checkStart,
          message: `Custom check failed: ${msg}`,
          error: { code: 'CUSTOM_CHECK_ERROR', message: msg },
        });
      }
    }

    // Apply latency threshold — mark check as degraded if any exceeds max
    if (options.thresholds?.maxLatencyMs !== undefined) {
      const maxMs = options.thresholds.maxLatencyMs;
      for (const check of checks) {
        if (check.passed && check.durationMs > maxMs) {
          check.passed = false;
          check.message = `${check.message} (latency ${check.durationMs}ms exceeds threshold ${maxMs}ms)`;
          check.error = {
            code: 'LATENCY_THRESHOLD',
            message: `Latency ${check.durationMs}ms exceeds max ${maxMs}ms`,
          };
        }
      }
    }

    const status = computeStatus(checks, connectPassed, initPassed);

    return {
      status,
      totalMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
      checks,
      summary: makeSummary(checks, skippedCount),
      server: serverInfo,
    };
  } finally {
    await cleanup();
  }
}

export async function isHealthy(options: HealthCheckOptions): Promise<boolean> {
  const report = await checkHealth(options);
  return report.status === 'healthy';
}
