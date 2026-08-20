(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  HF.DEFAULT_SETTINGS = {
    fullName: "",
    headline: "",
    phone: "",
    linkedinUrl: "",
    location: "",
    extraNotes: "",
    resumeText: "",
    resumeFileName: "",
    resumeUpdatedAt: null,
    hasResumeFile: false,
    attachResume: true,
    provider: "chatgpt",
    tone: "professional",
    sendDelaySec: 8,
    gmailAccountIndex: 0,
    closeAiTab: false,
    confirmOnGmail: false,
    setupComplete: false
  };

  HF.TONES = {
    professional: "Professional, confident, and concise. No fluff, no slang.",
    concise: "Very short and direct. 90–130 words. Every sentence earns its place.",
    warm: "Warm and human while still professional. Sound like a real person, not a template."
  };

  HF.PROVIDER_META = {
    chatgpt: {
      id: "chatgpt",
      label: "ChatGPT",
      urls: ["https://chatgpt.com/", "https://chat.openai.com/"],
      openUrl: "https://chatgpt.com/"
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      urls: ["https://gemini.google.com/app", "https://gemini.google.com/"],
      openUrl: "https://gemini.google.com/app"
    }
  };

  HF.STATUS = {
    queued: "Queued",
    configuring: "Needs setup",
    prompting: "Drafting with AI",
    parsing: "Reading the draft",
    review: "Ready to send",
    sending: "Sending via Gmail",
    sent: "Sent",
    cancelled: "Cancelled",
    error: "Error",
    draft_only: "Left as Gmail draft"
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
