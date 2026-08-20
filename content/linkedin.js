(function () {
  if (window.__hireflowLinkedIn) return;
  window.__hireflowLinkedIn = true;

  const HF = self.HireFlow;
  const HOST_ID = "hireflow-li-host";
  const STYLE_ID = "hireflow-inline-styles";

  let hideTimer = null;
  let lastSelectedText = "";
  let isInteracting = false;
  let isTriggered = false;

  injectInlineStyles();
  scanFeedPosts();
  initFeedObserver();

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (["HF_JOB_FINISHED", "HF_JOB_FAILED", "HF_JOB_CANCELLED"].includes(msg.type)) {
      const job = msg.job;
      if (!job) return;
      const targetEmail = (job.to || (job.emails && job.emails[0]) || "").toLowerCase();
      if (!targetEmail) return;

      const buttons = document.querySelectorAll('.hireflow-inline-btn');
      buttons.forEach((btn) => {
        const title = (btn.title || "").toLowerCase();
        const badge = (btn.querySelector('.hf-badge')?.textContent || "").toLowerCase();
        if (title.includes(targetEmail) || badge.includes(targetEmail)) {
          btn.style.opacity = '1';
          const liLogoSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex:none; margin-right: 2px;"><path d="M14.05 1h-12.1C1.42 1 1 1.42 1 1.95v12.1c0 .53.42.95.95.95h12.1c.53 0 .95-.42.95-.95V1.95c0-.53-.42-.95-.95-.95zM5.58 13H3.45V6.44h2.13V13zm-1.07-7.46c-.68 0-1.23-.55-1.23-1.23 0-.68.55-1.23 1.23-1.23.68 0 1.23.55 1.23 1.23 0 .68-.55 1.23-1.23 1.23zm9.54 7.46h-2.13V9.66c0-.8-.01-1.83-1.12-1.83-1.12 0-1.29.87-1.29 1.77V13H7.38V6.44h2.04v.9h.03c.28-.54 1-.1 2.01-.1 2.15 0 2.55 1.42 2.55 3.26V13z"/></svg>`;
          const emailHtml = job.to ? `<span class="hf-badge">${escapeHtml(job.to)}</span>` : '';
          if (msg.type === "HF_JOB_FINISHED" && job.status === "sent") {
            btn.style.background = '#057642';
            btn.innerHTML = `${liLogoSvg}<span class="hf-label">Applied ✓</span>${emailHtml}`;
          } else if (msg.type === "HF_JOB_FINISHED" && job.status === "draft_only") {
            btn.style.background = '#0073b1';
            btn.innerHTML = `${liLogoSvg}<span class="hf-label">Drafted ✎</span>${emailHtml}`;
          } else if (msg.type === "HF_JOB_FAILED" || msg.type === "HF_JOB_CANCELLED") {
            btn.style.background = '#0a66c2';
            btn.innerHTML = `${liLogoSvg}<span class="hf-label">Apply</span>${emailHtml}`;
          }
        }
      });
    }
  });

  document.addEventListener("mouseup", () => {
    setTimeout(onSelection, 20);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Escape") hide(true);
  });
  document.addEventListener(
    "scroll",
    () => {
      if (!isInteracting) hide();
      throttledScan();
    },
    true
  );

  function injectInlineStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .hireflow-inline-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        background: #0a66c2 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 999px !important;
        padding: 6px 16px !important;
        font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        user-select: none !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08) !important;
        transition: background-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out !important;
        margin: 6px 8px !important;
        vertical-align: middle !important;
        line-height: 1.2 !important;
        pointer-events: auto !important;
      }
      .hireflow-inline-btn:hover {
        background: #004182 !important;
        color: #ffffff !important;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15) !important;
      }
      .hireflow-inline-btn:active {
        background: #003162 !important;
      }
      .hireflow-inline-btn .hf-icon {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: #ffffff !important;
      }
      .hireflow-inline-btn .hf-badge {
        display: none !important;
        background: #eef3f8 !important;
        color: #0a66c2 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 2px 8px !important;
        border-radius: 999px !important;
        margin-left: 4px !important;
        white-space: nowrap !important;
      }
      .hireflow-inline-btn:hover .hf-badge {
        display: inline-block !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  let scanTimer = null;
  function throttledScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanFeedPosts();
    }, 400);
  }

  function initFeedObserver() {
    const observer = new MutationObserver(() => {
      throttledScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function isCommentNode(el) {
    if (!el) return false;
    return Boolean(
      el.closest(
        '.comments-comment-item, .comments-reply-item, .comments-comments-list, ' +
        '.feed-shared-update-v2__comments-container, .comments-comment-box, ' +
        '.comments-post-meta, .comments-comment-meta, ' +
        '[data-test-comment], [class*="comments-comment"], [class*="comments-reply"], [class*="comment-item"]'
      ) ||
      (el.matches && el.matches(
        '.comments-comment-item, .comments-reply-item, [class*="comments-comment"], ' +
        '[class*="comments-reply"], [class*="comment-item"]'
      ))
    );
  }

  function scanFeedPosts() {
    const postNodes = document.querySelectorAll(
      'div[componentkey]:not([data-hireflow-scanned]), ' +
      'div.feed-shared-update-v2:not([data-hireflow-scanned]), ' +
      'div[data-urn*="activity"]:not([data-hireflow-scanned]), ' +
      'article:not([data-hireflow-scanned])'
    );

    postNodes.forEach((postEl) => {
      postEl.setAttribute('data-hireflow-scanned', 'true');
      if (isCommentNode(postEl)) return;
      processPost(postEl);
    });
  }

  function processPost(postEl) {
    if (isCommentNode(postEl)) return;

    const textEl =
      postEl.querySelector('[data-testid="expandable-text-box"]') ||
      postEl.querySelector('.feed-shared-update-v2__description') ||
      postEl.querySelector('.update-components-text') ||
      postEl.querySelector('p[componentkey]');

    if (!textEl && !postEl.querySelector('button[aria-label="Comment"]')) return;
    if (textEl && isCommentNode(textEl)) return;

    const rawText = textEl ? (textEl.innerText || textEl.textContent || '') : (postEl.innerText || '');
    const cleanText = rawText.replace(/\s+/g, ' ').trim();

    if (cleanText.length < 30) return;

    const mailtoLinks = Array.from(postEl.querySelectorAll('a[href^="mailto:"]'))
      .filter((a) => !isCommentNode(a))
      .map((a) => a.href.replace(/^mailto:/i, '').split('?')[0].trim())
      .filter(Boolean);

    const extractedEmails = HF.extract ? HF.extract.emails(cleanText) : [];
    const emails = Array.from(new Set([...mailtoLinks, ...extractedEmails]));
    const looksLikeJob = HF.extract ? HF.extract.looksLikeJob(cleanText) : false;
    const hasHiringKw = /hiring|recruiting|vacancy|career|apply|referral|#hiring|#jobs|#job/i.test(cleanText);

    // Mandatory condition: Must contain at least one valid recipient email address
    if (!emails.length) return;

    let actionBar =
      postEl.querySelector('.feed-shared-social-action-bar') ||
      postEl.querySelector('.feed-shared-social-actions') ||
      postEl.querySelector('button[aria-label="Comment"]')?.parentElement ||
      postEl.querySelector('button[aria-label="Repost"]')?.parentElement ||
      postEl.querySelector('button[aria-label="Send"]')?.parentElement;

    if (!actionBar) {
      actionBar = textEl ? textEl.parentElement : postEl;
    }

    if (!actionBar || isCommentNode(actionBar)) return;
    if (actionBar.querySelector('.hireflow-inline-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hireflow-inline-btn';
    if (emails.length) btn.title = `Send application to ${emails[0]}`;

    const liLogoSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex:none; margin-right: 2px;"><path d="M14.05 1h-12.1C1.42 1 1 1.42 1 1.95v12.1c0 .53.42.95.95.95h12.1c.53 0 .95-.42.95-.95V1.95c0-.53-.42-.95-.95-.95zM5.58 13H3.45V6.44h2.13V13zm-1.07-7.46c-.68 0-1.23-.55-1.23-1.23 0-.68.55-1.23 1.23-1.23.68 0 1.23.55 1.23 1.23 0 .68-.55 1.23-1.23 1.23zm9.54 7.46h-2.13V9.66c0-.8-.01-1.83-1.12-1.83-1.12 0-1.29.87-1.29 1.77V13H7.38V6.44h2.04v.9h.03c.28-.54 1-.1 2.01-.1 2.15 0 2.55 1.42 2.55 3.26V13z"/></svg>`;
    const emailBadge = emails.length ? `<span class="hf-badge">${escapeHtml(emails[0])}</span>` : '';
    btn.innerHTML = `
      ${liLogoSvg}
      <span class="hf-label">Apply</span>
      ${emailBadge}
    `;

    const authorEl = postEl.querySelector('a[href*="/in/"]');
    const authorName = authorEl ? (authorEl.innerText || '').split('\n')[0].trim() : '';

    let fullText = cleanText;
    if (authorName && !fullText.toLowerCase().includes(authorName.toLowerCase())) {
      fullText = `Post by ${authorName}:\n${fullText}`;
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.opacity = '0.7';
      btn.innerHTML = `${liLogoSvg}<span class="hf-label">Starting…</span>${emailBadge}`;
      
      let responded = false;
      const timeoutTimer = setTimeout(() => {
        if (!responded) resetBtn();
      }, 4000);

      try {
        if (!chrome.runtime || !chrome.runtime.id) {
          alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
          resetBtn();
          return;
        }
        chrome.runtime.sendMessage({
          type: 'HF_START_FROM_SELECTION',
          text: fullText,
          sourceUrl: location.href,
          sourceTitle: document.title
        }).then((res) => {
          responded = true;
          clearTimeout(timeoutTimer);
          if (res && res.queued) {
            btn.style.opacity = '1';
            btn.innerHTML = `${liLogoSvg}<span class="hf-label">Queued (#${res.position || 1})</span>${emailBadge}`;
          } else if (res && res.ok) {
            btn.style.opacity = '1';
            btn.innerHTML = `${liLogoSvg}<span class="hf-label">Drafting…</span>${emailBadge}`;
          } else {
            resetBtn();
            if (res && res.error) {
              alert('HireFlow: ' + res.error);
            }
          }
        }).catch((err) => {
          responded = true;
          clearTimeout(timeoutTimer);
          if (err && String(err.message || err).includes('Extension context invalidated')) {
            alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
          }
          resetBtn();
        });
      } catch (err) {
        responded = true;
        clearTimeout(timeoutTimer);
        if (err && String(err.message || err).includes('Extension context invalidated')) {
          alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
        }
        resetBtn();
      }

      function resetBtn() {
        btn.style.opacity = '1';
        btn.innerHTML = `${liLogoSvg}<span class="hf-label">Apply</span>${emailBadge}`;
      }
    });

    actionBar.appendChild(btn);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === "HF_JOB_FINISHED" || msg.type === "HF_JOB_CANCELLED") {
        document.querySelectorAll('.hireflow-inline-btn').forEach((b) => {
          if (b.innerText.includes("Drafting") || b.innerText.includes("Processing")) {
            const emailMatch = b.querySelector('.hf-badge')?.outerHTML || '';
            b.innerHTML = `<span class="hf-icon">✓</span><span class="hf-label">Done</span>${emailMatch}`;
          }
        });
      }
    });
  } catch (e) {
    /* ignore */
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function onSelection() {
    if (isInteracting) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hide();
      return;
    }
    const text = String(sel.toString() || "").trim();
    if (text.length < 24) {
      hide();
      return;
    }
    const emails = HF.extract ? HF.extract.emails(text) : [];
    const jobby = HF.extract ? HF.extract.looksLikeJob(text) : false;
    if (!emails.length && !jobby && text.length < 80) {
      hide();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hide();
      return;
    }
    lastSelectedText = text;
    show(rect, text, emails);
  }

  function triggerHireFlow(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isTriggered) return;
    const host = document.getElementById(HOST_ID);
    const text = lastSelectedText || (host && host.dataset ? host.dataset.text : "") || "";
    if (!text || text.length < 8) return;
    isTriggered = true;
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
        isTriggered = false;
        return;
      }
      chrome.runtime.sendMessage({
        type: "HF_START_FROM_SELECTION",
        text,
        sourceUrl: location.href,
        sourceTitle: document.title
      }).catch((err) => {
        if (err && String(err.message || err).includes('Extension context invalidated')) {
          alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
        }
      });
    } catch (err) {
      if (err && String(err.message || err).includes('Extension context invalidated')) {
        alert('HireFlow extension was reloaded/updated. Please refresh this page to apply.');
      }
    }
    setTimeout(() => {
      isTriggered = false;
    }, 1000);
    hide(true);
  }

  function ensure() {
    let host = document.getElementById(HOST_ID);
    if (host && host.shadowRoot) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.top = "0";
    host.style.left = "0";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .chip {
          position: fixed;
          display: none;
          align-items: center;
          gap: 8px;
          background: #ffffff;
          color: #191919;
          border: 1px solid #e0e0e0;
          border-radius: 999px;
          padding: 6px 14px;
          font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,.15);
          cursor: pointer;
          user-select: none;
          pointer-events: auto;
          transition: all 0.15s ease-in-out;
        }
        .chip.on { display: inline-flex; }
        .chip:hover { border-color: #0a66c2; background: #eef3f8; }
        img { width: 18px; height: 18px; border-radius: 4px; pointer-events: none; }
        .label { font-size: 13px; font-weight: 600; color: #0a66c2; pointer-events: none; }
        .meta { font-size: 10px; color: #5e5e5e; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; pointer-events: none; }
      </style>
      <button class="chip" id="chip" type="button">
        <img alt="" />
        <span>
          <div class="meta" id="meta">HireFlow</div>
          <div class="label" id="label">Draft application email</div>
        </span>
      </button>
    `;
    const img = shadow.querySelector("img");
    img.src = chrome.runtime.getURL("icons/icon32.png");
    const chip = shadow.getElementById("chip");

    chip.addEventListener("mouseenter", () => {
      isInteracting = true;
    });
    chip.addEventListener("mouseleave", () => {
      isInteracting = false;
    });

    ["pointerdown", "mousedown", "click"].forEach((evtType) => {
      chip.addEventListener(evtType, (e) => {
        triggerHireFlow(e);
      });
    });

    document.documentElement.appendChild(host);
    return host;
  }

  function show(rect, text, emails) {
    const host = ensure();
    const chip = host.shadowRoot.getElementById("chip");
    host.dataset.text = text;
    const meta = host.shadowRoot.getElementById("meta");
    meta.textContent = emails.length ? emails[0] : "HireFlow";
    chip.classList.add("on");
    const top = Math.max(12, rect.top - 48);
    const left = Math.min(window.innerWidth - 240, Math.max(12, rect.left));
    chip.style.top = top + "px";
    chip.style.left = left + "px";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hide(), 12000);
  }

  function hide(force) {
    if (!force && isInteracting) return;
    const host = document.getElementById(HOST_ID);
    if (!host || !host.shadowRoot) return;
    host.shadowRoot.getElementById("chip").classList.remove("on");
    isInteracting = false;
  }
})();
