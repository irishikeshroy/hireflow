(function () {
  if (window.__hireflowGmail) return;
  window.__hireflowGmail = true;

  const HF = self.HireFlow;
  const D = HF.dom;

  const COMPOSE_BTN = [
    'div[role="button"][gh="cm"]',
    'div.T-I.T-I-KE.L3',
    'div.z0 div[role="button"]',
    'div[role="button"][aria-label*="Compose" i]',
    'div[role="button"][data-tooltip*="Compose" i]'
  ];

  const TO = [
    'input[aria-label="To recipients"]',
    'input[name="to"]',
    'textarea[name="to"]',
    'input[peoplekit-id]',
    'div[aria-label="To"] input',
    'input[aria-label^="To"]',
    'div[role="combobox"][aria-label*="To"] input'
  ];

  const SUBJECT = [
    'input[name="subjectbox"]',
    'input[aria-label="Subject"]',
    'input.aoT',
    'input[name="subject"]'
  ];

  const BODY = [
    'div[aria-label="Message Body"]',
    'div.Am.Al.editable',
    'div.editable[role="textbox"]',
    'div[role="textbox"][aria-label="Message Body"]',
    'div[role="textbox"][aria-label*="Message Body"]',
    'div[g_editable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Message Body"]'
  ];

  const SEND = [
    'div[role="button"][aria-label^="Send"]',
    'div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
    'div[role="button"][data-tooltip^="Send"]',
    'div[data-tooltip^="Send"]',
    'button[aria-label^="Send"]'
  ];

  const ATTACH_BTN = [
    'div[command="Files"]',
    'div[aria-label="Attach files"]',
    'div[data-tooltip="Attach files"]',
    'div[aria-label*="Attach files"]',
    'div[data-tooltip*="Attach"]',
    'div[role="button"][aria-label*="Attach"]'
  ];

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "HF_FILL_GMAIL") return;
    if (window !== window.top) {
      sendResponse({ handled: false, skipped: true });
      return;
    }
    fill(msg)
      .then((result) => {
        chrome.runtime.sendMessage(Object.assign({ type: "HF_GMAIL_RESULT", jobId: msg.jobId }, result)).catch(() => {});
        sendResponse(Object.assign({ jobId: msg.jobId }, result));
      })
      .catch((err) => {
        const error = err && err.message ? err.message : String(err);
        const payload = { type: "HF_GMAIL_RESULT", ok: false, error, jobId: msg.jobId, send: msg.send };
        chrome.runtime.sendMessage(payload).catch(() => {});
        sendResponse({ ok: false, error, jobId: msg.jobId });
      });
    return true;
  });

  function allDocs() {
    const docs = [document];
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (e) {
        /* cross-origin */
      }
    });
    return docs;
  }

  function queryAll(selectors, root) {
    const out = [];
    const roots = root ? [root] : allDocs();
    for (const doc of roots) {
      const scope = doc.querySelectorAll ? doc : document;
      for (const sel of selectors) {
        try {
          scope.querySelectorAll(sel).forEach((el) => out.push(el));
        } catch (e) {
          /* ignore */
        }
      }
    }
    return out;
  }

  function lastVisible(els) {
    const vis = els.filter((el) => {
      try {
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 6;
      } catch (e) {
        return false;
      }
    });
    return vis[vis.length - 1] || els[els.length - 1] || null;
  }

  function cleanupDuplicateComposes() {
    try {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter((d) => {
        return d.querySelector('input[name="subjectbox"]') || d.querySelector('input[aria-label="Subject"]') || d.querySelector('div[aria-label="Message Body"]');
      });
      if (dialogs.length > 1) {
        for (let i = 0; i < dialogs.length - 1; i++) {
          const d = dialogs[i];
          const body = d.querySelector('div[aria-label="Message Body"]') || d.querySelector('div[role="textbox"]');
          const text = (body ? body.innerText : '').trim();
          if (!text) {
            const closeBtn =
              d.querySelector('div[aria-label="Save & close"]') ||
              d.querySelector('img[aria-label="Save & close"]') ||
              d.querySelector('div[aria-label="Discard draft"]') ||
              d.querySelector('div[aria-label="Close"]');
            if (closeBtn) D.click(closeBtn);
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function composeRoot() {
    cleanupDuplicateComposes();
    const subject = lastVisible(queryAll(SUBJECT));
    if (!subject) return null;
    return (
      subject.closest('div[role="dialog"]') ||
      subject.closest(".nH.Hd") ||
      subject.closest("form") ||
      subject.closest(".M9") ||
      subject.parentElement
    );
  }

  function inCompose(selectors) {
    const root = composeRoot();
    if (root) {
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el) return el;
        } catch (e) {
          /* ignore */
        }
      }
    }
    return lastVisible(queryAll(selectors));
  }

  async function fill(msg) {
    HF.hud.show("Preparing Gmail compose in the background…", { sub: msg.to || "" });

    if (isLoginWall()) {
      throw new Error("Gmail is not logged in. Log in on your existing Gmail tab, then retry.");
    }

    await ensureComposeOpen();
    const activeBox = composeRoot();

    const subjectEl = await D.waitUntil(() => inCompose(SUBJECT), 20000).catch(() => {
      if (isLoginWall()) throw new Error("Gmail is not logged in.");
      throw new Error("Could not open Gmail compose. Keep Gmail open and retry.");
    });

    if (msg.subject) {
      D.setNativeValue(subjectEl, msg.subject);
    }

    await ensureTo(msg.to);
    const bodyEl = await ensureBody(msg.body);
    const written = (bodyEl.innerText || "").replace(/\s+/g, " ").trim();
    if (!written || written.length < 20) {
      throw new Error("Could not put the email text into Gmail. Compose is open — paste the body from HireFlow and send.");
    }

    let attached = false;
    if (msg.attach !== false) {
      try {
        attached = await attachResume();
      } catch (err) {
        HF.hud.show("Email is filled, but the resume was not attached.", {
          kind: "warn",
          sub: err && err.message ? err.message : String(err)
        });
      }
    }

    if (!msg.send) {
      HF.hud.show("Draft filled in Gmail. Send it when you are ready.", { kind: "ok" });
      return { ok: true, sent: false, send: false, attached };
    }

    if (msg.confirm) {
      HF.hud.show("Gmail is ready. Click Send there to confirm.", {
        kind: "warn",
        sub: "Confirm-on-Gmail is on in settings."
      });
      return { ok: true, sent: false, send: false, attached };
    }

    HF.hud.show("Sending from Gmail…", { sub: attached ? "Resume attached." : "" });
    await D.sleep(500);

    const sendBtn = await D.waitUntil(() => inCompose(SEND), 8000);
    D.click(sendBtn);

    const sent = await waitSent(activeBox, 14000);
    if (!sent) {
      HF.hud.show("Could not confirm send. Compose is still open.", { kind: "warn" });
      return {
        ok: false,
        error: "Clicked Send but Gmail did not confirm. Check the Gmail tab — do not leave LinkedIn, just glance at Gmail.",
        attached
      };
    }

    cleanupDuplicateComposes();
    await D.sleep(400);
    HF.hud.show("Email sent from Gmail.", { kind: "ok" });
    await D.sleep(400);
    HF.hud.hide();
    return { ok: true, sent: true, send: true, attached };
  }

  async function ensureComposeOpen() {
    cleanupDuplicateComposes();
    if (inCompose(SUBJECT)) return;
    const btn = lastVisible(queryAll(COMPOSE_BTN));
    if (btn) {
      D.click(btn);
      await D.sleep(1200);
      cleanupDuplicateComposes();
      const opened = await D.waitUntil(() => inCompose(SUBJECT), 8000).catch(() => null);
      if (opened) return;
    }
    if (!inCompose(SUBJECT)) {
      await D.sleep(800);
    }
  }

  function isLoginWall() {
    const url = location.href;
    if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) return true;
    const t = (document.body && document.body.innerText) || "";
    return /Sign in to continue to Gmail/i.test(t);
  }

  async function ensureTo(email) {
    if (!email) return;
    const root = composeRoot();
    const already = ((root && root.innerText) || document.body.innerText || "").toLowerCase();
    if (already.includes(email.toLowerCase())) return;

    const input = inCompose(TO) || (await D.waitUntil(() => inCompose(TO), 8000).catch(() => null));
    if (!input) return;

    input.focus();
    await D.sleep(80);
    if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
      D.setNativeValue(input, email);
    } else {
      await setEditable(input, email, false);
    }
    D.pressEnter(input);
    await D.sleep(200);
  }

  async function ensureBody(text) {
    const el = await D.waitUntil(() => inCompose(BODY), 15000);
    const ok = await setEditable(el, text || "", true);
    if (!ok) throw new Error("Gmail rejected the message body.");
    return el;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toGmailHtml(text) {
    return String(text || "")
      .split("\n")
      .map((line) => {
        const safe = escapeHtml(line);
        return safe ? "<div>" + safe + "</div>" : "<div><br></div>";
      })
      .join("");
  }

  async function setEditable(el, text, asHtml) {
    if (!el) return false;
    const doc = el.ownerDocument || document;
    const sample = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);

    el.focus();
    await D.sleep(40);

    try {
      const sel = doc.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      /* ignore */
    }

    const html = asHtml ? toGmailHtml(text) : escapeHtml(text);
    let inserted = false;
    try {
      inserted = doc.execCommand(asHtml ? "insertHTML" : "insertText", false, asHtml ? html : text);
    } catch (e) {
      inserted = false;
    }

    let current = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (inserted && sample && current.includes(sample.slice(0, 16))) return true;

    try {
      el.innerHTML = asHtml ? html : escapeHtml(text).replace(/\n/g, "<br>");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await D.sleep(80);
    current = (el.innerText || "").replace(/\s+/g, " ").trim();
    return Boolean(current.length);
  }

  async function attachResume() {
    if (!HF.storage || !HF.storage.getResumeFile) return false;
    const stored = await HF.storage.getResumeFile();
    if (!stored || !stored.base64) return false;

    const file = fileFromBase64(stored.base64, stored.name || "resume.pdf", stored.mime || "application/pdf");
    const root = composeRoot() || document;
    const doc = root.ownerDocument || document;

    let input = findFileInput(root) || findFileInput(doc);
    if (!input) {
      const btn = inCompose(ATTACH_BTN) || lastVisible(queryAll(ATTACH_BTN));
      if (btn) {
        D.click(btn);
        await D.sleep(350);
        input = findFileInput(composeRoot() || document);
      }
    }
    if (!input) throw new Error("Could not find Gmail's attach control.");

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const name = (stored.name || "resume.pdf").slice(0, 18);
    const appeared = await D.waitUntil(() => {
      const box = composeRoot();
      const t = ((box && box.innerText) || "") + "";
      return t.toLowerCase().includes(name.toLowerCase()) || t.toLowerCase().includes(".pdf");
    }, 6000).catch(() => null);

    return Boolean(appeared || input.files.length);
  }

  function findFileInput(root) {
    if (!root || !root.querySelectorAll) return null;
    const nodes = root.querySelectorAll('input[type="file"]');
    if (!nodes.length) return null;
    return nodes[nodes.length - 1];
  }

  function fileFromBase64(b64, name, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime || "application/pdf" });
  }

  async function waitSent(targetBox, timeout) {
    const limit = typeof targetBox === "number" ? targetBox : (timeout || 14000);
    const box = typeof targetBox === "object" ? targetBox : null;
    const start = Date.now();
    while (Date.now() - start < limit) {
      const t = (document.body && document.body.innerText) || "";
      if (/Message sent\.|Your message has been sent|View message/i.test(t)) {
        cleanupDuplicateComposes();
        return true;
      }
      if (box && (!document.body.contains(box) || (box.ownerDocument && !box.ownerDocument.body.contains(box)))) {
        cleanupDuplicateComposes();
        return true;
      }
      if (box && !box.querySelector('input[name="subjectbox"]') && !box.querySelector('input[aria-label="Subject"]')) {
        cleanupDuplicateComposes();
        return true;
      }
      if (!inCompose(SUBJECT) && !inCompose(BODY)) {
        cleanupDuplicateComposes();
        return true;
      }
      await D.sleep(300);
    }
    cleanupDuplicateComposes();
    return false;
  }
})();
