// mcp-healthcheck - Programmatic health/liveness probe for MCP servers
export { checkHealth, isHealthy } from './health.js';
export type {
  TransportType,
  TransportConfig,
  StdioTransportConfig,
  HttpTransportConfig,
  SseTransportConfig,
  HealthStatus,
  CheckResult,
  HealthReport,
  CustomCheckFn,
  Thresholds,
  HealthCheckOptions,
} from './types.js';
