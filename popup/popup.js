(function () {
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", refresh);
  $("open-options").addEventListener("click", () => chrome.runtime.sendMessage({ type: "HF_OPEN_OPTIONS" }));
  $("open-review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "HF_OPEN_REVIEW" }));
  $("cancel-job").addEventListener("click", () => chrome.runtime.sendMessage({ type: "HF_CANCEL", reason: "Cancelled from popup" }));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") refresh();
  });

  chrome.runtime.onMessage.addListener(() => refresh());

  if ($("clear-queue-btn")) {
    $("clear-queue-btn").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "HF_CLEAR_QUEUE" });
      refresh();
    });
  }

  async function refresh() {
    const res = await chrome.runtime.sendMessage({ type: "HF_GET_STATE" });
    if (!res || !res.ok) return;
    const { settings, currentJob, history } = res;

    const ready = settings.resumeText && settings.resumeText.trim().length > 40;
    $("ready-pill").textContent = ready ? "Ready" : "Setup needed";
    $("ready-pill").className = "pill " + (ready ? "ok" : "warn");
    $("ready-text").textContent = ready
      ? (settings.fullName || "Resume loaded") + " · " + (settings.provider === "gemini" ? "Gemini" : "ChatGPT")
      : "Open settings and upload your PDF resume.";

    if (!currentJob) {
      $("job-title").textContent = "Nothing in flight";
      $("job-sub").textContent = "Select a posting, then right-click → HireFlow.";
      $("open-review").classList.add("hidden");
      $("cancel-job").classList.add("hidden");
    } else {
      const label = (self.HireFlow.STATUS && self.HireFlow.STATUS[currentJob.status]) || currentJob.status;
      $("job-title").textContent = currentJob.subject || currentJob.roleGuess || "Draft in progress";
      $("job-sub").textContent = label + (currentJob.to ? " · " + currentJob.to : "");
      $("open-review").classList.remove("hidden");
      $("cancel-job").classList.toggle("hidden", ["sent", "cancelled"].includes(currentJob.status));
    }

    const queue = res.queue || [];
    const queueCard = $("queue-card");
    if (queueCard) {
      $("queue-count").textContent = `${queue.length} queued`;
      if (queue.length) {
        $("queue-list").innerHTML = queue
          .map(
            (q, idx) => `
          <div class="queue-item">
            <span class="queue-badge">#${q.seqNumber || (idx + 1)}</span>
            <div class="queue-details">
              <div class="row-between">
                <strong>${esc(q.roleGuess || q.companyGuess || "Job Posting")}</strong>
                <span class="pill ${queueStatusPill(q.status)} micro-pill">${esc(formatStatus(q.status))}</span>
              </div>
              <div class="tiny muted">${esc(q.to || "Hiring email")}</div>
            </div>
            <button class="queue-remove-btn" data-id="${esc(q.id)}" title="Remove item">✕</button>
          </div>
        `
          )
          .join("");

        $("queue-list").querySelectorAll(".queue-remove-btn").forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await chrome.runtime.sendMessage({ type: "HF_REMOVE_QUEUE_ITEM", id });
            refresh();
          });
        });
      } else {
        $("queue-list").innerHTML = '<div class="tiny muted" style="padding: 6px 0;">No tasks waiting in queue. Click <strong>Apply</strong> on any LinkedIn post to queue jobs.</div>';
      }
    }

    const recent = (history || []).slice(0, 4);
    if (!recent.length) {
      $("recent").innerHTML = '<div class="tiny muted">No sends yet.</div>';
      return;
    }
    $("recent").innerHTML = recent
      .map((h) => {
        return `<div class="recent-item">
          <strong>${esc(h.subject || "Untitled")}</strong>
          <div class="tiny muted">${esc(h.status)} · ${esc(h.to || "")}</div>
        </div>`;
      })
      .join("");
  }

  function formatStatus(status) {
    if (status === "prompting") return "Drafting…";
    if (status === "parsing") return "Parsing…";
    if (status === "review") return "In Review";
    if (status === "sending") return "Sending…";
    if (status === "queued") return "Queued";
    return status || "Queued";
  }

  function queueStatusPill(status) {
    if (status === "prompting" || status === "parsing" || status === "sending") return "teal";
    if (status === "review") return "warn";
    return "ok";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
