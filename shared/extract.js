(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  const IGNORE_EMAIL = [
    "sentry.io",
    "example.com",
    "example.org",
    "w3.org",
    "schema.org",
    "linkedin.com",
    "licdn.com",
    "facebook.com",
    "fb.com",
    "gstatic.com",
    "noreply@",
    "no-reply@",
    "donotreply@",
    "mailer-daemon@",
    "notifications@",
    "bounce@",
    "support@linkedin"
  ];

  const ROLE_PATTERNS = [
    /(?:hiring|looking for|seeking|need(?:ing)?|opening for|role(?:\s+is)?|position(?:\s+is)?|title)\s*(?:an?\s+|our\s+)?([A-Z][A-Za-z0-9+/&., \-]{2,60}?)(?:\.|,|!|\n| to | who | that | with )/i,
    /\b((?:senior|staff|principal|lead|junior|intern)?\s*(?:software|frontend|front-end|backend|back-end|full[\s-]?stack|data|ml|ai|product|design|devops|sre|android|ios|mobile|qa|security|marketing|sales|account|customer success|hr|recruiter|finance|operations)?\s*(?:engineer|developer|designer|manager|analyst|scientist|architect|consultant|specialist|intern|lead))\b/i
  ];

  const COMPANY_PATTERNS = [
    /(?:at|@|join(?:ing)?)\s+([A-Z][A-Za-z0-9.&'\-]{1,40}(?:\s+[A-Z][A-Za-z0-9.&'\-]{1,30}){0,3})/,
    /(?:we(?:'re| are)?|i(?:'m| am)?)\s+(?:hiring|looking)\s+(?:at|for)\s+([A-Z][A-Za-z0-9.&'\-]{1,40})/i
  ];

  function normalizeEmail(e) {
    return String(e || "").trim().replace(/[.,;:)+>]+$/g, "").toLowerCase();
  }

  function isIgnoredEmail(email) {
    const low = email.toLowerCase();
    return IGNORE_EMAIL.some((x) => low.includes(x));
  }

  function emails(text) {
    const found = String(text || "").match(EMAIL_RE) || [];
    const uniq = [];
    for (const raw of found) {
      const e = normalizeEmail(raw);
      if (!e || isIgnoredEmail(e)) continue;
      if (!uniq.includes(e)) uniq.push(e);
    }
    return uniq;
  }

  function looksLikeJob(text) {
    const t = String(text || "").toLowerCase();
    const keys = [
      "hiring",
      "we're hiring",
      "we are hiring",
      "job",
      "role",
      "opening",
      "apply",
      "resume",
      "cv",
      "position",
      "candidate",
      "join our",
      "looking for",
      "requisition",
      "full-time",
      "part-time",
      "remote"
    ];
    return keys.some((k) => t.includes(k)) || emails(text).length > 0;
  }

  function guessRole(text) {
    const src = String(text || "").replace(/\s+/g, " ");
    for (const re of ROLE_PATTERNS) {
      const m = src.match(re);
      if (m && m[1] && m[1].length < 70) return cleanGuess(m[1]);
    }
    return "";
  }

  function guessCompany(text) {
    const src = String(text || "");
    for (const re of COMPANY_PATTERNS) {
      const m = src.match(re);
      if (m && m[1] && m[1].length < 60) {
        const c = cleanGuess(m[1]);
        if (!/^(a|an|our|the|this|my|team|company)$/i.test(c)) return c;
      }
    }
    return "";
  }

  function cleanGuess(s) {
    return String(s)
      .replace(/\s+/g, " ")
      .replace(/[|:;•]+$/g, "")
      .trim();
  }

  function snippet(text, n) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n - 1).trim() + "…";
  }

  function jobMeta(text) {
    return {
      role: guessRole(text),
      company: guessCompany(text),
      emails: emails(text),
      looksLikeJob: looksLikeJob(text)
    };
  }

  HF.extract = {
    EMAIL_RE,
    emails,
    looksLikeJob,
    guessRole,
    guessCompany,
    jobMeta,
    snippet,
    normalizeEmail
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
