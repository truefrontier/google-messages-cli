import * as path from 'path';
import * as os from 'os';
import { chromium, Page, BrowserContext } from 'playwright';

export interface BrowserConfig {
  headless: boolean;
  profilePath?: string;
}

const LIST_CONTAINER_SELECTOR =
  'mws-conversations-list, [data-e2e-conversation-list], nav.conversation-list, .conversations-list';

export class MessagesSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private profilePath: string;

  constructor(profilePath?: string) {
    this.profilePath = profilePath || path.join(
      os.homedir(),
      '.google-messages-cli',
      'chrome-profile'
    );
  }

  async launch(config: BrowserConfig): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profilePath, {
      headless: config.headless,
      channel: 'chromium',
      viewport: { width: 1280, height: 720 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    
    if (this.context.pages().length > 0) {
      this.page = this.context.pages()[0];
    } else {
      this.page = await this.context.newPage();
    }
  }

  async navigateToMessages(): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.goto('https://messages.google.com/web/conversations', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await this.dismissUseHereIfPresent();
    await this.waitForConversationListReady();
  }

  /**
   * Google Messages only keeps one active web client. If another window holds
   * the session, a "Use here" / similar control appears and the list never fills.
   */
  private async dismissUseHereIfPresent(): Promise<void> {
    if (!this.page) return;

    const patterns = [
      /Use Messages here/i,
      /Use here/i,
      /Yes,? use here/i,
      /Switch here/i
    ];

    for (const pattern of patterns) {
      const btn = this.page.getByRole('button', { name: pattern });
      if (await btn.count() > 0) {
        await btn.first().click({ timeout: 3000 }).catch(() => undefined);
        await this.page.waitForTimeout(1500);
        return;
      }
      const text = this.page.getByText(pattern);
      if (await text.count() > 0) {
        await text.first().click({ timeout: 3000 }).catch(() => undefined);
        await this.page.waitForTimeout(1500);
        return;
      }
    }
  }

  /**
   * The conversations shell (`mws-conversations-list`) appears before items.
   * Scraping too early returns []. Wait for real thread rows (or a settled empty list).
   */
  private async waitForConversationListReady(timeoutMs: number = 45000): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const start = Date.now();

    // First, wait for either QR / pair UI or the list shell
    while (Date.now() - start < timeoutMs) {
      const qr = await this.page.locator('canvas[aria-label*="QR"]').count();
      const pair = await this.page.getByText('Pair your phone').count();
      if (qr > 0 || pair > 0) {
        return; // caller / isPaired will report unpaired
      }

      const listShell = await this.page.locator(LIST_CONTAINER_SELECTOR).count();
      if (listShell > 0) {
        break;
      }
      await this.page.waitForTimeout(500);
    }

    // Then wait for items, or for the loading spinner to clear with no items
    while (Date.now() - start < timeoutMs) {
      const items = await this.page.locator('mws-conversation-list-item').count();
      if (items > 0) {
        // Brief settle so snippet/timestamp nodes hydrate
        await this.page.waitForTimeout(500);
        return;
      }

      const loading = await this.page
        .locator('mws-conversations-list mws-spinner, nav.conversation-list mws-spinner, [aria-label="Loading conversation list"]')
        .count();
      const listShell = await this.page.locator(LIST_CONTAINER_SELECTOR).count();

      // Shell present, no spinner, no items → genuinely empty list
      if (listShell > 0 && loading === 0) {
        await this.page.waitForTimeout(1000);
        const itemsAgain = await this.page.locator('mws-conversation-list-item').count();
        if (itemsAgain > 0) return;
        const stillLoading = await this.page
          .locator('[aria-label="Loading conversation list"]')
          .count();
        if (stillLoading === 0) return;
      }

      await this.page.waitForTimeout(500);
    }
  }

  async isPaired(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      const qrCode = await this.page.locator('canvas[aria-label*="QR"]').count();
      if (qrCode > 0) {
        return false;
      }

      const pairButton = await this.page.getByText('Pair your phone').count();
      if (pairButton > 0) {
        return false;
      }

      const conversationsList = await this.page.locator(LIST_CONTAINER_SELECTOR).count();
      return conversationsList > 0;
    } catch (error) {
      return false;
    }
  }

  async waitForPairing(timeoutMs: number = 120000): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.isPaired()) {
        return;
      }
      await this.page.waitForTimeout(2000);
    }

    throw new Error('Pairing timeout exceeded');
  }

  async getConversations(): Promise<Array<{
    name: string;
    phoneNumber?: string;
    preview: string;
    timestamp: string;
    unread: boolean;
  }>> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    if (!await this.isPaired()) {
      throw new Error('Not paired with phone');
    }

    // Ensure list rows are present (navigateToMessages usually already waited)
    await this.waitForConversationListReady(20000);

    const conversations = await this.page.evaluate(() => {
      const results: Array<{
        name: string;
        phoneNumber?: string;
        preview: string;
        timestamp: string;
        unread: boolean;
      }> = [];

      const convElements = document.querySelectorAll('mws-conversation-list-item');
      
      for (const conv of Array.from(convElements)) {
        try {
          const nameEl =
            conv.querySelector('[data-e2e-conversation-name]') ||
            conv.querySelector('h2.name, .name, [data-e2e-contact-name], h3, .contact-name');
          const previewEl =
            conv.querySelector('mws-conversation-snippet') ||
            conv.querySelector('.snippet, [data-e2e-snippet], .preview-text, .message-preview');
          const timeEl =
            conv.querySelector('mws-relative-timestamp') ||
            conv.querySelector('.snippet-timestamp, .time, [data-e2e-timestamp], .timestamp');
          const link =
            conv.querySelector('a[data-e2e-conversation], a.list-item') ||
            conv.querySelector('a');
          const unreadAttr = link?.getAttribute('data-e2e-is-unread');
          const unreadIndicator = conv.querySelector('.unread, [data-e2e-unread], .unread-indicator');

          const name = nameEl?.textContent?.trim() || 'Unknown';
          const preview = previewEl?.textContent?.trim() || '';
          const timestamp = timeEl?.textContent?.trim() || '';
          const unread =
            unreadAttr === 'true' ||
            !!unreadIndicator;

          results.push({
            name,
            preview,
            timestamp,
            unread
          });
        } catch (e) {
          continue;
        }
      }

      return results;
    });

    return conversations;
  }

  private looksLikePhoneNumber(query: string): boolean {
    const digits = query.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  private async waitForActiveConversation(timeoutMs: number = 15000): Promise<boolean> {
    if (!this.page) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const url = this.page.url();
      const onThread =
        /\/conversations\/[^/?#]+/.test(url) &&
        !url.includes('/conversations/new');
      const wrappers = await this.page.locator('mws-message-wrapper, mws-messages-list').count();
      const compose = await this.page.locator('mws-message-compose, [data-e2e-message-input-box]').count();
      if ((onThread && compose > 0) || wrappers > 0) {
        await this.page.waitForTimeout(500);
        return true;
      }
      await this.page.waitForTimeout(300);
    }
    return false;
  }

  /**
   * Start a brand-new chat via Start chat → contact input (needed when the
   * recipient is not already in the conversation list).
   */
  private async startNewConversation(query: string): Promise<boolean> {
    if (!this.page) return false;

    const startChat = this.page
      .locator('a[data-e2e-start-button], a[href*="/conversations/new"], [aria-label*="Start chat"]')
      .first();
    if ((await startChat.count()) === 0) {
      return false;
    }

    await startChat.click();
    await this.page.waitForTimeout(800);

    const contactInput = this.page
      .locator('input[data-e2e-contact-input], input[placeholder*="phone number"], input[placeholder*="Type a name"]')
      .first();
    if ((await contactInput.count()) === 0) {
      return false;
    }

    const digits = query.replace(/\D/g, '');
    await contactInput.click();
    await contactInput.fill(query);
    await this.page.waitForTimeout(1200);

    // Prefer the explicit "Send to <number>" affordance when present
    if (digits.length >= 7) {
      const sendTo = this.page.getByRole('button', { name: new RegExp(`Send to\\s*${digits}`, 'i') });
      if ((await sendTo.count()) > 0) {
        await sendTo.first().click();
        await this.page.waitForTimeout(1000);
        return this.waitForActiveConversation(20000);
      }
    }

    // Else click a filtered contact row that actually matches the query
    const rows = this.page.locator('mw-contact-row');
    const rowCount = await rows.count();
    const queryLower = query.toLowerCase();
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = ((await row.textContent()) || '').toLowerCase();
      const rowDigits = rowText.replace(/\D/g, '');
      const matchesName = rowText.includes(queryLower);
      const matchesPhone =
        digits.length >= 7 &&
        rowDigits.includes(digits);
      if (matchesName || matchesPhone) {
        const clickTarget = row.locator('[data-e2e-contact-row], [role="checkbox"]').first();
        if ((await clickTarget.count()) > 0) {
          await clickTarget.click();
        } else {
          await row.click();
        }
        await this.page.waitForTimeout(800);
        break;
      }
    }

    // Enter on the contact input also starts the chat for typed numbers
    if (!(await this.waitForActiveConversation(2500))) {
      await contactInput.press('Enter');
      await this.page.waitForTimeout(1000);
    }

    // Some builds require a second Enter / "Next" after chip selection
    if (!(await this.waitForActiveConversation(2000))) {
      const nextBtn = this.page.getByRole('button', { name: /^(Next|Start|Chat)$/i }).first();
      if ((await nextBtn.count()) > 0 && (await nextBtn.isEnabled().catch(() => false))) {
        await nextBtn.click().catch(() => undefined);
        await this.page.waitForTimeout(800);
      }
    }

    return this.waitForActiveConversation(20000);
  }

  async openConversation(query: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    if (!await this.isPaired()) {
      throw new Error('Not paired with phone');
    }

    await this.waitForConversationListReady(20000);

    // Phone numbers: use Start chat so we never open an unrelated recent thread
    if (this.looksLikePhoneNumber(query)) {
      return this.startNewConversation(query);
    }

    const queryLower = query.toLowerCase();
    const queryDigits = query.replace(/\D/g, '');

    const searchButton = this.page.locator('button[aria-label*="Search"], [data-e2e-search-button], .search-button').first();
    
    if (await searchButton.count() > 0) {
      await searchButton.click();
      await this.page.waitForTimeout(500);

      const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search"], [data-e2e-search-input]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill(query);
        await this.page.waitForTimeout(1000);

        const results = this.page.locator('mws-conversation-list-item');
        const resultCount = await results.count();
        for (let i = 0; i < resultCount; i++) {
          const conv = results.nth(i);
          const nameText =
            (await conv.locator('[data-e2e-conversation-name], h2.name, .name').first().textContent().catch(() => null)) ||
            (await conv.textContent());
          if (!nameText) continue;
          if (nameText.toLowerCase().includes(queryLower)) {
            await conv.click();
            if (await this.waitForActiveConversation()) {
              return true;
            }
          }
        }
      }
    }

    const conversations = this.page.locator('mws-conversation-list-item');
    const count = await conversations.count();

    for (let i = 0; i < count; i++) {
      const conv = conversations.nth(i);
      const nameText =
        (await conv.locator('[data-e2e-conversation-name], h2.name, .name').first().textContent().catch(() => null)) ||
        (await conv.textContent());
      
      if (!nameText) continue;
      const nameLower = nameText.toLowerCase();
      const nameDigits = nameText.replace(/\D/g, '');
      const nameMatch = nameLower.includes(queryLower);
      const phoneMatch =
        queryDigits.length >= 7 &&
        nameDigits.length >= 7 &&
        (nameDigits.includes(queryDigits) || queryDigits.includes(nameDigits));

      if (nameMatch || phoneMatch) {
        await conv.click();
        if (await this.waitForActiveConversation()) {
          return true;
        }
      }
    }

    // Fallback: start a new chat when not found in recent list
    return this.startNewConversation(query);
  }

  async getMessages(): Promise<Array<{
    direction: 'sent' | 'received';
    text: string;
    timestamp: string;
  }>> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    // Messages hydrate after the thread shell; wait briefly for wrappers
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const n = await this.page.locator('mws-message-wrapper, [data-e2e-message-wrapper]').count();
      if (n > 0) break;
      await this.page.waitForTimeout(300);
    }
    await this.page.waitForTimeout(400);

    const messages = await this.page.evaluate(() => {
      const results: Array<{
        direction: 'sent' | 'received';
        text: string;
        timestamp: string;
      }> = [];

      const msgElements = document.querySelectorAll(
        'mws-message-wrapper, [data-e2e-message-wrapper]'
      );

      for (const msg of Array.from(msgElements)) {
        try {
          const core = msg.querySelector('[data-e2e-message-wrapper-core], .msg-row') || msg;
          const outgoingAttr =
            msg.getAttribute('is-outgoing') ||
            core.getAttribute('data-e2e-message-outgoing');
          const isSent =
            outgoingAttr === 'true' ||
            msg.classList.contains('outgoing') ||
            core.classList.contains('outgoing') ||
            msg.classList.contains('sent') ||
            !!msg.querySelector('.outgoing, .rcs-outgoing, .text-msg-container.outgoing');

          const textEl =
            msg.querySelector('[data-e2e-text-message-content] .text-msg-content') ||
            msg.querySelector('.text-msg-content') ||
            msg.querySelector('mws-message-part-content') ||
            msg.querySelector('[data-e2e-text-message-content]') ||
            msg.querySelector('mws-text-message-part') ||
            msg.querySelector('.text, [data-e2e-message-text], .message-text, .message-content');

          let text = textEl?.textContent?.trim() || '';
          if (!text && msg.querySelector('mws-image-message-part, [data-e2e-image-message]')) {
            text = '[image]';
          }

          const textPart = msg.querySelector('mws-text-message-part, [aria-label]');
          const aria = textPart?.getAttribute('aria-label') || '';
          const ariaTime =
            aria.match(/(?:Sent|Received) on (.+?)(?:\.\s|$)/i)?.[1]?.trim() || '';

          const timeEl =
            msg.querySelector('mws-absolute-timestamp') ||
            msg.querySelector('mws-relative-timestamp') ||
            msg.querySelector('.time, [data-e2e-timestamp], .timestamp');
          const timestamp = timeEl?.textContent?.trim() || ariaTime || '';

          if (text) {
            results.push({
              direction: isSent ? 'sent' : 'received',
              text,
              timestamp
            });
          }
        } catch (e) {
          continue;
        }
      }

      return results;
    });

    return messages;
  }

  async sendMessage(text: string, dryRun: boolean = true): Promise<{ success: boolean; dryRun: boolean }> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    if (dryRun) {
      return { success: true, dryRun: true };
    }

    if (!(await this.waitForActiveConversation(15000))) {
      throw new Error('Conversation compose area not ready');
    }

    // Prefer the visible contenteditable mirror; the paired <textarea> is often hidden
    const inputSelectors = [
      'div[contenteditable="true"][data-e2e-message-input-box]',
      'mws-message-compose div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'textarea[data-e2e-message-input-box]:not([hidden])',
      'mws-message-compose textarea:not([hidden])',
      'textarea[aria-label*="message" i]:not([hidden])',
      'textarea[placeholder*="message" i]:not([hidden])'
    ];

    let inputFound = false;
    for (const selector of inputSelectors) {
      const input = this.page.locator(selector).first();
      if ((await input.count()) === 0) continue;
      if (!(await input.isVisible().catch(() => false))) continue;
      await input.click({ force: false });
      await input.fill(text);
      inputFound = true;
      break;
    }

    if (!inputFound) {
      throw new Error('Could not find message input field');
    }

    // Wait for an enabled send control after text entry (prefer visible)
    const sendCandidates = this.page.locator(
      'button[data-e2e-send-text-button]:not([disabled]), button[aria-label*="Send"]:not([disabled])'
    );

    const enabledDeadline = Date.now() + 8000;
    while (Date.now() < enabledDeadline) {
      const n = await sendCandidates.count();
      for (let i = 0; i < n; i++) {
        const btn = sendCandidates.nth(i);
        const visible = await btn.isVisible().catch(() => false);
        const enabled = await btn.isEnabled().catch(() => false);
        if (visible && enabled) {
          await btn.click({ timeout: 5000 });
          await this.page.waitForTimeout(1200);
          return { success: true, dryRun: false };
        }
      }
      await this.page.waitForTimeout(200);
    }

    // Fallback: Enter in the visible compose box (Messages sends on Enter)
    const compose = this.page
      .locator('div[contenteditable="true"][data-e2e-message-input-box], [data-e2e-message-input-box]')
      .first();
    if ((await compose.count()) > 0) {
      await compose.focus();
      await compose.press('Enter');
      await this.page.waitForTimeout(1200);
      return { success: true, dryRun: false };
    }

    // Last resort: force-click any enabled send button even if offscreen
    if ((await sendCandidates.count()) > 0) {
      await sendCandidates.first().click({ force: true, timeout: 5000 });
      await this.page.waitForTimeout(1200);
      return { success: true, dryRun: false };
    }

    throw new Error('Could not find enabled send button');
  }

  getPage(): Page | null {
    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}
