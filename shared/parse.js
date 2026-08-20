(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});

  function stripFences(raw) {
    return String(raw || "")
      .replace(/```[a-zA-Z]*\n?/g, "")
      .replace(/```/g, "")
      .replace(/\r/g, "")
      .trim();
  }

  function lineValue(src, key) {
    const re = new RegExp(
      "^\\s*(?:[*_`]{0,3}|#{1,3}\\s*)" + key + "\\s*[:\\-]\\s*(.+)\\s*$",
      "im"
    );
    const m = src.match(re);
    return m ? m[1].replace(/^[*_`]+|[*_`]+$/g, "").trim() : "";
  }

  function sanitizeAiText(text) {
    if (!text) return "";
    return String(text)
      .replace(/^(?:Gemini|ChatGPT)(?:\s+said)?\s*[\:\-\n]*/i, "")
      .replace(/^(?:Here is|Here's)(?:\s+the|\s+your)?\s+(?:tailored\s+)?(?:application\s+)?email(?:\s+draft)?[\:\-\n]*/i, "")
      .replace(/^Sure,?\s+here(?:\s+is|\s+'s)?.*?[\:\-\n]*/i, "")
      .trim();
  }

  function parseGeneratedEmail(raw, fallbackTo) {
    const cleaned = sanitizeAiText(stripFences(raw));
    let to = lineValue(cleaned, "TO");
    let subject = lineValue(cleaned, "SUBJECT");

    // Clean placeholders from TO
    if (/\[|email@domain|unknown|recipient email/i.test(to)) {
      to = "";
    }

    const extracted = HF.extract ? HF.extract.emails(to || cleaned) : [];
    if (extracted[0]) to = extracted[0];
    else if (!to && fallbackTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallbackTo)) {
      to = fallbackTo;
    }

    // Clean placeholders from SUBJECT
    if (/\[|one line subject|concise, engaging subject/i.test(subject)) {
      subject = "";
    }

    let body = "";
    const bodyMatch = cleaned.match(
      /^\s*(?:[*_`]{0,3}|#{1,3}\s*)BODY\s*[:\-][ \t]*\n?([\s\S]+)$/im
    );
    if (bodyMatch) {
      body = bodyMatch[1].trim();
    } else {
      body = cleaned
        .replace(/^\s*(?:[*_`]{0,3}|#{1,3}\s*)TO\s*[:\-].*$/im, "")
        .replace(/^\s*(?:[*_`]{0,3}|#{1,3}\s*)SUBJECT\s*[:\-].*$/im, "")
        .replace(/^\s*(?:[*_`]{0,3}|#{1,3}\s*)BODY\s*[:\-].*$/im, "")
        .trim();
    }

    // Strip conversational headers, prompt section headers or system text from body
    body = sanitizeAiText(
      body
        .replace(/===\s*(?:TASK|CANDIDATE|RESUME|JOB POSTING|OUTPUT).*?===/g, "")
        .replace(/^\[full email content.*?\]$/im, "")
        .replace(/^the full email including greeting and signature$/im, "")
        .replace(/^["']|["']$/g, "")
        .trim()
    );

    subject = sanitizeAiText(subject.replace(/^["']|["']$/g, "").trim());
    if (subject.length > 140) subject = subject.slice(0, 137) + "…";

    return {
      to: to || "",
      subject: subject || "",
      body: body || cleaned,
      raw: cleaned,
      parsed: Boolean(subject && body && !/\[full email|=== TASK/i.test(body))
    };
  }

  HF.parse = { parseGeneratedEmail, stripFences };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
