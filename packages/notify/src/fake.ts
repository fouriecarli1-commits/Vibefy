/**
 * The provider used in tests and in local development.
 *
 * It signs nothing and reaches nothing, but it implements the interface
 * completely — including bouncing, so the suppression path is exercised rather
 * than assumed. Addresses at `bounce.invalid` hard-bounce and addresses at
 * `slow.invalid` soft-bounce, which is enough to drive every branch.
 */
import type { EmailMessage, EmailProvider, SendResult } from './provider.ts';

export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: EmailMessage[] = [];

  constructor(private readonly options: { failEverything?: boolean } = {}) {}

  async send(message: EmailMessage): Promise<SendResult> {
    if (this.options.failEverything) {
      return { sent: false, kind: 'provider_error', detail: 'Fake provider set to fail.' };
    }
    const domain = message.to.split('@')[1]?.toLowerCase() ?? '';
    if (domain === 'bounce.invalid') {
      return { sent: false, kind: 'hard_bounce', detail: 'No such recipient (fake).' };
    }
    if (domain === 'slow.invalid') {
      return { sent: false, kind: 'soft_bounce', detail: 'Mailbox full (fake).' };
    }
    this.sent.push(message);
    return { sent: true, providerId: `fake-${this.sent.length}` };
  }

  /** Everything sent to one address, for assertions. */
  to(address: string): EmailMessage[] {
    return this.sent.filter((message) => message.to.toLowerCase() === address.toLowerCase());
  }

  clear(): void {
    this.sent.length = 0;
  }
}
