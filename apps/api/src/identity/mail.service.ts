import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@venue/config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Transactional email via Resend's REST API (no SDK). With no
 * RESEND_API_KEY it logs the message — including any set-password link —
 * so local dev and tests work without a mail account. Never throws: a mail
 * outage must not turn a forgot-password request into an error (that would
 * also reveal whether the address exists); callers get `false` instead.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(message: MailMessage): Promise<boolean> {
    const env = loadEnv();
    if (!env.RESEND_API_KEY) {
      this.logger.warn(
        `RESEND_API_KEY not set — email NOT sent. To: ${message.to} | ${message.subject}\n${message.text}`,
      );
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        this.logger.error(`Resend rejected email to ${message.to}: ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${message.to}: ${String(error)}`);
      return false;
    }
  }
}
