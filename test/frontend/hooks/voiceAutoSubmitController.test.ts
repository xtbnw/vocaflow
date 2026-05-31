import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  createVoiceAutoSubmitController,
} from "../../../frontend/hooks/voiceAutoSubmitController";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enableMockTimers() {
  mock.timers.enable({ apis: ["setTimeout"] });
}

function disableMockTimers() {
  mock.timers.reset();
}

// ---------------------------------------------------------------------------
// Session lifecycle tests
// ---------------------------------------------------------------------------

test("single final within a session triggers auto-submit after 800ms debounce", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token = ctrl.startSession();
    ctrl.handleFinal("你好", token);

    // Not yet fired
    assert.strictEqual(submitted, null);

    // Advance 700ms — still not fired
    mock.timers.tick(700);
    assert.strictEqual(submitted, null);

    // Advance to 800ms — should fire
    mock.timers.tick(100);
    assert.strictEqual(submitted, "你好");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("multiple finals within 800ms submit once with aggregated text", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token = ctrl.startSession();
    ctrl.handleFinal("你好", token);

    mock.timers.tick(400);
    ctrl.handleFinal("世界", token); // restarts timer

    mock.timers.tick(400);
    assert.strictEqual(submitted, null); // old timer was cleared

    mock.timers.tick(400);
    assert.strictEqual(submitted, "你好 世界");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("stopSession prevents pending auto-submit", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token = ctrl.startSession();
    ctrl.handleFinal("测试", token);

    ctrl.stopSession();

    mock.timers.tick(800);
    assert.strictEqual(submitted, null);
  } finally {
    disableMockTimers();
  }
});

test("late final with stale sessionToken is silently ignored", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token1 = ctrl.startSession();
    ctrl.handleFinal("旧文本", token1);
    ctrl.stopSession();

    // New session
    const token2 = ctrl.startSession();
    // Late arrival for old session — must be silently ignored
    ctrl.handleFinal("迟到文本", token1);

    mock.timers.tick(800);
    assert.strictEqual(submitted, null); // only old-session final was received

    ctrl.handleFinal("新文本", token2);
    mock.timers.tick(800);
    assert.strictEqual(submitted, "新文本");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("new session invalidates old timer — old timer does not submit", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token1 = ctrl.startSession();
    ctrl.handleFinal("第一轮", token1);

    // User restarts before timer fires
    const token2 = ctrl.startSession(); // this clears the old timer
    ctrl.handleFinal("第二轮", token2);

    // Advance past the old timer's intended fire time
    mock.timers.tick(800);
    assert.strictEqual(submitted, "第二轮");

    // Ensure no double fire
    submitted = null;
    mock.timers.tick(1000);
    assert.strictEqual(submitted, null);

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("empty accumulated text does not trigger submit", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token = ctrl.startSession();
    // No finals — start a session and wait
    mock.timers.tick(800);
    assert.strictEqual(submitted, null);

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("dispose cleans up pending timer", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const token = ctrl.startSession();
    ctrl.handleFinal("测试", token);
    ctrl.dispose();

    mock.timers.tick(800);
    assert.strictEqual(submitted, null);
  } finally {
    disableMockTimers();
  }
});

// ---------------------------------------------------------------------------
// Continuous submission within session (the key new behavior)
// ---------------------------------------------------------------------------

test("after first segment submits, session stays valid and second segment submits without re-tap", () => {
  enableMockTimers();
  try {
    const submitted: string[] = [];
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted.push(text); },
    });

    const token = ctrl.startSession();

    // First segment
    ctrl.handleFinal("第一段", token);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0], "第一段");

    // Second segment — same session, no re-tap needed
    ctrl.handleFinal("第二段", token);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 2);
    assert.strictEqual(submitted[1], "第二段");

    // Third segment
    ctrl.handleFinal("第三段", token);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 3);
    assert.strictEqual(submitted[2], "第三段");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("manual close prevents late final from submitting after session end", () => {
  enableMockTimers();
  try {
    const submitted: string[] = [];
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted.push(text); },
    });

    const token = ctrl.startSession();
    ctrl.handleFinal("有效文本", token);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 1);

    // User manually closes mic
    ctrl.stopSession();

    // Late final after close — must be ignored
    ctrl.handleFinal("关闭后的文本", token);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 1);

    // Verify a new session works
    const token2 = ctrl.startSession();
    ctrl.handleFinal("新会话", token2);
    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 2);
    assert.strictEqual(submitted[1], "新会话");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("multiple finals within debounce window correctly merge in session mode", () => {
  enableMockTimers();
  try {
    const submitted: string[] = [];
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted.push(text); },
    });

    const token = ctrl.startSession();

    ctrl.handleFinal("A", token);
    mock.timers.tick(200);
    ctrl.handleFinal("B", token);
    mock.timers.tick(200);
    ctrl.handleFinal("C", token);

    // Still within debounce window
    assert.strictEqual(submitted.length, 0);

    mock.timers.tick(800);
    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0], "A B C");

    ctrl.stopSession();
  } finally {
    disableMockTimers();
  }
});

test("getText returns current accumulated text", () => {
  const ctrl = createVoiceAutoSubmitController({
    onSubmit: () => {},
  });

  const token = ctrl.startSession();
  assert.strictEqual(ctrl.getText(), "");

  ctrl.handleFinal("你好", token);
  assert.strictEqual(ctrl.getText(), "你好");

  ctrl.handleFinal("世界", token);
  assert.strictEqual(ctrl.getText(), "你好 世界");

  ctrl.stopSession();
  assert.strictEqual(ctrl.getText(), "");
});
