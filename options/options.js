import * as pdfjsLib from "../vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const HF = window.HireFlow;
const $ = (id) => document.getElementById(id);

const PROFILE_FIELDS = ["fullName", "headline", "phone", "location", "linkedinUrl", "resumeText", "extraNotes"];
const PREF_FIELDS = ["provider", "tone", "sendDelaySec", "gmailAccountIndex"];

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

function showTab(id) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
  if (id === "history") renderHistory();
}

async function load() {
  const s = await HF.storage.getSettings();
  PROFILE_FIELDS.forEach((k) => {
    if ($(k)) $(k).value = s[k] || "";
  });
  $("provider").value = s.provider || "chatgpt";
  $("tone").value = s.tone || "professional";
  $("sendDelaySec").value = s.sendDelaySec || 8;
  $("gmailAccountIndex").value = s.gmailAccountIndex || 0;
  $("closeAiTab").checked = Boolean(s.closeAiTab);
  $("confirmOnGmail").checked = Boolean(s.confirmOnGmail);
    $("attachResume").checked = s.attachResume !== false;
    if (s.resumeFileName) $("pdf-name").textContent = s.resumeFileName;
    if (s.resumeUpdatedAt) {
      const fileBit = s.hasResumeFile
        ? "PDF is stored locally and will be attached to outgoing mail."
        : "Text is saved, but the PDF file is missing — upload it again to enable attachments.";
      $("pdf-meta").textContent =
        "Extracted " + new Date(s.resumeUpdatedAt).toLocaleString() + ". " + fileBit;
    }
  updateSetupPill(s);
  renderHistory();
}

function updateSetupPill(s) {
  const ok = s.resumeText && s.resumeText.trim().length > 40 && s.fullName;
  const pill = $("setup-pill");
  pill.textContent = ok ? "Ready" : "Incomplete";
  pill.className = "pill " + (ok ? "ok" : "warn");
}

function readForm() {
  const patch = {};
  PROFILE_FIELDS.forEach((k) => {
    patch[k] = $(k).value.trim();
  });
  patch.provider = $("provider").value;
  patch.tone = $("tone").value;
  patch.sendDelaySec = clamp(Number($("sendDelaySec").value), 3, 30);
  patch.gmailAccountIndex = clamp(Number($("gmailAccountIndex").value), 0, 9);
  patch.closeAiTab = $("closeAiTab").checked;
  patch.confirmOnGmail = $("confirmOnGmail").checked;
  patch.attachResume = $("attachResume").checked;
  patch.setupComplete = Boolean(patch.resumeText && patch.resumeText.length > 40);
  return patch;
}

function clamp(n, a, b) {
  if (Number.isNaN(n)) return a;
  return Math.min(b, Math.max(a, n));
}

async function save(which) {
  const settings = await HF.storage.setSettings(readForm());
  updateSetupPill(settings);
  $("save-msg").textContent = which + " saved.";
  setTimeout(() => {
    if ($("save-msg").textContent.endsWith("saved.")) $("save-msg").textContent = "";
  }, 2200);
  return settings;
}

$("save-profile").addEventListener("click", () => save("Profile"));
$("save-prefs").addEventListener("click", () => save("Preferences"));

$("pick-pdf").addEventListener("click", () => $("pdf").click());
$("pdf").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) await ingestPdf(file);
});

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
});
["dragleave", "drop"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  });
});
drop.addEventListener("drop", async (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) await ingestPdf(file);
});

async function ingestPdf(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    $("save-msg").textContent = "Please drop a PDF.";
    return;
  }
  $("pdf-name").textContent = "Reading " + file.name + "…";
  try {
    const buf = await file.arrayBuffer();
    await HF.storage.setResumeFile({
      name: file.name,
      mime: file.type || "application/pdf",
      base64: arrayBufferToBase64(buf)
    });

    const text = await extractPdfText(file);
    if (text && text.length >= 10) {
      $("resumeText").value = text;
    }

    const currentText = ($("resumeText").value || text || "").trim();
    await HF.storage.setSettings({
      resumeText: currentText,
      resumeFileName: file.name,
      resumeUpdatedAt: Date.now(),
      hasResumeFile: true,
      setupComplete: true
    });
    $("pdf-name").textContent = file.name;
    $("pdf-meta").textContent =
      (currentText ? currentText.length.toLocaleString() + " characters loaded. " : "") +
      "PDF is stored locally and will be attached to outgoing emails.";
    $("save-msg").textContent = "Resume stored successfully.";
    updateSetupPill(await HF.storage.getSettings());
  } catch (err) {
    $("pdf-name").textContent = "Could not read PDF";
    $("pdf-meta").textContent = (err && err.message) || String(err);
    $("save-msg").textContent = "PDF extract failed — paste the text manually below.";
  }
}

async function extractPdfText(file) {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
          parts.push(line.trim());
          line = "";
        }
        line += item.str + (item.hasEOL ? "\n" : " ");
        lastY = y;
      }
      if (line.trim()) parts.push(line.trim());
      parts.push("");
    }
    return parts
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (e) {
    console.warn("PDF extract warning:", e);
    return "";
  }
}

$("clear-history").addEventListener("click", async () => {
  if (!confirm("Clear all HireFlow history on this browser?")) return;
  await HF.storage.clearHistory();
  renderHistory();
});

$("sample-btn").addEventListener("click", async () => {
  await save("Preferences");
  const sample = [
    "We are hiring a Senior Software Engineer at Northwind Labs.",
    "Remote-friendly. Stack: TypeScript, Node, Postgres, AWS.",
    "If this sounds like you, email careers@northwindlabs.example with your resume.",
    "We value clear writing and shipped product work."
  ].join("\n");
  await chrome.runtime.sendMessage({
    type: "HF_START_FROM_SELECTION",
    text: sample,
    sourceUrl: chrome.runtime.getURL("options/options.html"),
    sourceTitle: "HireFlow sample posting"
  });
});

async function renderHistory() {
  const items = await HF.storage.getHistory();
  const root = $("history-list");
  if (!items.length) {
    root.innerHTML = '<p class="muted">No applications yet. Your first send will show up here.</p>';
    return;
  }
  root.innerHTML = items
    .map((h) => {
      const when = new Date(h.sentAt || h.createdAt).toLocaleString();
      const pill = statusPill(h.status);
      return `<article class="card hist">
        <span class="pill ${pill.cls}">${escapeHtml(pill.label)}</span>
        <div>
          <strong>${escapeHtml(h.subject || "(no subject)")}</strong>
          <div class="sub">${escapeHtml(h.to || "no recipient")} · ${escapeHtml(h.provider || "")} · ${escapeHtml(when)}</div>
          <div class="sub">${escapeHtml(h.snippet || "")}</div>
        </div>
        <div class="tiny muted">${escapeHtml(h.companyGuess || "")}</div>
      </article>`;
    })
    .join("");
}

function statusPill(status) {
  const map = {
    sent: { label: "Sent", cls: "ok" },
    draft_only: { label: "Draft", cls: "warn" },
    cancelled: { label: "Cancelled", cls: "" },
    error: { label: "Error", cls: "err" }
  };
  return map[status] || { label: status || "—", cls: "" };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

load();
