import { z } from "zod/v4";

// -- 浏览器 → 网关 (JSON 文本帧) --

export const voiceGatewayClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), requestId: z.string() }),
  z.object({ type: z.literal("text_delta"), requestId: z.string(), text: z.string() }),
  z.object({ type: z.literal("finish"), requestId: z.string() }),
  z.object({ type: z.literal("cancel"), requestId: z.string() }),
]);

export type VoiceGatewayClientMessage = z.infer<typeof voiceGatewayClientMessageSchema>;

// -- 网关 → 浏览器 (JSON 文本帧) --

export const voiceGatewayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({ type: z.literal("ready"), requestId: z.string() }),
  z.object({ type: z.literal("ended"), requestId: z.string() }),
  z.object({ type: z.literal("canceled"), requestId: z.string() }),
  z.object({ type: z.literal("error"), requestId: z.string().optional(), code: z.string(), message: z.string() }),
]);

export type VoiceGatewayServerMessage = z.infer<typeof voiceGatewayServerMessageSchema>;

// -- 浏览器侧消息 JSON 校验 --

export function parseClientMessage(data: unknown): VoiceGatewayClientMessage {
  return voiceGatewayClientMessageSchema.parse(data);
}

export function serializeServerMessage(msg: VoiceGatewayServerMessage): string {
  return JSON.stringify(msg);
}

export function parseServerMessage(data: unknown): VoiceGatewayServerMessage {
  return voiceGatewayServerMessageSchema.parse(data);
}

/** 检查 Origin 是否在允许列表中。Node 会将 header 名规范化为小写。 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  // 允许缺失 Origin（如原生 ws 客户端直连）；浏览器来源须匹配白名单
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}
