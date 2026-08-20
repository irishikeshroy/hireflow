(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function qs(sel, rootEl) {
    try {
      return (rootEl || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function qsa(sel, rootEl) {
    try {
      return Array.from((rootEl || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  function queryFirst(selectors, rootEl) {
    for (const sel of selectors) {
      const el = qs(sel, rootEl);
      if (el) return el;
    }
    return null;
  }

  function visible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function queryVisible(selectors, rootEl) {
    for (const sel of selectors) {
      const nodes = qsa(sel, rootEl);
      const hit = nodes.find(visible);
      if (hit) return hit;
    }
    return queryFirst(selectors, rootEl);
  }

  function waitUntil(fn, timeout, interval) {
    const limit = timeout || 15000;
    const step = interval || 200;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        let val;
        try {
          val = fn();
        } catch (e) {
          val = null;
        }
        if (val) return resolve(val);
        if (Date.now() - start > limit) {
          return reject(new Error("Timed out waiting for page element"));
        }
        setTimeout(tick, step);
      };
      tick();
    });
  }

  function waitFor(selectors, timeout) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return waitUntil(() => queryVisible(list), timeout);
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    el.focus();
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function insertText(el, text) {
    if (!el) throw new Error("No editor found");
    const doc = el.ownerDocument || document;
    el.focus();
    await sleep(40);

    try {
      const sel = doc.getSelection ? doc.getSelection() : window.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      /* ignore */
    }

    let ok = false;
    try {
      ok = doc.execCommand("insertText", false, text);
    } catch (e) {
      ok = false;
    }

    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      /* ignore */
    }

    const sample = text.slice(0, 24);
    const current = (el.innerText || el.textContent || el.value || "").replace(/\s+/g, " ");
    if (ok && current.includes(sample.replace(/\s+/g, " ").slice(0, 16))) return true;

    if ("value" in el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
      setNativeValue(el, text);
      return true;
    }

    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        })
      );
      await sleep(80);
    } catch (e) {
      /* ignore */
    }

    const after = (el.innerText || el.textContent || el.value || "").replace(/\s+/g, " ");
    if (after.includes(sample.replace(/\s+/g, " ").slice(0, 16))) return true;

    try {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        })
      );
    } catch (e) {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  function click(el) {
    if (!el) return false;
    el.focus();
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
    return true;
  }

  function pressEnter(el) {
    if (!el) return;
    el.focus();
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  HF.dom = {
    sleep,
    qs,
    qsa,
    queryFirst,
    queryVisible,
    visible,
    waitUntil,
    waitFor,
    setNativeValue,
    insertText,
    click,
    pressEnter
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
