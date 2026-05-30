import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStore } from "../../../backend/app/sessionStore";
import { makeUserMessage } from "../../../backend/app/sessionManager";

test("continuous messages are not duplicated in session history", () => {
  const store = new SessionStore();

  const { session } = store.getOrCreate();
  const user1 = makeUserMessage("第一条消息");
  store.addMessage(session.id, user1);

  const priorHistory = store.getMessages(session.id);
  const storedIds = new Set(priorHistory.map((m) => m.id));

  const resultMessages = [user1];

  for (const msg of resultMessages) {
    if (!storedIds.has(msg.id)) {
      store.addMessage(session.id, msg);
    }
  }

  const finalMessages = store.getMessages(session.id);
  assert.equal(finalMessages.length, 1);
  assert.equal(finalMessages[0].id, user1.id);
});

test("two user-assistant pairs produce clean history", () => {
  const store = new SessionStore();

  const { session } = store.getOrCreate();

  // Round 1
  const user1 = makeUserMessage("第一条");
  const prior1 = store.getMessages(session.id);

  const assistant1 = { kind: "assistant" as const, id: "a1", content: "回复1", timestamp: new Date().toISOString() };
  const result1 = [user1, assistant1];

  const storedIds1 = new Set(prior1.map((m) => m.id));
  for (const msg of result1) {
    if (!storedIds1.has(msg.id)) {
      store.addMessage(session.id, msg);
    }
  }

  // Round 2
  const user2 = makeUserMessage("第二条");
  const prior2 = store.getMessages(session.id);

  const assistant2 = { kind: "assistant" as const, id: "a2", content: "回复2", timestamp: new Date().toISOString() };
  const result2 = [user1, assistant1, user2, assistant2];

  const storedIds2 = new Set(prior2.map((m) => m.id));
  for (const msg of result2) {
    if (!storedIds2.has(msg.id)) {
      store.addMessage(session.id, msg);
    }
  }

  const finalMessages = store.getMessages(session.id);
  assert.equal(finalMessages.length, 4);
  assert.equal(finalMessages[0].kind, "user");
  assert.equal(finalMessages[1].kind, "assistant");
  assert.equal(finalMessages[2].kind, "user");
  assert.equal(finalMessages[3].kind, "assistant");
});

test("cross-session pending action validation is rejected", () => {
  const store = new SessionStore();

  const { session: s1 } = store.getOrCreate();
  const { session: s2 } = store.getOrCreate();

  store.bindPendingAction(s1.id, "pending-1");

  assert.equal(store.validatePendingAction(s2.id, "pending-1"), false);
  assert.equal(store.validatePendingAction(s1.id, "pending-1"), true);
  assert.equal(store.validatePendingAction("unknown-session", "pending-1"), false);
});

test("deleteSession cleans up both session and pending actions", () => {
  const store = new SessionStore();

  const { session } = store.getOrCreate();
  store.addMessage(session.id, makeUserMessage("test"));
  store.bindPendingAction(session.id, "pending-1");

  store.deleteSession(session.id);

  assert.equal(store.getMessages(session.id).length, 0);
  assert.equal(store.validatePendingAction(session.id, "pending-1"), false);
});

test("deleteSession returns pending action IDs", () => {
  const store = new SessionStore();

  const { session } = store.getOrCreate();
  store.bindPendingAction(session.id, "pa-1");
  store.bindPendingAction(session.id, "pa-2");

  const ids = store.deleteSession(session.id);
  assert.deepEqual(ids.sort(), ["pa-1", "pa-2"]);
});

test("deleteSession on unknown session returns empty array", () => {
  const store = new SessionStore();
  const ids = store.deleteSession("nonexistent");
  assert.deepEqual(ids, []);
});

test("assistant message flow produces clean history", () => {
  const store = new SessionStore();
  const { session } = store.getOrCreate();

  // User asks a question
  const user1 = makeUserMessage("明天下午开会讨论项目");
  const prior1 = store.getMessages(session.id);

  // Runner returns: prior + user1 + assistant asking for more info
  const clarificationMsg = {
    kind: "assistant" as const,
    id: "a1",
    content: "请问会议几点开始？",
    timestamp: new Date().toISOString(),
  };
  const result1 = [user1, clarificationMsg];

  const storedIds1 = new Set(prior1.map((m) => m.id));
  for (const msg of result1) {
    if (!storedIds1.has(msg.id)) store.addMessage(session.id, msg);
  }

  // User provides missing info
  const user2 = makeUserMessage("下午三点");
  const prior2 = store.getMessages(session.id);

  // Runner returns: prior + user2 + tool_call + assistant reply
  const toolCall = {
    kind: "assistant" as const,
    id: "a2",
    content: "正在创建日程…",
    toolCall: {
      tool: "create_event",
      arguments: { title: "开会讨论项目", startAt: "2026-05-31T15:00:00+08:00" },
    },
    timestamp: new Date().toISOString(),
  };
  const finishMsg = {
    kind: "assistant" as const,
    id: "a3",
    content: "已创建日程",
    timestamp: new Date().toISOString(),
  };
  const result2 = [user1, clarificationMsg, user2, toolCall, finishMsg];

  const storedIds2 = new Set(prior2.map((m) => m.id));
  for (const msg of result2) {
    if (!storedIds2.has(msg.id)) store.addMessage(session.id, msg);
  }

  const finalMessages = store.getMessages(session.id);
  assert.equal(finalMessages.length, 5);
  assert.equal(finalMessages[0].kind, "user");
  assert.equal(finalMessages[1].kind, "assistant");
  assert.equal(finalMessages[2].kind, "user");
  assert.equal(finalMessages[2].text, "下午三点");
  assert.equal(finalMessages[3].kind, "assistant");
  assert.equal(finalMessages[4].kind, "assistant");
});
