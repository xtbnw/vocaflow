// 网关配置解析 — 纯函数，不依赖 process.env 副作用

export interface GatewayConfig {
  host: string;
  port: number;
  /** 已 trim 的允许 Origin 列表 */
  allowedOrigins: string[];
}

const DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";

/**
 * 从类 process.env 对象解析网关配置。
 * 所有值均提供默认值，允许 Origin 列表会 trim 每项避免逗号后空格误拒绝。
 */
export function resolveGatewayConfig(env: Record<string, string | undefined>): GatewayConfig {
  const rawOrigins = env.VOICE_GATEWAY_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS;
  return {
    host: env.VOICE_GATEWAY_HOST ?? "127.0.0.1",
    port: parseInt(env.VOICE_GATEWAY_PORT ?? "3101", 10),
    allowedOrigins: rawOrigins.split(",").map((s) => s.trim()),
  };
}
