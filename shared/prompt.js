(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  function clip(text, max) {
    const t = String(text || "").trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + "\n\n[truncated]";
  }

  function buildPrompt(settings, job) {
    const tone = (HF.TONES && HF.TONES[settings.tone]) || HF.TONES.professional;
    const name = settings.fullName || "the candidate";
    const bits = [];
    if (settings.headline) bits.push(`Headline/Target: ${settings.headline}`);
    if (settings.location) bits.push(`Location: ${settings.location}`);
    if (settings.phone) bits.push(`Phone: ${settings.phone}`);
    if (settings.linkedinUrl) bits.push(`LinkedIn: ${settings.linkedinUrl}`);

    const candidateProfile = bits.join("\n") || "Name: " + name;
    const candidateNotes = settings.extraNotes ? clip(settings.extraNotes, 1500) : "None";

    return [
      `=== TASK & INSTRUCTIONS ===`,
      `You are writing a tailored, highly compelling job application email on behalf of candidate: ${name}.`,
      `Desired Tone: ${tone}`,
      ``,
      `RULES:`,
      `1. Truthfulness: Strictly match the candidate's real experience, roles, degrees, and skills provided in the RESUME DATA. Do NOT invent false companies, titles, or metrics.`,
      `2. Customization: Highlight the candidate's most relevant skills that match the requirements in the JOB POSTING DATA.`,
      `3. Recipient Email: Search the JOB POSTING DATA for an explicit recipient/hiring email address. If found, write it on the TO: line. If no email is in the job post, write "TO: UNKNOWN".`,
      `4. Email Length & Style: Keep the email body between 120 and 220 words. Writing must be direct, persuasive, and professional. No markdown code blocks, no bullet points.`,
      `5. Signature: End the body with a professional sign-off including ${name}'s name and contact details from the CANDIDATE PROFILE.`,
      `6. Output Format: Start line 1 immediately with "TO:". Do NOT include any intro text, disclaimers, system section headers, or conversational responses to the AI prompt.`,
      ``,
      `=== CANDIDATE PROFILE ===`,
      candidateProfile,
      `Additional Notes: ${candidateNotes}`,
      ``,
      `=== RESUME DATA ===`,
      clip(settings.resumeText, 12000),
      ``,
      `=== JOB POSTING DATA ===`,
      job.sourceTitle ? `Page Title: ${job.sourceTitle}` : "",
      job.sourceUrl ? `URL: ${job.sourceUrl}` : "",
      clip(job.selection, 8000),
      ``,
      `=== OUTPUT REQUIREMENTS ===`,
      `Respond with EXACTLY the following plain text structure and NOTHING else:`,
      ``,
      `TO: [recipient email address or UNKNOWN]`,
      `SUBJECT: [concise, engaging subject line]`,
      `BODY:`,
      `[full email content beginning with greeting and ending with signature]`
    ]
      .filter((line) => line !== null && line !== undefined)
      .join("\n");
  }

  HF.prompt = { buildPrompt, clip };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
