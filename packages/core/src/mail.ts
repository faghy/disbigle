/** Sends an email. Implementations: SMTP in production, a logger in development and tests. */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Keeps messages in memory (tests) and optionally prints them (development). */
export class MemoryMailer implements Mailer {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  constructor(private readonly print = false) {}
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(message);
    if (this.print) console.log(`mail to ${message.to}: ${message.subject}\n${message.text}\n`);
  }
}
