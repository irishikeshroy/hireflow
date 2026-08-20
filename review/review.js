(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    pill: $("status-pill"),
    sourceLabel: $("source-label"),
    sourceTitle: $("source-title"),
    sourceLink: $("source-link"),
    snippet: $("snippet"),
    progress: $("progress"),
    progressTitle: $("progress-title"),
    progressSub: $("progress-sub"),
    errorBox: $("error-box"),
    form: $("draft-form"),
    to: $("to"),
    subject: $("subject"),
    body: $("body"),
    countdown: $("countdown"),
    countNum: $("count-num"),
    countBar: $("count-bar"),
    pauseBtn: $("pause-btn"),
    cancelBtn: $("cancel-btn"),
    retryBtn: $("retry-btn"),
    retryOther: $("retry-other"),
    draftBtn: $("draft-btn"),
    sendBtn: $("send-btn")
  };

  let job = null;
  let settings = null;
  let dirty = false;
  let timer = null;
  let remaining = 0;
  let total = 8;
  let paused = false;
  let sending = false;
  let lastJobId = null;
  let lastStatus = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    await refresh();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.currentJob || changes.settings) refresh();
    });

    ["to", "subject", "body"].forEach((id) => {
      els[id].addEventListener("input", () => {
        dirty = true;
        pauseCountdown();
      });
    });

    els.pauseBtn.addEventListener("click", () => {
      if (paused) resumeCountdown();
      else pauseCountdown();
    });
    els.cancelBtn.addEventListener("click", () => sendMsg({ type: "HF_CANCEL", reason: "Cancelled from review" }));
    els.retryBtn.addEventListener("click", () => sendMsg({ type: "HF_RETRY" }));
    els.retryOther.addEventListener("click", () => {
      const next = job && job.provider === "gemini" ? "chatgpt" : "gemini";
      sendMsg({ type: "HF_RETRY", provider: next });
    });
    els.sendBtn.addEventListener("click", () => doSend(true));
    els.draftBtn.addEventListener("click", () => doSend(false));
  }

  async function refresh() {
    const res = await sendMsg({ type: "HF_GET_STATE" });
    if (!res || !res.ok) return;
    settings = res.settings;
    job = res.currentJob;
    render();
  }

  function render() {
    if (!job) {
      els.pill.textContent = "Idle";
      els.progressTitle.textContent = "No active draft";
      els.progressSub.textContent = "Select a job post on LinkedIn and right-click → HireFlow.";
      els.form.classList.add("hidden");
      els.countdown.classList.add("hidden");
      hideActions();
      return;
    }

    if (job.id !== lastJobId) {
      lastJobId = job.id;
      dirty = false;
      stopCountdown();
    }

    const label = (HireFlow.STATUS && HireFlow.STATUS[job.status]) || job.status;
    els.pill.textContent = label;
    els.pill.className = "pill " + pillClass(job.status);

    els.sourceLabel.textContent = job.roleGuess || job.companyGuess || "Selected posting";
    els.sourceTitle.textContent = job.sourceTitle || hostOf(job.sourceUrl) || "Unknown page";
    if (job.sourceUrl) {
      els.sourceLink.href = job.sourceUrl;
      els.sourceLink.classList.remove("hidden");
    } else {
      els.sourceLink.classList.add("hidden");
    }
    els.snippet.textContent = (job.selection || "").replace(/\s+/g, " ").trim();

    if (job.error && (job.status === "error" || job.status === "review" || job.status === "draft_only")) {
      els.errorBox.textContent = job.error;
      els.errorBox.classList.remove("hidden");
    } else {
      els.errorBox.classList.add("hidden");
    }

    const working = job.status === "prompting" || job.status === "parsing" || job.status === "queued" || job.status === "sending";
    els.progress.classList.toggle("hidden", !working);
    if (job.status === "prompting") {
      const name = job.provider === "gemini" ? "Gemini" : "ChatGPT";
      els.progressTitle.textContent = "Drafting with " + name + "…";
      els.progressSub.textContent = "Working in your existing ChatGPT/Gemini tab. Stay on LinkedIn.";
    } else if (job.status === "parsing") {
      els.progressTitle.textContent = "Reading the draft…";
      els.progressSub.textContent = "Splitting To, Subject, and Body.";
    } else if (job.status === "sending") {
      els.progressTitle.textContent = "Sending via Gmail…";
      els.progressSub.textContent = "Filling your existing Gmail tab in the background. LinkedIn stays put.";
    }

    const showForm = ["review", "sent", "draft_only", "cancelled", "error"].includes(job.status);
    els.form.classList.toggle("hidden", !showForm);
    if (showForm && !dirty) {
      els.to.value = job.to || "";
      els.subject.value = job.subject || "";
      els.body.value = job.body || "";
    }
    if (els.attachNote) {
      if (settings && settings.hasResumeFile && settings.attachResume !== false) {
        els.attachNote.textContent = "Will attach " + (settings.resumeFileName || "your resume PDF") + " in Gmail.";
      } else if (settings && settings.resumeText && !settings.hasResumeFile) {
        els.attachNote.textContent = "Re-upload the PDF in Settings so HireFlow can attach the file (text-only is already saved).";
      } else {
        els.attachNote.textContent = "";
      }
    }

    const canSend = job.status === "review";
    els.sendBtn.classList.toggle("hidden", !canSend);
    els.draftBtn.classList.toggle("hidden", !canSend);
    els.retryBtn.classList.toggle("hidden", !(job.status === "error" || job.status === "review"));
    els.retryOther.classList.toggle("hidden", !(job.status === "error" || job.status === "review"));
    if (job.provider === "gemini") els.retryOther.textContent = "Retry with ChatGPT";
    else els.retryOther.textContent = "Retry with Gemini";

    els.cancelBtn.classList.toggle("hidden", ["sent", "cancelled"].includes(job.status));
    els.sendBtn.disabled = sending;
    els.draftBtn.disabled = sending;

    if (job.status === "review" && lastStatus !== "review") {
      startCountdown();
    }
    if (job.status !== "review") stopCountdown();
    lastStatus = job.status;
  }

  function pillClass(status) {
    if (status === "sent") return "ok";
    if (status === "error") return "err";
    if (status === "review" || status === "draft_only") return "warn";
    if (status === "prompting" || status === "sending" || status === "parsing") return "teal";
    return "";
  }

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function hideActions() {
    els.sendBtn.classList.add("hidden");
    els.draftBtn.classList.add("hidden");
    els.retryBtn.classList.add("hidden");
    els.retryOther.classList.add("hidden");
  }

  function startCountdown() {
    if (paused || timer) return;
    if (job && job.autosendPaused) {
      paused = true;
      els.countdown.classList.remove("hidden");
      els.countNum.textContent = "paused";
      els.pauseBtn.textContent = "Resume";
      els.countBar.style.transform = "scaleX(1)";
      return;
    }
    total = Math.max(3, Number(settings && settings.sendDelaySec) || 8);
    remaining = total;
    paused = false;
    els.countdown.classList.remove("hidden");
    els.pauseBtn.textContent = "Pause";
    tick();
    timer = setInterval(tick, 250);
  }

  function tick() {
    if (paused) return;
    remaining = Math.max(0, remaining - 0.25);
    els.countNum.textContent = String(Math.ceil(remaining));
    els.countBar.style.transform = "scaleX(" + remaining / total + ")";
    if (remaining <= 0) {
      stopCountdown();
      doSend(true);
    }
  }

  function pauseCountdown() {
    paused = true;
    els.pauseBtn.textContent = "Resume";
    if (els.countNum.textContent !== "paused") els.countNum.textContent = "paused";
  }

  function resumeCountdown() {
    if (!job || job.status !== "review") return;
    paused = false;
    els.pauseBtn.textContent = "Pause";
    if (!timer) {
      remaining = remaining || total;
      timer = setInterval(tick, 250);
    }
  }

  function stopCountdown() {
    if (timer) clearInterval(timer);
    timer = null;
    els.countdown.classList.add("hidden");
  }

  async function doSend(send) {
    if (sending) return;
    const to = els.to.value.trim();
    const subject = els.subject.value.trim();
    const body = els.body.value.trim();
    if (!to || !subject || !body) {
      els.errorBox.textContent = "To, subject, and body are required before Gmail can send.";
      els.errorBox.classList.remove("hidden");
      pauseCountdown();
      return;
    }
    sending = true;
    stopCountdown();
    els.sendBtn.disabled = true;
    els.draftBtn.disabled = true;
    try {
      const res = await sendMsg({
        type: send ? "HF_SEND_NOW" : "HF_SAVE_DRAFT",
        to,
        subject,
        body,
        send
      });
      if (res && res.ok === false) throw new Error(res.error || "Send failed");
    } catch (err) {
      els.errorBox.textContent = err.message || String(err);
      els.errorBox.classList.remove("hidden");
    } finally {
      sending = false;
    }
  }

  function sendMsg(msg) {
    return chrome.runtime.sendMessage(msg);
  }
})();
