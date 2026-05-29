import { describe, it, expect } from "vitest";
import { renderJobEmail } from "../template.js";

describe("renderJobEmail", () => {
  const base = {
    recipientName: "Cand",
    position: "Backend Engineer",
    companyName: "Acme",
    keyDetails: "Build APIs.\nNode + Postgres.",
    nextSteps: "Reply to confirm.",
    fromName: "Acme Talent",
  };

  it("derives the subject from position and company", () => {
    expect(renderJobEmail(base).subject).toBe("Backend Engineer opportunity at Acme");
  });

  it("includes the recipient name, details, next steps, and signature in the HTML", () => {
    const { html } = renderJobEmail(base);
    expect(html).toContain("Hi Cand,");
    expect(html).toContain("Backend Engineer");
    expect(html).toContain("Build APIs.");
    expect(html).toContain("Reply to confirm.");
    expect(html).toContain("Acme Talent");
  });

  it("greets generically when no recipient name is given", () => {
    const { html, text } = renderJobEmail({ ...base, recipientName: undefined });
    expect(html).toContain("Hi there,");
    expect(text).toContain("Hi there,");
  });

  it("HTML-escapes interpolated values", () => {
    const { html } = renderJobEmail({ ...base, companyName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("produces a plain-text version with the details", () => {
    const { text } = renderJobEmail(base);
    expect(text).toContain("Build APIs.");
    expect(text).toContain("Reply to confirm.");
    expect(text).toContain("Acme Talent");
  });

  it("renders no paragraph for an empty body field", () => {
    const { html } = renderJobEmail({ ...base, keyDetails: "" });
    expect(html).not.toContain("<p></p>");
  });

  it("does not emit a trailing <br> for a trailing newline", () => {
    const { html } = renderJobEmail({ ...base, nextSteps: "Reply to confirm.\n" });
    expect(html).toContain("<p>Reply to confirm.</p>");
    expect(html).not.toContain("Reply to confirm.<br>");
  });
});
