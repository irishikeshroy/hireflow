(function () {
  if (window.__hireflowGemini) return;
  window.__hireflowGemini = true;

  const HF = self.HireFlow;
  const D = HF.dom;

  const COMPOSER = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="Enter a prompt" i]',
    'div[contenteditable="true"][aria-label*="Ask" i]',
    'textarea[aria-label*="prompt" i]',
    'div.ql-editor.textarea'
  ];

  const SEND = [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send message" i]',
    'button[aria-label="Send"]',
    "button.send-button",
    'button[mattooltip*="Send" i]',
    'button[aria-label*="Submit" i]'
  ];

  const STOP = [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop response"]',
    'button[data-test-id="stop-button"]'
  ];

  const NEW_CHAT = [
    'button[aria-label="New chat"]',
    'a[aria-label="New chat"]',
    '[data-test-id="new-chat-button"]',
    'a[href="/app"]',
    'button[aria-label*="New chat" i]'
  ];

  const RESPONSES = [
    "model-response",
    "model-response .markdown",
    "[data-response-id]",
    ".model-response-text",
    "message-content",
    ".response-content",
    '[class*="model-response"]'
  ];

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "HF_RUN_AI") return;
    if (window !== window.top) {
      sendResponse({ handled: false, skipped: true });
      return;
    }
    run(msg.prompt)
      .then((text) => {
        const payload = { type: "HF_AI_RESULT", ok: true, text, jobId: msg.jobId };
        chrome.runtime.sendMessage(payload).catch(() => {});
        sendResponse({ ok: true, text, jobId: msg.jobId });
      })
      .catch((err) => {
        const error = err && err.message ? err.message : String(err);
        chrome.runtime.sendMessage({ type: "HF_AI_RESULT", ok: false, error, jobId: msg.jobId }).catch(() => {});
        sendResponse({ ok: false, error, jobId: msg.jobId });
      });
    return true;
  });

  async function run(prompt) {
    HF.hud.show("Preparing Gemini draft…", { sub: "Stay on this tab until it finishes." });

    if (looksLoggedOut()) {
      throw new Error("Gemini is not logged in. Log in at gemini.google.com, then retry.");
    }

    const composer = await D.waitFor(COMPOSER, 25000).catch(() => {
      if (looksLoggedOut()) {
        throw new Error("Gemini is not logged in. Log in at gemini.google.com, then retry.");
      }
      throw new Error("Could not find the Gemini composer. Refresh the tab and retry.");
    });

    const before = snapshotResponses();

    HF.hud.show("Pasting your resume + job post…");
    await D.insertText(composer, prompt);
    await D.sleep(350);

    HF.hud.show("Waiting for Gemini to write the email…");
    await clickSend(composer);

    await D.waitUntil(() => D.queryVisible(STOP) || snapshotResponses().length > before.length, 25000).catch(
      () => {}
    );

    const text = await waitForStableReply(before, 150000);
    HF.hud.show("Draft captured.", { kind: "ok", sub: "Sending it to the review window." });
    await D.sleep(400);
    HF.hud.hide();
    return text;
  }

  function looksLoggedOut() {
    const body = (document.body && document.body.innerText) || "";
    const loginish = /sign in|log in/i.test(body) && !D.queryVisible(COMPOSER);
    return loginish;
  }

  async function clickNewChat() {
    const btn = D.queryVisible(NEW_CHAT);
    if (!btn) return;
    D.click(btn);
    await D.sleep(1000);
  }

  async function clickSend(composer) {
    if (!composer) return;
    composer.focus();

    try {
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
    } catch (e) {}
    await D.sleep(300);

    const container = composer.closest('.input-area, rich-textarea, form, [class*="input-area"]') || document.body;
    const candidates = [
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]',
      'button.send-button',
      '.send-button-container button',
      'button[mattooltip*="Send" i]',
      'button[data-test-id="send-button"]',
      'button[aria-label*="Send message" i]'
    ];

    let btn = null;
    for (const sel of candidates) {
      const candidate = D.qs(sel, container) || D.qs(sel);
      if (candidate && D.visible(candidate) && !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true") {
        btn = candidate;
        break;
      }
    }

    if (btn) {
      D.click(btn);
      await D.sleep(400);
    }

    sendEnterToQuill(composer);
    await D.sleep(400);
  }

  function sendEnterToQuill(composer) {
    if (!composer) return;
    composer.focus();
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    composer.dispatchEvent(new KeyboardEvent("keydown", opts));
    composer.dispatchEvent(new KeyboardEvent("keypress", opts));
    composer.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function isPromptEcho(text) {
    if (!text) return false;
    return (
      text.includes("=== RESUME DATA ===") ||
      text.includes("=== TASK & INSTRUCTIONS ===") ||
      text.includes("=== CANDIDATE PROFILE ===") ||
      text.includes("CANDIDATE PROFILE") ||
      text.includes("JOB POSTING DATA")
    );
  }

  function cleanAiHeader(text) {
    if (!text) return "";
    return String(text)
      .replace(/^(?:Gemini|ChatGPT)(?:\s+said)?\s*[\:\-\n]*/i, "")
      .trim();
  }

  function snapshotResponses() {
    for (const sel of RESPONSES) {
      const nodes = D.qsa(sel)
        .map((n) => cleanAiHeader(n.innerText || ""))
        .filter((t) => t.length > 30 && !isPromptEcho(t));
      if (nodes.length) return nodes;
    }
    return [];
  }

  function isStoppedResponse() {
    const text = (document.body && document.body.innerText) || "";
    if (text.includes("You stopped this response") || text.includes("Response stopped")) {
      return true;
    }
    const infoLine = document.querySelector('response-info-line, .info-content, [class*="response-info"]');
    if (infoLine && /stopped/i.test(infoLine.innerText || "")) {
      return true;
    }
    return false;
  }

  async function waitForStableReply(before, timeout) {
    const start = Date.now();
    let last = "";
    let stableSince = 0;

    while (Date.now() - start < (timeout || 120000)) {
      if (isStoppedResponse()) {
        setTimeout(() => location.reload(), 500);
        throw new Error("Gemini response was stopped. Page reloaded — please click Retry.");
      }

      const now = snapshotResponses();
      const newest = now[now.length - 1] || "";
      const grew = now.length > before.length || (newest && !before.includes(newest));

      if (grew && newest) {
        if (newest !== last) {
          last = newest;
          stableSince = Date.now();
        } else {
          const elapsed = Date.now() - stableSince;
          const hasEmailFormat = /TO\s*[:\-]/i.test(newest) && /SUBJECT\s*[:\-]/i.test(newest) && /BODY\s*[:\-]/i.test(newest);
          if (hasEmailFormat && elapsed >= 1200) {
            return newest;
          }
          if (elapsed >= 3000 && newest.length > 80 && !isPromptEcho(newest)) {
            return newest;
          }
        }
      }
      await D.sleep(300);
    }

    if (last && last.length > 40 && !isPromptEcho(last)) return last;
    throw new Error("Gemini did not finish a usable draft in time.");
  }
})();
