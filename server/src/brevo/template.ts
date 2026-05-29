export interface JobEmailInput {
  recipientName?: string;
  position: string;
  companyName: string;
  keyDetails: string; // model-composed
  nextSteps: string; // model-composed
  fromName: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a free-text block into escaped <p> paragraphs (blank line = new paragraph). */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.trim() !== "")
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Render the branded job-details email. Subject is derived; body fields are model-composed. */
export function renderJobEmail(input: JobEmailInput): { subject: string; html: string; text: string } {
  const { recipientName, position, companyName, keyDetails, nextSteps, fromName } = input;
  const greeting = recipientName && recipientName.trim() ? recipientName.trim() : "there";
  const subject = `${position} opportunity at ${companyName}`;

  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
    <div style="max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>Hi ${escapeHtml(greeting)},</p>
      <p>Thanks for speaking with us about the <strong>${escapeHtml(position)}</strong> role at <strong>${escapeHtml(companyName)}</strong>. Here are the details:</p>
      <h3 style="margin-bottom: 4px;">Key details</h3>
      ${paragraphs(keyDetails)}
      <h3 style="margin-bottom: 4px;">Next steps</h3>
      ${paragraphs(nextSteps)}
      <p style="margin-top: 24px;">Best regards,<br>${escapeHtml(fromName)}</p>
    </div>
  </body>
</html>`;

  const text = [
    `Hi ${greeting},`,
    ``,
    `Thanks for speaking with us about the ${position} role at ${companyName}. Here are the details:`,
    ``,
    `KEY DETAILS`,
    keyDetails,
    ``,
    `NEXT STEPS`,
    nextSteps,
    ``,
    `Best regards,`,
    fromName,
  ].join("\n");

  return { subject, html, text };
}
