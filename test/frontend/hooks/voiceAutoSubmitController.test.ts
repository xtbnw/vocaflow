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
// Tests
// ---------------------------------------------------------------------------

test("single final triggers auto-submit after 800ms debounce", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const rid = ctrl.startRound();
    ctrl.handleFinal("你好", rid);

    // Not yet fired
    assert.strictEqual(submitted, null);

    // Advance 700ms — still not fired
    mock.timers.tick(700);
    assert.strictEqual(submitted, null);

    // Advance to 800ms — should fire
    mock.timers.tick(100);
    assert.strictEqual(submitted, "你好");
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

    const rid = ctrl.startRound();
    ctrl.handleFinal("你好", rid);

    mock.timers.tick(400);
    ctrl.handleFinal("世界", rid); // restarts timer

    mock.timers.tick(400);
    assert.strictEqual(submitted, null); // old timer was cleared

    mock.timers.tick(400);
    assert.strictEqual(submitted, "你好 世界");
  } finally {
    disableMockTimers();
  }
});

test("stopRound prevents pending auto-submit", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const rid = ctrl.startRound();
    ctrl.handleFinal("测试", rid);

    ctrl.stopRound();

    mock.timers.tick(800);
    assert.strictEqual(submitted, null);
  } finally {
    disableMockTimers();
  }
});

test("stopRound invalidates round — old roundId ignored in handleFinal", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const rid1 = ctrl.startRound();
    ctrl.handleFinal("旧文本", rid1);
    ctrl.stopRound();

    const rid2 = ctrl.startRound();
    // Late arrival for old round — must be silently ignored
    ctrl.handleFinal("迟到文本", rid1);

    mock.timers.tick(800);
    assert.strictEqual(submitted, null); // only old-round final was received

    ctrl.handleFinal("新文本", rid2);
    mock.timers.tick(800);
    assert.strictEqual(submitted, "新文本");
  } finally {
    disableMockTimers();
  }
});

test("new round invalidates old round timer — old timer does not submit new round text", () => {
  enableMockTimers();
  try {
    let submitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitted = text; },
    });

    const rid1 = ctrl.startRound();
    ctrl.handleFinal("第一轮", rid1);

    // User restarts before timer fires
    const rid2 = ctrl.startRound(); // this clears the old timer
    ctrl.handleFinal("第二轮", rid2);

    // Advance past the old timer's intended fire time
    mock.timers.tick(800);
    assert.strictEqual(submitted, "第二轮");

    // Ensure no double fire
    submitted = null;
    mock.timers.tick(1000);
    assert.strictEqual(submitted, null);
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

    const rid = ctrl.startRound();
    // No finals — start a round and wait
    mock.timers.tick(800);
    assert.strictEqual(submitted, null);
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

    const rid = ctrl.startRound();
    ctrl.handleFinal("测试", rid);
    ctrl.dispose();

    mock.timers.tick(800);
    assert.strictEqual(submitted, null);
  } finally {
    disableMockTimers();
  }
});

test("timer callback invalidates round — old roundId final ignored after submit", () => {
  enableMockTimers();
  try {
    let submitCount = 0;
    let lastSubmitted: string | null = null;
    const ctrl = createVoiceAutoSubmitController({
      onSubmit: (text) => { submitCount++; lastSubmitted = text; },
    });

    const rid = ctrl.startRound();
    ctrl.handleFinal("第一段", rid);

    mock.timers.tick(800);
    assert.strictEqual(submitCount, 1);
    assert.strictEqual(lastSubmitted, "第一段");

    // Late final with same old roundId — must be silently ignored
    ctrl.handleFinal("迟到文本", rid);
    mock.timers.tick(800);
    assert.strictEqual(submitCount, 1);

    // A new round works normally
    const rid2 = ctrl.startRound();
    ctrl.handleFinal("新轮次", rid2);
    mock.timers.tick(800);
    assert.strictEqual(submitCount, 2);
    assert.strictEqual(lastSubmitted, "新轮次");
  } finally {
    disableMockTimers();
  }
});

test("getText returns current accumulated text", () => {
  const ctrl = createVoiceAutoSubmitController({
    onSubmit: () => {},
  });

  const rid = ctrl.startRound();
  assert.strictEqual(ctrl.getText(), "");

  ctrl.handleFinal("你好", rid);
  assert.strictEqual(ctrl.getText(), "你好");

  ctrl.handleFinal("世界", rid);
  assert.strictEqual(ctrl.getText(), "你好 世界");

  ctrl.stopRound();
  assert.strictEqual(ctrl.getText(), "");
});
