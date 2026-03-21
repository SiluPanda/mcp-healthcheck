export type TransportType = 'stdio' | 'http' | 'sse';

export interface StdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTransportConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface SseTransportConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type TransportConfig = StdioTransportConfig | HttpTransportConfig | SseTransportConfig;

export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

export interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  message: string;
  error?: { code: string; message: string };
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  totalMs: number;
  timestamp: string;
  checks: CheckResult[];
  summary: { total: number; passed: number; failed: number; skipped: number };
  server?: { name: string; version: string; protocolVersion: string };
}

export type CustomCheckFn = (
  client: unknown
) => Promise<{ passed: boolean; message: string; details?: Record<string, unknown> }>;

export interface Thresholds {
  maxLatencyMs?: number;
  minTools?: number;
  maxTools?: number;
  minResources?: number;
  minPrompts?: number;
}

export interface HealthCheckOptions {
  transport: TransportConfig;
  timeout?: number;
  checkTimeout?: number;
  skip?: Array<'tools' | 'resources' | 'prompts'>;
  thresholds?: Thresholds;
  customChecks?: Array<{ name: string; fn: CustomCheckFn; required?: boolean }>;
  clientInfo?: { name: string; version: string };
  signal?: AbortSignal;
}
