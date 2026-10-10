import type { Mailer } from '@disbigle/core';
import nodemailer from 'nodemailer';

export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
