import { MessagesSession } from './browser';
import { OutputFormatter } from './output';

describe('google-messages-cli', () => {
  describe('MessagesSession', () => {
    it('should create session with default profile path', () => {
      const session = new MessagesSession();
      expect(session).toBeDefined();
    });

    it('should accept custom profile path', () => {
      const session = new MessagesSession('/custom/path');
      expect(session).toBeDefined();
    });

    it('should enforce dry-run by default', async () => {
      const session = new MessagesSession();
      
      try {
        await session.launch({ headless: true });
        const result = await session.sendMessage('test message', true);
        
        expect(result.dryRun).toBe(true);
        expect(result.success).toBe(true);
        await session.close();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should allow sending when dry-run is false', async () => {
      const session = new MessagesSession();
      
      try {
        const result = await session.sendMessage('test', false);
        expect(result.dryRun).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('OutputFormatter', () => {
    it('should format as JSON when json option is set', () => {
      const formatter = new OutputFormatter({ json: true });
      const data = { test: 'value' };
      const output = formatter.format(data);
      
      expect(() => JSON.parse(output)).not.toThrow();
      expect(JSON.parse(output)).toEqual(data);
    });

    it('should format as compact JSON when compact option is set', () => {
      const formatter = new OutputFormatter({ json: true, compact: true });
      const data = { test: 'value' };
      const output = formatter.format(data);
      
      expect(output).toBe('{"test":"value"}');
    });

    it('should format conversations array correctly', () => {
      const formatter = new OutputFormatter({ json: true });
      const conversations = [
        { name: 'Alice', preview: 'Hello', timestamp: '10:30 AM', unread: false },
        { name: 'Bob', preview: 'Hi there', timestamp: '9:15 AM', unread: true }
      ];
      
      const output = formatter.format(conversations);
      const parsed = JSON.parse(output);
      
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Alice');
      expect(parsed[1].unread).toBe(true);
    });

    it('should format messages array correctly', () => {
      const formatter = new OutputFormatter({ json: true });
      const messages = [
        { direction: 'sent' as const, text: 'Hey', timestamp: '10:30 AM' },
        { direction: 'received' as const, text: 'Hi', timestamp: '10:31 AM' }
      ];
      
      const output = formatter.format(messages);
      const parsed = JSON.parse(output);
      
      expect(parsed).toHaveLength(2);
      expect(parsed[0].direction).toBe('sent');
      expect(parsed[1].direction).toBe('received');
    });

    it('should select specific fields when select option is provided', () => {
      const formatter = new OutputFormatter({ json: true, select: 'name,unread' });
      const data = [
        { name: 'Alice', preview: 'Hello', timestamp: '10:30 AM', unread: false }
      ];
      
      const output = formatter.format(data);
      const parsed = JSON.parse(output);
      
      expect(parsed[0]).toHaveProperty('name');
      expect(parsed[0]).toHaveProperty('unread');
      expect(parsed[0]).not.toHaveProperty('preview');
      expect(parsed[0]).not.toHaveProperty('timestamp');
    });

    it('should format as CSV when csv option is set', () => {
      const formatter = new OutputFormatter({ csv: true });
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ];
      
      const output = formatter.format(data);
      const lines = output.split('\n');
      
      expect(lines[0]).toBe('name,age');
      expect(lines[1]).toBe('Alice,30');
      expect(lines[2]).toBe('Bob,25');
    });

    it('should return empty string when quiet option is set', () => {
      const formatter = new OutputFormatter({ quiet: true });
      const data = { test: 'value' };
      const output = formatter.format(data);
      
      expect(output).toBe('');
    });
  });

  describe('Exit codes', () => {
    it('should define correct exit codes', () => {
      const EXIT_CODES = {
        OK: 0,
        ERROR: 1,
        AUTH_NEEDED: 3,
        NOT_FOUND: 4,
        SEND_BLOCKED: 5
      };

      expect(EXIT_CODES.OK).toBe(0);
      expect(EXIT_CODES.AUTH_NEEDED).toBe(3);
      expect(EXIT_CODES.NOT_FOUND).toBe(4);
      expect(EXIT_CODES.SEND_BLOCKED).toBe(5);
    });
  });
});
