#!/usr/bin/env node

import { Command } from 'commander';
import { MessagesSession } from './browser';
import { OutputFormatter, OutputOptions } from './output';
import * as path from 'path';
import * as os from 'os';

const VERSION = '0.1.1';

const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
  AUTH_NEEDED: 3,
  NOT_FOUND: 4,
  SEND_BLOCKED: 5
};

interface GlobalOptions extends OutputOptions {
  profile?: string;
}

function createOutputFormatter(options: GlobalOptions): OutputFormatter {
  return new OutputFormatter({
    json: options.json,
    compact: options.compact,
    select: options.select,
    csv: options.csv,
    quiet: options.quiet
  });
}

const program = new Command();

program
  .name('gmsg')
  .description('Agent-native CLI for Google Messages for web')
  .version(VERSION)
  .option('--json', 'Output in JSON format')
  .option('--compact', 'Compact JSON output (no formatting)')
  .option('--select <fields>', 'Select specific fields (comma-separated)')
  .option('--csv', 'Output in CSV format')
  .option('--quiet', 'Suppress all output except errors')
  .option('--profile <path>', 'Custom Chrome profile path');

program
  .command('version')
  .description('Show version information')
  .action(() => {
    console.log(`gmsg v${VERSION}`);
    process.exit(EXIT_CODES.OK);
  });

program
  .command('login')
  .alias('pair')
  .description('Open Google Messages in browser and wait for phone pairing')
  .action(async (options: GlobalOptions) => {
    const formatter = createOutputFormatter(program.opts());
    const session = new MessagesSession(program.opts().profile);

    try {
      formatter.info('Launching browser for Google Messages pairing...');
      
      await session.launch({ headless: false });
      await session.navigateToMessages();

      if (await session.isPaired()) {
        formatter.success('Already paired! Session is active.');
        await session.close();
        process.exit(EXIT_CODES.OK);
      }

      formatter.info('Please scan the QR code with your phone to pair...');
      formatter.info('Waiting for pairing (timeout: 2 minutes)...');

      await session.waitForPairing(120000);

      formatter.success('Successfully paired with phone!');
      formatter.info(`Profile saved to: ${path.join(os.homedir(), '.google-messages-cli', 'chrome-profile')}`);

      await session.close();
      process.exit(EXIT_CODES.OK);

    } catch (error) {
      formatter.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
      await session.close();
      process.exit(EXIT_CODES.ERROR);
    }
  });

program
  .command('status')
  .description('Check pairing and session status')
  .action(async () => {
    const formatter = createOutputFormatter(program.opts());
    const session = new MessagesSession(program.opts().profile);

    try {
      await session.launch({ headless: true });
      await session.navigateToMessages();

      const paired = await session.isPaired();

      if (formatter['options'].json || !process.stdout.isTTY) {
        console.log(JSON.stringify({
          paired,
          status: paired ? 'active' : 'needs_pairing',
          profilePath: path.join(os.homedir(), '.google-messages-cli', 'chrome-profile')
        }, null, 2));
      } else {
        if (paired) {
          formatter.success('Session is active and paired');
        } else {
          formatter.warning('Not paired - run "gmsg login" to pair with phone');
        }
      }

      await session.close();
      process.exit(paired ? EXIT_CODES.OK : EXIT_CODES.AUTH_NEEDED);

    } catch (error) {
      formatter.error(`Status check failed: ${error instanceof Error ? error.message : String(error)}`);
      await session.close();
      process.exit(EXIT_CODES.ERROR);
    }
  });

const conversationsCommand = program
  .command('conversations')
  .description('Manage conversations');

conversationsCommand
  .command('list')
  .description('List recent conversations')
  .action(async () => {
    const formatter = createOutputFormatter(program.opts());
    const session = new MessagesSession(program.opts().profile);

    try {
      await session.launch({ headless: true });
      await session.navigateToMessages();

      if (!await session.isPaired()) {
        formatter.error('Not paired with phone. Run "gmsg login" first.');
        await session.close();
        process.exit(EXIT_CODES.AUTH_NEEDED);
      }

      const conversations = await session.getConversations();

      if (formatter['options'].json || !process.stdout.isTTY) {
        console.log(formatter.format(conversations));
      } else {
        console.log(formatter.formatConversationsTable(conversations));
      }

      await session.close();
      process.exit(EXIT_CODES.OK);

    } catch (error) {
      formatter.error(`Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`);
      await session.close();
      process.exit(EXIT_CODES.ERROR);
    }
  });

conversationsCommand
  .command('show <query>')
  .description('Show messages from a conversation (by contact name or phone number)')
  .action(async (query: string) => {
    const formatter = createOutputFormatter(program.opts());
    const session = new MessagesSession(program.opts().profile);

    try {
      await session.launch({ headless: true });
      await session.navigateToMessages();

      if (!await session.isPaired()) {
        formatter.error('Not paired with phone. Run "gmsg login" first.');
        await session.close();
        process.exit(EXIT_CODES.AUTH_NEEDED);
      }

      const found = await session.openConversation(query);

      if (!found) {
        formatter.error(`Conversation not found: ${query}`);
        await session.close();
        process.exit(EXIT_CODES.NOT_FOUND);
      }

      const messages = await session.getMessages();

      if (formatter['options'].json || !process.stdout.isTTY) {
        console.log(formatter.format(messages));
      } else {
        console.log(formatter.formatMessagesTable(messages));
      }

      await session.close();
      process.exit(EXIT_CODES.OK);

    } catch (error) {
      formatter.error(`Failed to show conversation: ${error instanceof Error ? error.message : String(error)}`);
      await session.close();
      process.exit(EXIT_CODES.ERROR);
    }
  });

const messagesCommand = program
  .command('messages')
  .description('Manage messages');

messagesCommand
  .command('send')
  .description('Send a message (DRY-RUN by default, use --yes to actually send)')
  .requiredOption('--to <query>', 'Recipient name or phone number')
  .requiredOption('--text <message>', 'Message text to send')
  .option('--yes', 'Actually send the message (default is dry-run)')
  .action(async (options: { to: string; text: string; yes?: boolean }) => {
    const formatter = createOutputFormatter(program.opts());
    const session = new MessagesSession(program.opts().profile);

    const dryRun = !options.yes;

    if (dryRun) {
      formatter.warning('DRY-RUN MODE: Message will not be sent');
      formatter.info(`Would send to: ${options.to}`);
      formatter.info(`Message: ${options.text}`);
      formatter.info('Add --yes flag to actually send');
      process.exit(EXIT_CODES.SEND_BLOCKED);
    }

    try {
      await session.launch({ headless: true });
      await session.navigateToMessages();

      if (!await session.isPaired()) {
        formatter.error('Not paired with phone. Run "gmsg login" first.');
        await session.close();
        process.exit(EXIT_CODES.AUTH_NEEDED);
      }

      const found = await session.openConversation(options.to);

      if (!found) {
        formatter.error(`Conversation not found: ${options.to}`);
        await session.close();
        process.exit(EXIT_CODES.NOT_FOUND);
      }

      const result = await session.sendMessage(options.text, false);

      if (result.success) {
        formatter.success(`Message sent to ${options.to}`);
        
        if (formatter['options'].json || !process.stdout.isTTY) {
          console.log(JSON.stringify({
            success: true,
            to: options.to,
            text: options.text,
            timestamp: new Date().toISOString()
          }, null, 2));
        }
      }

      await session.close();
      process.exit(EXIT_CODES.OK);

    } catch (error) {
      formatter.error(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
      await session.close();
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
