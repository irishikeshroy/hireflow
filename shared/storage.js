(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  async function getSettings() {
    const data = await chrome.storage.local.get("settings");
    return Object.assign({}, HF.DEFAULT_SETTINGS, data.settings || {});
  }

  async function setSettings(patch) {
    const cur = await getSettings();
    const settings = Object.assign({}, cur, patch);
    await chrome.storage.local.set({ settings });
    return settings;
  }

  async function getCurrentJob() {
    const data = await chrome.storage.local.get("currentJob");
    return data.currentJob || null;
  }

  async function setCurrentJob(job) {
    if (!job) {
      await chrome.storage.local.remove("currentJob");
      return null;
    }
    job.updatedAt = Date.now();
    await chrome.storage.local.set({ currentJob: job });
    return job;
  }

  async function patchCurrentJob(patch) {
    const job = await getCurrentJob();
    if (!job) return null;
    return setCurrentJob(Object.assign({}, job, patch));
  }

  async function getHistory() {
    const data = await chrome.storage.local.get("history");
    return Array.isArray(data.history) ? data.history : [];
  }

  async function pushHistory(entry) {
    const history = await getHistory();
    history.unshift(entry);
    await chrome.storage.local.set({ history: history.slice(0, 80) });
    return history;
  }

  async function clearHistory() {
    await chrome.storage.local.set({ history: [] });
  }

  async function getResumeFile() {
    const data = await chrome.storage.local.get("resumeFile");
    return data.resumeFile || null;
  }

  async function setResumeFile(file) {
    if (!file) {
      await chrome.storage.local.remove("resumeFile");
      return null;
    }
    await chrome.storage.local.set({ resumeFile: file });
    return file;
  }

  async function getJobQueue() {
    const data = await chrome.storage.local.get("jobQueue");
    return Array.isArray(data.jobQueue) ? data.jobQueue : [];
  }

  async function setJobQueue(queue) {
    const arr = Array.isArray(queue) ? queue : [];
    await chrome.storage.local.set({ jobQueue: arr });
    return arr;
  }

  async function enqueueJob(job) {
    const queue = await getJobQueue();
    queue.push(job);
    await setJobQueue(queue);
    return queue;
  }

  async function dequeueJob() {
    const queue = await getJobQueue();
    if (!queue.length) return null;
    const next = queue.shift();
    await setJobQueue(queue);
    return next;
  }

  async function updateJobInQueue(jobId, patch) {
    const queue = await getJobQueue();
    const idx = queue.findIndex((q) => q.id === jobId);
    if (idx !== -1) {
      queue[idx] = Object.assign({}, queue[idx], patch, { updatedAt: Date.now() });
      await setJobQueue(queue);
    }
    return queue;
  }

  async function removeFromQueue(jobId) {
    const queue = await getJobQueue();
    const filtered = queue.filter((q) => q.id !== jobId);
    await setJobQueue(filtered);
    return filtered;
  }

  async function clearJobQueue() {
    await chrome.storage.local.set({ jobQueue: [] });
    return [];
  }

  async function getNextSeqNumber() {
    const data = await chrome.storage.local.get("jobSeqCounter");
    const next = (Number(data.jobSeqCounter) || 0) + 1;
    await chrome.storage.local.set({ jobSeqCounter: next });
    return next;
  }

  async function getTabCache() {
    const data = await chrome.storage.local.get(["lastAiTabId", "lastGmailTabId"]);
    return {
      lastAiTabId: data.lastAiTabId || null,
      lastGmailTabId: data.lastGmailTabId || null
    };
  }

  async function setTabCache(patch) {
    await chrome.storage.local.set(patch);
  }

  HF.storage = {
    getSettings,
    setSettings,
    getCurrentJob,
    setCurrentJob,
    patchCurrentJob,
    getHistory,
    pushHistory,
    clearHistory,
    getResumeFile,
    setResumeFile,
    getJobQueue,
    setJobQueue,
    enqueueJob,
    dequeueJob,
    updateJobInQueue,
    removeFromQueue,
    clearJobQueue,
    getNextSeqNumber,
    getTabCache,
    setTabCache
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
