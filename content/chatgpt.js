(function () {
  if (window.__hireflowChatGPT) return;
  window.__hireflowChatGPT = true;

  const HF = self.HireFlow;
  const D = HF.dom;

  const COMPOSER = [
    "#prompt-textarea",
    "div#prompt-textarea",
    "textarea#prompt-textarea",
    '[data-testid="prompt-textarea"]',
    "div.ProseMirror[contenteditable='true']",
    'textarea[data-id="root"]',
    'div[contenteditable="true"][data-id]'
  ];

  const SEND = [
    'button[data-testid="send-button"]',
    'button[data-testid="fruitjuice-send-button"]',
    'button[aria-label*="Send" i]',
    "form button[type='submit']"
  ];

  const STOP = [
    'button[data-testid="stop-button"]',
    'button[data-testid="stop-generating-button"]',
    'button[aria-label*="Stop" i]'
  ];

  const NEW_CHAT = [
    'a[data-testid="create-new-chat-button"]',
    'button[data-testid="create-new-chat-button"]',
    'a[aria-label="New chat"]',
    'button[aria-label="New chat"]',
    'a[href="/"][data-testid]',
    'nav a[href="/"]'
  ];

  const ASSISTANT = [
    '[data-message-author-role="assistant"]',
    'div.agent-turn',
    '[data-testid^="conversation-turn-"]:not([data-testid="conversation-turn-1"]):not([data-testid="conversation-turn-2"])',
    "article [data-message-id]"
  ];

  const LOGIN = [
    'button[data-testid="login-button"]',
    'a[href*="/auth/login"]',
    'button[data-testid="welcome-login-button"]'
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
        const payload = { type: "HF_AI_RESULT", ok: false, error, jobId: msg.jobId };
        chrome.runtime.sendMessage(payload).catch(() => {});
        sendResponse({ ok: false, error, jobId: msg.jobId });
      });
    return true;
  });

  async function run(prompt) {
    HF.hud.show("Preparing ChatGPT draft…", { sub: "Stay on this tab until it finishes." });

    if (looksLoggedOut()) {
      throw new Error("ChatGPT is not logged in. Log in, then retry from HireFlow.");
    }

    const composer = await D.waitFor(COMPOSER, 25000).catch(() => {
      if (looksLoggedOut()) {
        throw new Error("ChatGPT is not logged in. Log in, then retry from HireFlow.");
      }
      throw new Error("Could not find the ChatGPT composer. Refresh chatgpt.com and retry.");
    });

    const before = snapshotAssistants();

    HF.hud.show("Pasting your resume + job post…");
    await D.insertText(composer, prompt);
    await D.sleep(350);

    HF.hud.show("Waiting for ChatGPT to write the email…");
    await clickSend(composer);

    await D.waitUntil(() => D.queryVisible(STOP) || snapshotAssistants().length > before.length, 25000).catch(
      () => {}
    );

    const text = await waitForStableReply(before, 150000);
    HF.hud.show("Draft captured.", { kind: "ok", sub: "Sending it to the review window." });
    await D.sleep(400);
    HF.hud.hide();
    return text;
  }

  function looksLoggedOut() {
    const login = D.queryVisible(LOGIN);
    const composer = D.queryVisible(COMPOSER);
    return Boolean(login && !composer);
  }

  async function clickNewChat() {
    const btn = D.queryVisible(NEW_CHAT);
    if (!btn) return;
    const label = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
    if (label.includes("new") || btn.getAttribute("href") === "/" || btn.dataset.testid) {
      D.click(btn);
      await D.sleep(900);
    }
  }

  async function clickSend(composer) {
    await D.sleep(200);
    const btn = await D.waitUntil(() => {
      const b = D.queryFirst(SEND);
      if (!b) return null;
      if (b.disabled || b.getAttribute("aria-disabled") === "true") return null;
      return b;
    }, 8000).catch(() => null);

    if (btn) {
      D.click(btn);
      return;
    }
    D.pressEnter(composer);
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

  function snapshotAssistants() {
    let nodes = D.qsa(ASSISTANT.join(","));
    if (!nodes.length) {
      const turns = D.qsa('[data-message-author-role], [data-testid^="conversation-turn"]');
      nodes = turns.filter((el) => {
        const role = el.getAttribute("data-message-author-role");
        if (role === "user") return false;
        if (el.querySelector('[data-message-author-role="user"]')) return false;
        return true;
      });
    }

    return nodes
      .map((n) => cleanAiHeader(n.innerText || ""))
      .filter((t) => t.length > 20 && !isPromptEcho(t));
  }

  async function waitForStableReply(before, timeout) {
    const start = Date.now();
    let last = "";
    let stableSince = 0;

    while (Date.now() - start < (timeout || 120000)) {
      const now = snapshotAssistants();
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
    throw new Error("ChatGPT did not finish a usable draft in time.");
  }

  function looksLikeEmail(text) {
    return /TO\s*[:\-]/i.test(text) && /SUBJECT\s*[:\-]/i.test(text) && !isPromptEcho(text);
  }
})();
