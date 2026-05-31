import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeAssistantText } from "../../../backend/shared/assistantTextSanitizer";

test("removes Markdown emphasis markers from assistant text", () => {
  assert.equal(
    sanitizeAssistantText("你觉得 **9:00–11:00** 可以吗？"),
    "你觉得 9:00 到 11:00 可以吗？",
  );
});

test("normalizes ASCII time range separators", () => {
  assert.equal(sanitizeAssistantText("上午 9:00-11:00"), "上午 9:00 到 11:00");
});

test("removes common Markdown syntax characters", () => {
  assert.equal(
    sanitizeAssistantText("## 标题\n> `周三` | **上午**"),
    " 标题\n 周三  上午",
  );
});

test("produces the same result when streamed in separate deltas", () => {
  const deltas = ["你觉得 *", "*9:00–11:00*", "* 可以吗？"];
  assert.equal(
    deltas.map(sanitizeAssistantText).join(""),
    sanitizeAssistantText(deltas.join("")),
  );
});
