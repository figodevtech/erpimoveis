type SendEmailParams = {
  to?: string | null;
  subject: string;
  text: string;
  html?: string;
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM?.trim();
// O nome exibido no remetente ("Empresa <noreply@dominio>") assina os e-mails.








export async function sendEmail({ to, subject, text, html }: SendEmailParams) {
  if (!to) {
    return { sent: false, skipped: true, reason: "missing-recipient" };
  }

  if (!RESEND_API_KEY) {
    return { sent: false, skipped: true, reason: "missing-api-key" };
  }

  if (!EMAIL_FROM) {
    return { sent: false, skipped: true, reason: "missing-sender" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[email] Falha ao enviar e-mail:", response.status, body);
    return { sent: false, skipped: false, reason: "resend-error", status: response.status, error: body };
  }

  return { sent: true, skipped: false };
}
