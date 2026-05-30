export function describeSchemaForPrompt(schema: unknown): string {
  try {
    const zodSchema = schema as { shape?: Record<string, unknown> };
    if (!zodSchema.shape) return "{}";

    const fields: string[] = [];
    for (const [key, field] of Object.entries(zodSchema.shape)) {
      const def = (field as { _def?: { typeName?: string; innerType?: unknown } })._def;
      const isOptional = def?.typeName === "ZodOptional";
      const inner = isOptional ? (def?.innerType as { _def?: { typeName?: string } })?._def : def;
      const typeName = inner?.typeName ?? "unknown";
      const typeStr = zodTypeLabel(typeName);
      fields.push(`  "${key}": ${typeStr}${isOptional ? " (optional)" : ""}`);
    }
    return `{\n${fields.join(",\n")}\n}`;
  } catch {
    return "{}";
  }
}

function zodTypeLabel(typeName: string): string {
  if (typeName.includes("String") || typeName.includes("DateTime") || typeName.includes("Iso")) return "string";
  if (typeName.includes("Number")) return "number";
  if (typeName.includes("Boolean")) return "boolean";
  if (typeName.includes("Enum")) return "string";
  return "string";
}

export function extractJson(text: string): string {
  const fenceJson = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = text.match(fenceJson);
  if (match) return match[1].trim();

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return text;
  let depth = 0;
  for (let i = firstBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(firstBrace, i + 1);
  }
  return text;
}
