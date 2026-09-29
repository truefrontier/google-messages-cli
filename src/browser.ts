import * as path from 'path';
import * as os from 'os';
import { chromium, Page, BrowserContext } from 'playwright';

export interface BrowserConfig {
  headless: boolean;
  profilePath?: string;
}

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
      timeout: 30000
    });

    await this.page.waitForTimeout(2000);
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

      const conversationsList = await this.page.locator('[data-e2e-conversations-list], mws-conversations-list, .conversations-list').count();
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

    await this.page.waitForTimeout(1000);

    const conversations = await this.page.evaluate(() => {
      const results: Array<{
        name: string;
        phoneNumber?: string;
        preview: string;
        timestamp: string;
        unread: boolean;
      }> = [];

      const convElements = document.querySelectorAll('mws-conversation-list-item, [data-e2e-conversation-item]');
      
      for (const conv of Array.from(convElements)) {
        try {
          const nameEl = conv.querySelector('.name, [data-e2e-contact-name], h3, .contact-name');
          const previewEl = conv.querySelector('.snippet, [data-e2e-snippet], .preview-text, .message-preview');
          const timeEl = conv.querySelector('.time, [data-e2e-timestamp], .timestamp');
          const unreadIndicator = conv.querySelector('.unread, [data-e2e-unread], .unread-indicator');

          const name = nameEl?.textContent?.trim() || 'Unknown';
          const preview = previewEl?.textContent?.trim() || '';
          const timestamp = timeEl?.textContent?.trim() || '';
          const unread = !!unreadIndicator;

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

    const searchButton = this.page.locator('button[aria-label*="Search"], [data-e2e-search-button], .search-button').first();
    
    if (await searchButton.count() > 0) {
      await searchButton.click();
      await this.page.waitForTimeout(500);

      const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search"], [data-e2e-search-input]').first();
      await searchInput.fill(query);
      await this.page.waitForTimeout(1000);

      const firstResult = this.page.locator('mws-conversation-list-item, [data-e2e-conversation-item]').first();
      if (await firstResult.count() > 0) {
        await firstResult.click();
        await this.page.waitForTimeout(1000);
        return true;
      }
    }

    const conversations = this.page.locator('mws-conversation-list-item, [data-e2e-conversation-item]');
    const count = await conversations.count();

    for (let i = 0; i < count; i++) {
      const conv = conversations.nth(i);
      const text = await conv.textContent();
      
      if (text && (text.toLowerCase().includes(query.toLowerCase()) || 
                   query.toLowerCase().includes(text.toLowerCase()))) {
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
