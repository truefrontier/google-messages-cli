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

  async openConversation(query: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    if (!await this.isPaired()) {
      throw new Error('Not paired with phone');
    }

    await this.waitForConversationListReady(20000);

    const searchButton = this.page.locator('button[aria-label*="Search"], [data-e2e-search-button], .search-button').first();
    
    if (await searchButton.count() > 0) {
      await searchButton.click();
      await this.page.waitForTimeout(500);

      const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search"], [data-e2e-search-input]').first();
      await searchInput.fill(query);
      await this.page.waitForTimeout(1000);

      const firstResult = this.page.locator('mws-conversation-list-item, [data-e2e-conversation]').first();
      if (await firstResult.count() > 0) {
        await firstResult.click();
        await this.page.waitForTimeout(1000);
        return true;
      }
    }

    const conversations = this.page.locator('mws-conversation-list-item');
    const count = await conversations.count();

    for (let i = 0; i < count; i++) {
      const conv = conversations.nth(i);
      const nameText =
        (await conv.locator('[data-e2e-conversation-name], h2.name, .name').first().textContent().catch(() => null)) ||
        (await conv.textContent());
      
      if (nameText && (nameText.toLowerCase().includes(query.toLowerCase()) ||
                   query.toLowerCase().includes(nameText.toLowerCase()))) {
        await conv.click();
        await this.page.waitForTimeout(1000);
        return true;
      }
    }

    return false;
  }

  async getMessages(): Promise<Array<{
    direction: 'sent' | 'received';
    text: string;
    timestamp: string;
  }>> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.waitForTimeout(1000);

    const messages = await this.page.evaluate(() => {
      const results: Array<{
        direction: 'sent' | 'received';
        text: string;
        timestamp: string;
      }> = [];

      const msgElements = document.querySelectorAll('mws-message-wrapper, [data-e2e-message], .message-wrapper, .message');

      for (const msg of Array.from(msgElements)) {
        try {
          const isSent = msg.classList.contains('outgoing') || 
                        msg.classList.contains('sent') ||
                        msg.querySelector('.outgoing, .sent') !== null ||
                        msg.getAttribute('data-direction') === 'sent';

          const textEl = msg.querySelector('.text, [data-e2e-message-text], .message-text, .message-content');
          const timeEl = msg.querySelector('.time, [data-e2e-timestamp], .timestamp');

          const text = textEl?.textContent?.trim() || '';
          const timestamp = timeEl?.textContent?.trim() || '';

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

    const inputSelectors = [
      'div[contenteditable="true"][aria-label*="message"]',
      '[data-e2e-message-input]',
      'textarea[placeholder*="message"]',
      '.message-input',
      'div[contenteditable="true"]'
    ];

    let inputFound = false;
    for (const selector of inputSelectors) {
      const input = this.page.locator(selector).first();
      if (await input.count() > 0) {
        await input.click();
        await input.fill(text);
        inputFound = true;
        break;
      }
    }

    if (!inputFound) {
      throw new Error('Could not find message input field');
    }

    await this.page.waitForTimeout(500);

    const sendButtonSelectors = [
      'button[aria-label*="Send"], button[data-e2e-send-button], .send-button'
    ];

    for (const selector of sendButtonSelectors) {
      const sendButton = this.page.locator(selector).first();
      if (await sendButton.count() > 0) {
        await sendButton.click();
        await this.page.waitForTimeout(1000);
        return { success: true, dryRun: false };
      }
    }

    throw new Error('Could not find send button');
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
