/**
 * Tests for the raw message milindCal hands Gmail's `messages.send`.
 *
 * Both send paths — compose and reply — built their lines as an array and ran
 * `.filter(Boolean)` to drop unused Cc/Bcc slots, which also dropped the empty
 * line that separates headers from the body. These pin the separator, and the
 * two header-safety rules that came with fixing it.
 */

import { buildRawEmail } from "../lib/google.ts";

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log("✓ " + name); }
  else { failed++; console.log("✗ " + name + (detail ? "  -> " + detail : "")); }
};

/** Split the way a mail parser does: headers end at the first blank line. */
const parse = (raw) => {
  const at = raw.indexOf("\r\n\r\n");
  return at === -1
    ? { headers: raw.split("\r\n"), body: null }
    : { headers: raw.slice(0, at).split("\r\n"), body: raw.slice(at + 4) };
};

/* ── The separator ────────────────────────────────────────────────── */

{
  const raw = buildRawEmail([["To", "a@example.com"], ["Cc", ""], ["Bcc", undefined], ["Subject", "Hi"]], "Hello there");
  const { headers, body } = parse(raw);
  check("headers and body are separated by a blank line", body !== null, JSON.stringify(raw));
  check("the body arrives intact", body === "Hello there", JSON.stringify(body));
  check("an empty Cc is left out", !headers.some((h) => h.startsWith("Cc:")));
  check("an undefined Bcc is left out", !headers.some((h) => h.startsWith("Bcc:")));
  check("To is present", headers.includes("To: a@example.com"));
  check("the content type is declared", headers.includes("Content-Type: text/plain; charset=UTF-8"));
}

// The case that made this visible: a reply whose first line has a colon read
// as a header named "Re" and vanished from the body.
{
  const { headers, body } = parse(buildRawEmail([["To", "a@example.com"], ["Subject", "Re: plan"]], "Re: tomorrow\nworks for me"));
  check("a body line with a colon stays in the body", body === "Re: tomorrow\r\nworks for me", JSON.stringify(body));
  check("and is not read as a header", !headers.some((h) => h.startsWith("Re: tomorrow")));
}

{
  const { body } = parse(buildRawEmail([["To", "a@example.com"], ["Subject", "x"]], "one\ntwo\r\nthree"));
  check("body line endings are normalised to CRLF", body === "one\r\ntwo\r\nthree", JSON.stringify(body));
}

/* ── Header safety ────────────────────────────────────────────────── */

{
  const { headers } = parse(buildRawEmail([["To", "a@example.com"], ["Subject", "Hello\r\nBcc: evil@example.com"]], "x"));
  check("a line break cannot start a new header", !headers.some((h) => h.startsWith("Bcc:")), JSON.stringify(headers));
}

{
  const { headers } = parse(buildRawEmail([["To", "a@example.com"], ["Subject", "Café meeting 📅"]], "x"));
  const subject = headers.find((h) => h.startsWith("Subject:")) ?? "";
  check("a non-ASCII subject is RFC 2047 encoded", subject.startsWith("Subject: =?UTF-8?B?"), subject);
  const encoded = subject.slice("Subject: =?UTF-8?B?".length, -2);
  check("and decodes back to what was typed", Buffer.from(encoded, "base64").toString("utf8") === "Café meeting 📅");
}

{
  const { headers } = parse(buildRawEmail([["To", "a@example.com"], ["Subject", "Plain subject"]], "x"));
  check("an ASCII subject is left readable", headers.includes("Subject: Plain subject"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
