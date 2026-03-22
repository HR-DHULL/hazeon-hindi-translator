import nodemailer from 'nodemailer';

function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email not configured. Set SMTP_USER and SMTP_PASS in .env');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send translated DOCX download link to an email address.
 * @param {object} opts
 * @param {string} opts.toEmail       - Recipient email
 * @param {string} opts.fromName      - Sender display name (logged-in user)
 * @param {string} opts.fromEmail     - Sender email (logged-in user, used as Reply-To)
 * @param {string} opts.filename      - Original document name
 * @param {string} opts.docxUrl       - Public download URL for the DOCX
 */
export async function sendTranslationEmail({ toEmail, fromName, fromEmail, filename, docxUrl }) {
  const transporter = getTransporter();

  // Strip newlines and quotes from any user-supplied value used in headers
  // to prevent email header injection (CRLF injection attack)
  const sanitize = (s) => (s || '').replace(/[\r\n"]/g, '').trim();

  const senderLabel = sanitize(fromName || fromEmail) || 'Hazeon Translator';
  const safeFilename = sanitize(filename);
  const safeReplyTo = sanitize(fromEmail) || process.env.SMTP_USER;

  await transporter.sendMail({
    from: `"${senderLabel}" <${process.env.SMTP_USER}>`,
    replyTo: safeReplyTo,
    to: toEmail,
    subject: `Hindi Translation Ready: ${safeFilename}`,
    html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #f8fafc; padding: 24px; border-radius: 16px;">
        <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
            <div style="width: 40px; height: 40px; background: #4f46e5; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 20px;">🌐</span>
            </div>
            <div>
              <div style="font-weight: 700; color: #1e293b; font-size: 16px;">Hazeon Hindi Translator</div>
              <div style="color: #94a3b8; font-size: 12px;">UPSC/HCS Study Material</div>
            </div>
          </div>

          <h2 style="margin: 0 0 8px; color: #1e293b; font-size: 20px;">Your translated document is ready</h2>
          <p style="color: #64748b; margin: 0 0 24px; font-size: 14px;">
            <strong>${senderLabel.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</strong> has shared a Hindi (Devanagari) translation with you.
          </p>

          <div style="background: #f1f5f9; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Document</div>
            <div style="font-weight: 600; color: #334155; font-size: 14px;">📄 ${safeFilename.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</div>
          </div>

          <a href="${docxUrl}"
             style="display: inline-block; background: #4f46e5; color: white; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px; margin-bottom: 16px;">
            ⬇️ Download Hindi DOCX
          </a>

          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
            Sent via <strong>Hazeon Hindi Translator</strong> · UPSC/HCS Study Material Translation
          </p>
        </div>
      </div>
    `,
  });
}
