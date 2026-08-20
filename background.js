/* HireFlow background orchestrator */
importScripts(
  "shared/boot.js",
  "shared/defaults.js",
  "shared/extract.js",
  "shared/prompt.js",
  "shared/parse.js",
  "shared/storage.js"
);

const HF = self.HireFlow;
const MENU_ID = "hireflow-apply";
const BUSY = new Set(["prompting", "parsing", "review", "sending"]);

chrome.runtime.onInstalled.addListener(async (details) => {
  await createMenu();
  await setupWatchdogAlarm();
  await initOrResumeQueue();
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await createMenu();
  await setupWatchdogAlarm();
  await initOrResumeQueue();
});

setupWatchdogAlarm().catch(() => {});
initOrResumeQueue().catch(() => {});

async function createMenu() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (e) {
    /* ignore */
  }
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "HireFlow: draft & send application",
    contexts: ["selection"]
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  let text = (info.selectionText || "").trim();
  if (tab && tab.id != null) {
    try {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (window.getSelection && window.getSelection().toString()) || ""
      });
      const live = inj && inj.result ? String(inj.result).trim() : "";
      if (live.length >= text.length) text = live;
    } catch (e) {
      /* no access to this page — fall back to selectionText */
    }
  }
  await startFromSelection({
    text,
    sourceUrl: (tab && tab.url) || "",
    sourceTitle: (tab && tab.title) || "",
    sourceTabId: tab && tab.id
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "apply-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let text = "";
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection && window.getSelection().toString()) || ""
    });
    text = (inj && inj.result) || "";
  } catch (e) {
    text = "";
  }
  if (!String(text).trim()) {
    await notify("Select the job post first", "Highlight the posting (include the hiring email), then try again.");
    return;
  }
  await startFromSelection({
    text,
    sourceUrl: tab.url || "",
    sourceTitle: tab.title || "",
    sourceTabId: tab.id
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((res) => sendResponse(res || { ok: true }))
    .catch((err) => sendResponse({ ok: false, error: humanizeAiError(err) }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (id) => {
  const job = await HF.storage.getCurrentJob();
  if (!job || job.reviewTabId !== id) return;
  job.reviewTabId = null;
  if (job.status === "review") job.autosendPaused = true;
  await HF.storage.setCurrentJob(job);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "hf-watchdog") {
    await initOrResumeQueue();
    return;
  }
  if (!alarm.name.startsWith("hf-timeout-")) return;
  const jobId = alarm.name.slice("hf-timeout-".length);
  const job = await HF.storage.getCurrentJob();
  if (!job || job.id !== jobId) return;
  if (job.status === "prompting" || job.status === "parsing") {
    await failJob(job, "The AI tab took too long to complete. Click Retry to try again.");
  }
  if (job.status === "sending") {
    await HF.storage.setCurrentJob(
      Object.assign({}, job, {
        status: "draft_only",
        error: "Gmail did not confirm send in time. Left as a Gmail draft."
      })
    );
    await archive(job);
    await HF.storage.removeFromQueue(job.id);
    await setBadge("?", "#fbbf24");
    await runQueueWorker();
  }
});

async function setupWatchdogAlarm() {
  try {
    await chrome.alarms.create("hf-watchdog", { periodInMinutes: 0.5 });
  } catch (e) {
    /* ignore */
  }
}

async function initOrResumeQueue() {
  try {
    const queue = await HF.storage.getJobQueue();
    const current = await HF.storage.getCurrentJob();

    if (current && ["prompting", "parsing", "sending"].includes(current.status)) {
      const elapsed = Date.now() - (current.updatedAt || current.createdAt || 0);
      if (elapsed > 45000) {
        if (current.status === "sending") {
          current.status = "draft_only";
          current.error = "Gmail fill timed out. Left as draft.";
          await HF.storage.setCurrentJob(current);
          await archive(current);
          await HF.storage.removeFromQueue(current.id);
        } else {
          current.status = "error";
          current.error = "Operation timed out. Auto-recovered.";
          await HF.storage.setCurrentJob(current);
          await HF.storage.removeFromQueue(current.id);
        }
        await runQueueWorker();
        return;
      }
    }

    await runQueueWorker();
  } catch (e) {
    /* ignore */
  }
}

async function broadcastStatus(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id) chrome.tabs.sendMessage(t.id, message).catch(() => {});
    }
  } catch (e) {
    /* ignore */
  }
}

async function handleMessage(msg, sender) {
  const type = msg && msg.type;
  if (!type) return { ok: false, error: "No message type" };

  if (type === "HF_START_FROM_SELECTION") {
    const res = await startFromSelection(
      Object.assign({}, msg, {
        sourceTabId: (sender.tab && sender.tab.id) || msg.sourceTabId
      })
    );
    return res || { ok: true };
  }
  if (type === "HF_GET_STATE") {
    const [settings, currentJob, history, queue] = await Promise.all([
      HF.storage.getSettings(),
      HF.storage.getCurrentJob(),
      HF.storage.getHistory(),
      HF.storage.getJobQueue()
    ]);
    return { ok: true, settings, currentJob, history, queue };
  }
  if (type === "HF_GET_QUEUE") {
    const queue = await HF.storage.getJobQueue();
    return { ok: true, queue };
  }
  if (type === "HF_CLEAR_QUEUE") {
    await HF.storage.clearJobQueue();
    await HF.storage.setCurrentJob(null);
    await broadcastStatus({ type: "HF_QUEUE_UPDATED", queue: [] });
    return { ok: true };
  }
  if (type === "HF_REMOVE_QUEUE_ITEM") {
    const queue = await HF.storage.getJobQueue();
    const target = queue.find((q) => q.id === msg.id);
    const filtered = queue.filter((q) => q.id !== msg.id);
    await HF.storage.setJobQueue(filtered);

    const current = await HF.storage.getCurrentJob();
    if (current && current.id === msg.id) {
      await HF.storage.setCurrentJob(null);
    }
    await broadcastStatus({ type: "HF_QUEUE_UPDATED", queue: filtered });
    if (target && ["prompting", "parsing", "review", "sending"].includes(target.status)) {
      await runQueueWorker();
    }
    return { ok: true, queue: filtered };
  }
  if (type === "HF_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  if (type === "HF_OPEN_REVIEW") {
    const job = await HF.storage.getCurrentJob();
    if (job) await openReviewWindow(job, true);
    return { ok: true };
  }
  if (type === "HF_CANCEL") {
    await cancelJob(msg.reason || "Cancelled");
    return { ok: true };
  }
  if (type === "HF_RETRY") {
    await retryJob(msg.provider);
    return { ok: true };
  }
  if (type === "HF_SEND_NOW") {
    await sendViaGmail(msg);
    return { ok: true };
  }
  if (type === "HF_SAVE_DRAFT") {
    await sendViaGmail(Object.assign({}, msg, { send: false }));
    return { ok: true };
  }
  if (type === "HF_AI_RESULT") {
    await onAiResult(msg, sender);
    return { ok: true };
  }
  if (type === "HF_GMAIL_RESULT") {
    await onGmailResult(msg, sender);
    return { ok: true };
  }
  if (type === "HF_CLEAR_HISTORY") {
    await HF.storage.clearHistory();
    return { ok: true };
  }
  if (type === "HF_RESEND") {
    await resendHistory(msg.id);
    return { ok: true };
  }
  return { ok: false, error: "Unknown message " + type };
}

async function startFromSelection({ text, sourceUrl, sourceTitle, sourceTabId }) {
  const selection = String(text || "").trim();
  if (selection.length < 8) {
    await notify("Nothing to send", "Select more of the job post, including the hiring email if it is there.");
    return { ok: false, error: "Selection too short" };
  }

  const settings = await HF.storage.getSettings();
  const meta = HF.extract.jobMeta(selection);

  const job = {
    id: "hf_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    status: "queued",
    selection,
    sourceUrl: sourceUrl || "",
    sourceTitle: sourceTitle || "",
    emails: meta.emails,
    companyGuess: meta.company,
    roleGuess: meta.role,
    looksLikeJob: meta.looksLikeJob,
    provider: settings.provider || "chatgpt",
    prompt: "",
    rawAi: "",
    to: meta.emails[0] || "",
    subject: "",
    body: "",
    error: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reviewTabId: null,
    sourceTabId: sourceTabId || null,
    aiTabId: null,
    gmailTabId: null,
    sentAt: null,
    autosendPaused: false
  };

  const seqNum = await HF.storage.getNextSeqNumber();
  job.seqNumber = seqNum;

  function isGenericFeedUrl(url) {
    if (!url) return true;
    return /\/feed\/|\/jobs\/|\/search\/|\/mynetwork\//i.test(url);
  }

  const queue = await HF.storage.getJobQueue();
  const isDuplicate = queue.some((q) => {
    if (q.selection === selection) return true;
    if (q.to && meta.emails[0] && q.to.toLowerCase() === meta.emails[0].toLowerCase()) {
      if (q.selection.slice(0, 60) === selection.slice(0, 60)) return true;
    }
    if (!isGenericFeedUrl(sourceUrl) && q.sourceUrl === sourceUrl) return true;
    return false;
  });

  if (isDuplicate) {
    const dupeJob = queue.find((q) => q.selection === selection || (q.to && meta.emails[0] && q.to.toLowerCase() === meta.emails[0].toLowerCase()));
    const pos = dupeJob && dupeJob.seqNumber ? dupeJob.seqNumber : queue.findIndex((q) => q.id === (dupeJob && dupeJob.id)) + 1;
    await notify("Already in Queue", `This job posting is already in your Apply Queue at position #${pos}.`);
    return { ok: true, queued: true, duplicate: true, position: pos, job: dupeJob };
  }

  await HF.storage.enqueueJob(job);
  const updatedQueue = await HF.storage.getJobQueue();

  await notify("Added to Apply Queue", `Position #${seqNum} in line for application.`);
  await broadcastStatus({ type: "HF_JOB_QUEUED", job, position: seqNum, queue: updatedQueue });

  const hasProfile = Boolean(
    (settings.resumeText && settings.resumeText.trim().length >= 10) ||
    (settings.fullName && settings.fullName.trim().length > 1)
  );

  if (!hasProfile) {
    job.status = "configuring";
    await HF.storage.updateJobInQueue(job.id, { status: "configuring" });
    await HF.storage.setCurrentJob(job);
    chrome.runtime.openOptionsPage();
    await notify("Upload your resume first", "HireFlow needs your profile details or PDF resume in Settings before drafting.");
    return { ok: false, error: "Profile setup missing. Please enter your name & resume in HireFlow Settings." };
  }

  runQueueWorker().catch(() => {});
  return { ok: true, queued: true, position: seqNum, job };
}

async function retryJob(provider) {
  const job = await HF.storage.getCurrentJob();
  if (!job) return;
  const settings = await HF.storage.getSettings();
  if (provider && HF.PROVIDER_META[provider]) {
    job.provider = provider;
  }
  job.error = "";
  job.rawAi = "";
  job.status = "prompting";
  job.prompt = HF.prompt.buildPrompt(settings, job);
  await HF.storage.setCurrentJob(job);
  await setBadge("…", "#2dd4bf");
  await runAi(job, settings);
}

async function runAi(job, settings) {
  const meta = HF.PROVIDER_META[job.provider] || HF.PROVIDER_META.chatgpt;
  try {
    const tab = await ensureHelperTab({
      hosts: hostsFromUrls(meta.urls),
      createUrl: meta.openUrl,
      sourceTabId: job.sourceTabId,
      existingId: job.aiTabId
    });
    job.aiTabId = tab.id;
    await HF.storage.setCurrentJob(job);
    chrome.alarms.create("hf-timeout-" + job.id, { delayInMinutes: 4 });

    await waitTabComplete(tab.id, 30000, hostsFromUrls(meta.urls)[0]);
    await sleep(1800);

    const files = scriptFilesFor(job.provider);
    const result = await callTab(tab.id, files, {
      type: "HF_RUN_AI",
      prompt: job.prompt,
      jobId: job.id,
      provider: job.provider
    });

    if (result && result.handled === false) {
      /* content script will post HF_AI_RESULT */
      return;
    }
    await onAiResult(
      Object.assign({ jobId: job.id }, result || { ok: false, error: "No response from AI tab" }),
      { tab }
    );
  } catch (err) {
    await failJob(job, humanizeAiError(err));
  }
}

function scriptFilesFor(provider) {
  if (provider === "gemini") {
    return ["shared/boot.js", "shared/dom.js", "shared/hud.js", "content/gemini.js"];
  }
  return ["shared/boot.js", "shared/dom.js", "shared/hud.js", "content/chatgpt.js"];
}

function gmailFiles() {
  return [
    "shared/boot.js",
    "shared/defaults.js",
    "shared/storage.js",
    "shared/dom.js",
    "shared/hud.js",
    "content/gmail.js"
  ];
}

async function onAiResult(msg, sender) {
  const job = await HF.storage.getCurrentJob();
  if (!job) return;
  if (msg.jobId && msg.jobId !== job.id) return;
  if (["review", "sending", "sent", "draft_only", "cancelled"].includes(job.status)) return;

  try {
    chrome.alarms.clear("hf-timeout-" + job.id);
  } catch (e) {
    /* ignore */
  }

  if (!msg.ok) {
    await failJob(job, msg.error || "The AI tab could not finish the draft.");
    return;
  }

  job.status = "parsing";
  job.rawAi = msg.text || "";
  await HF.storage.setCurrentJob(job);

  const parsed = HF.parse.parseGeneratedEmail(job.rawAi, job.emails[0] || job.to);
  job.to = parsed.to || job.emails[0] || "";
  job.subject = parsed.subject || fallbackSubject(job);
  job.body = parsed.body || "";
  job.status = "review";
  job.error = "";
  if (!parsed.parsed) {
    job.error = "Could not fully parse the AI output. Review the draft before sending.";
  }
  await HF.storage.setCurrentJob(job);
  await HF.storage.updateJobInQueue(job.id, {
    status: "review",
    to: job.to,
    subject: job.subject,
    body: job.body,
    error: job.error
  });
  await setBadge("OK", "#2dd4bf");
  await openReviewWindow(job);

  const settings = await HF.storage.getSettings();
  if (settings.closeAiTab && job.aiTabId) {
    try {
      await chrome.tabs.remove(job.aiTabId);
    } catch (e) {
      /* ignore */
    }
  }
}

function fallbackSubject(job) {
  const role = job.roleGuess || "Role";
  const company = job.companyGuess ? " — " + job.companyGuess : "";
  return "Application for " + role + company;
}

async function sendViaGmail(payload) {
  const job = await HF.storage.getCurrentJob();
  if (!job) throw new Error("No active draft");
  const settings = await HF.storage.getSettings();

  const to = String((payload && payload.to) || job.to || "").trim();
  const subject = String((payload && payload.subject) || job.subject || "").trim();
  const body = String((payload && payload.body) || job.body || "").trim();
  const shouldSend = payload && payload.send === false ? false : true;

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Add a valid recipient email before sending.");
  }
  if (!subject || !body) {
    throw new Error("Subject and body cannot be empty.");
  }

  job.to = to;
  job.subject = subject;
  job.body = body;
  job.status = "sending";
  job.error = "";
  await HF.storage.setCurrentJob(job);
  await setBadge("↗", "#2dd4bf");

  const idx = Number(settings.gmailAccountIndex || 0) || 0;
  const inbox = "https://mail.google.com/mail/u/" + idx + "/";
  const payloadMsg = {
    type: "HF_FILL_GMAIL",
    jobId: job.id,
    to,
    subject,
    body,
    send: shouldSend,
    confirm: Boolean(settings.confirmOnGmail),
    attach: settings.attachResume !== false
  };

  try {
    let tab = await ensureHelperTab({
      hosts: ["mail.google.com"],
      createUrl: inbox,
      sourceTabId: job.sourceTabId,
      existingId: job.gmailTabId,
      urlHint: "/mail/u/" + idx + "/"
    });
    job.gmailTabId = tab.id;
    await HF.storage.setCurrentJob(job);
    chrome.alarms.create("hf-timeout-" + job.id, { delayInMinutes: 1 });

    await waitTabComplete(tab.id, 30000, "mail.google.com");
    await sleep(1600);

    let result;
    try {
      result = await callTab(tab.id, gmailFiles(), payloadMsg);
    } catch (err) {
      if (!/No tab with id/i.test(String(err && err.message))) throw err;
      tab = await ensureHelperTab({
        hosts: ["mail.google.com"],
        createUrl: inbox,
        sourceTabId: job.sourceTabId,
        existingId: null,
        urlHint: "/mail/u/" + idx + "/"
      });
      job.gmailTabId = tab.id;
      await HF.storage.setCurrentJob(job);
      await sleep(1600);
      result = await callTab(tab.id, gmailFiles(), payloadMsg);
    }

    if (result && result.handled === false) return;
    await onGmailResult(
      Object.assign({ jobId: job.id, send: shouldSend }, result || { ok: false, error: "No response from Gmail" })
    );
  } catch (err) {
    const cur = await HF.storage.getCurrentJob();
    if (cur && cur.id === job.id && cur.status === "sending") {
      cur.status = "review";
      cur.error = humanizeAiError(err);
      await HF.storage.setCurrentJob(cur);
    }
    throw err;
  }
}

let isWorkerRunning = false;

async function runQueueWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  try {
    const queue = await HF.storage.getJobQueue();
    if (!queue.length) return;

    const settings = await HF.storage.getSettings();
    const hasProfile = Boolean(
      (settings.resumeText && settings.resumeText.trim().length >= 10) ||
      (settings.fullName && settings.fullName.trim().length > 1)
    );
    if (!hasProfile) {
      return;
    }

    const active = queue.find((q) => ["prompting", "parsing", "review", "sending"].includes(q.status));
    if (active) {
      return;
    }

    const nextJob = queue.find((q) => q.status === "queued");
    if (!nextJob) return;

    nextJob.status = "prompting";
    nextJob.prompt = HF.prompt.buildPrompt(settings, nextJob);
    await HF.storage.updateJobInQueue(nextJob.id, { status: "prompting", prompt: nextJob.prompt });
    await HF.storage.setCurrentJob(nextJob);

    await setBadge("…", "#2dd4bf");
    const updatedQueue = await HF.storage.getJobQueue();
    await broadcastStatus({ type: "HF_JOB_STARTED", job: nextJob, queue: updatedQueue });
    await openReviewWindow(nextJob, false);
    await notify("Processing Application", `Drafting application for ${nextJob.roleGuess || "Role"} (${nextJob.to || "Hiring Team"})`);
    await runAi(nextJob, settings);
  } catch (err) {
    /* ignore */
  } finally {
    isWorkerRunning = false;
  }
}

async function onGmailResult(msg) {
  const job = await HF.storage.getCurrentJob();
  if (!job) return;
  if (msg.jobId && msg.jobId !== job.id) return;
  if (job.status !== "sending") return;

  try {
    chrome.alarms.clear("hf-timeout-" + job.id);
  } catch (e) {
    /* ignore */
  }

  if (!msg.ok) {
    job.status = "draft_only";
    job.error = msg.error || "Could not click Send. The compose window was left open for you.";
    await HF.storage.setCurrentJob(job);
    await archive(job);
    await HF.storage.removeFromQueue(job.id);
    await setBadge("!", "#fbbf24");
    await notify("Left as a Gmail draft", job.error);
    await broadcastStatus({ type: "HF_JOB_FINISHED", job, queue: await HF.storage.getJobQueue() });
    await runQueueWorker();
    return;
  }

  if (msg.sent === false || msg.send === false) {
    job.status = "draft_only";
    job.error = "";
    await HF.storage.setCurrentJob(job);
    await archive(job);
    await HF.storage.removeFromQueue(job.id);
    await setBadge("✎", "#d4a017");
    await notify("Gmail draft ready", "Review it in the compose window and send when you want.");
    await broadcastStatus({ type: "HF_JOB_FINISHED", job, queue: await HF.storage.getJobQueue() });
    await runQueueWorker();
    return;
  }

  job.status = "sent";
  job.sentAt = Date.now();
  job.error = "";
  await HF.storage.setCurrentJob(job);
  await archive(job);
  await HF.storage.removeFromQueue(job.id);
  await setBadge("✓", "#34d399");
  await notify("Email sent", (job.to ? "Sent to " + job.to : "Sent from Gmail") + ".");
  await broadcastStatus({ type: "HF_JOB_FINISHED", job, queue: await HF.storage.getJobQueue() });
  setTimeout(async () => {
    await setBadge("", "#2dd4bf");
    await runQueueWorker();
  }, 1500);
}

async function cancelJob(reason) {
  const job = await HF.storage.getCurrentJob();
  if (!job) return;
  job.status = "cancelled";
  job.error = reason || "Cancelled";
  await HF.storage.setCurrentJob(job);
  await archive(job);
  await HF.storage.removeFromQueue(job.id);
  await setBadge("", "#2dd4bf");
  await broadcastStatus({ type: "HF_JOB_CANCELLED", job, queue: await HF.storage.getJobQueue() });
  await runQueueWorker();
}

async function failJob(job, error) {
  const cur = job || (await HF.storage.getCurrentJob());
  if (!cur) return;
  cur.status = "error";
  cur.error = error;
  await HF.storage.setCurrentJob(cur);
  await HF.storage.removeFromQueue(cur.id);
  await setBadge("!", "#fb7185");
  await notify("HireFlow hit a snag", error);
  await broadcastStatus({ type: "HF_JOB_FAILED", job: cur, error, queue: await HF.storage.getJobQueue() });
  await runQueueWorker();
}

async function archive(job) {
  await HF.storage.pushHistory({
    id: job.id,
    createdAt: job.createdAt,
    sentAt: job.sentAt,
    status: job.status,
    to: job.to,
    subject: job.subject,
    provider: job.provider,
    sourceUrl: job.sourceUrl,
    snippet: HF.extract.snippet(job.selection, 160),
    companyGuess: job.companyGuess,
    roleGuess: job.roleGuess,
    error: job.error || ""
  });
}

async function resendHistory(id) {
  const history = await HF.storage.getHistory();
  const item = history.find((h) => h.id === id);
  const current = await HF.storage.getCurrentJob();
  if (!item) throw new Error("History item not found");
  if (!current || current.id !== id || !current.body) {
    throw new Error("Open that run from the current draft if you want to resend. History keeps a summary only.");
  }
  await sendViaGmail({ to: current.to, subject: current.subject, body: current.body, send: true });
}

async function openReviewWindow(job, active = false) {
  const url = chrome.runtime.getURL("review/review.html");
  if (job.reviewTabId) {
    try {
      const t = await chrome.tabs.get(job.reviewTabId);
      if (t && t.id) {
        if (active) {
          await chrome.tabs.update(t.id, { url, active: true });
          if (t.windowId) {
            try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          }
        }
        return;
      }
    } catch (e) {
      job.reviewTabId = null;
    }
  }

  try {
    const tab = await chrome.tabs.create({ url, active: Boolean(active) });
    job.reviewTabId = tab ? tab.id : null;
  } catch (e) {
    job.reviewTabId = null;
  }
  await HF.storage.setCurrentJob(job);
}

function hostsFromUrls(urls) {
  return (urls || [])
    .map((u) => {
      try {
        return new URL(u).hostname;
      } catch (e) {
        return "";
      }
    })
    .filter(Boolean);
}

function tabHost(tab) {
  try {
    return tab && tab.url ? new URL(tab.url).hostname : "";
  } catch (e) {
    return "";
  }
}

function hostMatches(hostname, hosts) {
  if (!hostname) return false;
  return (hosts || []).some((h) => hostname === h || hostname.endsWith("." + h));
}

async function tabExists(id) {
  if (id == null) return false;
  try {
    await chrome.tabs.get(id);
    return true;
  } catch (e) {
    return false;
  }
}

async function getNormalWindowId(preferredTabId) {
  if (preferredTabId) {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t && t.windowId != null) {
        const w = await chrome.windows.get(t.windowId);
        if (w && w.type === "normal") return w.id;
      }
    } catch (e) {
      /* ignore */
    }
  }
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const focused = wins.find((w) => w.focused);
  return (focused || wins[0] || {}).id;
}

async function createBackgroundTab(url, sourceTabId) {
  const windowId = await getNormalWindowId(sourceTabId);
  const opts = { url: url, active: false };
  if (windowId) opts.windowId = windowId;
  const tab = await chrome.tabs.create(opts);
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch (e) {
    /* ignore */
  }
  return tab;
}

async function findTabByHosts(hosts, urlHint) {
  try {
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((t) => hostMatches(tabHost(t), hosts));
    if (urlHint) {
      const preferred = matches.find((t) => t.url && t.url.indexOf(urlHint) !== -1);
      if (preferred) return preferred;
    }
    const active = matches.find((t) => t.active);
    return active || matches[0] || null;
  } catch (e) {
    return null;
  }
}

async function ensureHelperTab({ hosts, createUrl, sourceTabId, existingId, urlHint }) {
  if (existingId && (await tabExists(existingId))) {
    const t = await chrome.tabs.get(existingId);
    if (hostMatches(tabHost(t), hosts)) {
      try {
        await chrome.tabs.update(t.id, { autoDiscardable: false });
      } catch (e) {}
      return t;
    }
  }

  const tabCache = await HF.storage.getTabCache();
  const isGmail = (hosts || []).includes("mail.google.com");
  const cachedId = isGmail ? tabCache.lastGmailTabId : tabCache.lastAiTabId;
  if (cachedId && (await tabExists(cachedId))) {
    const t = await chrome.tabs.get(cachedId);
    if (hostMatches(tabHost(t), hosts)) {
      try {
        await chrome.tabs.update(t.id, { autoDiscardable: false });
      } catch (e) {}
      return t;
    }
  }

  const hit = await findTabByHosts(hosts, urlHint);
  if (hit) {
    try {
      await chrome.tabs.update(hit.id, { autoDiscardable: false });
    } catch (e) {}
    if (isGmail) {
      await HF.storage.setTabCache({ lastGmailTabId: hit.id });
    } else {
      await HF.storage.setTabCache({ lastAiTabId: hit.id });
    }
    return hit;
  }

  const tab = await createBackgroundTab(createUrl, sourceTabId);
  await waitTabComplete(tab.id, 30000, hosts && hosts[0]);
  if (isGmail) {
    await HF.storage.setTabCache({ lastGmailTabId: tab.id });
  } else {
    await HF.storage.setTabCache({ lastAiTabId: tab.id });
  }
  return tab;
}

async function waitTabComplete(tabId, timeout, expectedHost) {
  const limit = timeout || 30000;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (ok, err) => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearInterval(poll);
      if (ok) resolve();
      else reject(err || new Error("Tab took too long to load"));
    };
    const ready = (tab) => {
      if (!tab || tab.status !== "complete") return false;
      if (!tab.url || tab.url === "about:blank" || tab.url.startsWith("chrome://")) return false;
      if (expectedHost && tab.url.indexOf(expectedHost) === -1) return false;
      return true;
    };
    const listener = (id, info, tab) => {
      if (id === tabId && ready(tab || { status: info.status, url: info.url })) done(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
    const poll = setInterval(async () => {
      if (Date.now() - start > limit) return done(false);
      try {
        const tab = await chrome.tabs.get(tabId);
        if (ready(tab)) done(true);
      } catch (e) {
        done(false, new Error("The helper tab was closed. Keep one ChatGPT/Gemini tab and one Gmail tab open."));
      }
    }, 400);
  });
}

async function callTab(tabId, files, message) {
  if (!(await tabExists(tabId))) {
    throw new Error("No tab with id: " + tabId);
  }
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    if (!(await tabExists(tabId))) {
      throw new Error("No tab with id: " + tabId);
    }
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      if (res && res.skipped) {
        await sleep(400);
        continue;
      }
      if (res) return res;
    } catch (err) {
      lastErr = err;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files
        });
      } catch (injErr) {
        lastErr = injErr;
      }
      await sleep(700);
    }
  }
  throw lastErr || new Error("Could not talk to the page. Are you logged in?");
}

function humanizeAiError(err) {
  const m = (err && err.message) || String(err);
  if (/No tab with id/i.test(m)) {
    return "A helper tab disappeared. Keep one ChatGPT/Gemini tab and one Gmail tab open — HireFlow reuses them in the background and will not leave LinkedIn.";
  }
  if (/Could not talk|Receiving end|Could not establish/i.test(m)) {
    return "Could not control the AI tab. Open ChatGPT or Gemini, log in, then retry. Stay on LinkedIn — HireFlow works in that background tab.";
  }
  return m;
}

async function notify(title, message) {
  try {
    await chrome.notifications.create("hf_" + Date.now(), {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message: String(message || "").slice(0, 220)
    });
  } catch (e) {
    /* notifications may be blocked */
  }
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: color || "#2dd4bf" });
    await chrome.action.setBadgeText({ text: text || "" });
  } catch (e) {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
