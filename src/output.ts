import chalk from 'chalk';
import Table from 'cli-table3';

export interface OutputOptions {
  json?: boolean;
  compact?: boolean;
  select?: string;
  csv?: boolean;
  quiet?: boolean;
}

export class OutputFormatter {
  private options: OutputOptions;
  private isTTY: boolean;

  constructor(options: OutputOptions = {}) {
    this.options = options;
    this.isTTY = process.stdout.isTTY || false;
  }

  format(data: any): string {
    if (this.options.quiet) {
      return '';
    }

    if (this.options.csv) {
      return this.formatCSV(data);
    }

    if (this.options.json || !this.isTTY) {
      return this.formatJSON(data);
    }

    return this.formatHuman(data);
  }

  private formatJSON(data: any): string {
    if (this.options.select) {
      data = this.selectFields(data, this.options.select);
    }

    if (this.options.compact) {
      return JSON.stringify(data);
    }

    return JSON.stringify(data, null, 2);
  }

  private formatCSV(data: any): string {
    if (!Array.isArray(data)) {
      data = [data];
    }

    if (data.length === 0) {
      return '';
    }

    const keys = Object.keys(data[0]);
    const header = keys.join(',');
    const rows = data.map((item: any) => 
      keys.map(key => {
        const value = String(item[key] || '');
        return value.includes(',') ? `"${value}"` : value;
      }).join(',')
    );

    return [header, ...rows].join('\n');
  }

  private formatHuman(data: any): string {
    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'object' && data.message) {
      return data.message;
    }

    return JSON.stringify(data, null, 2);
  }

  private selectFields(data: any, fields: string): any {
    const fieldList = fields.split(',').map(f => f.trim());

    if (Array.isArray(data)) {
      return data.map(item => this.selectFromObject(item, fieldList));
    }

    return this.selectFromObject(data, fieldList);
  }

  private selectFromObject(obj: any, fields: string[]): any {
    const result: any = {};
    
    for (const field of fields) {
      if (field in obj) {
        result[field] = obj[field];
      }
    }

    return result;
  }

  formatConversationsTable(conversations: Array<{
    name: string;
    preview: string;
    timestamp: string;
    unread: boolean;
  }>): string {
    if (this.options.json || !this.isTTY) {
      return this.format(conversations);
    }

    if (this.options.csv) {
      return this.formatCSV(conversations);
    }

    const table = new Table({
      head: ['Name', 'Preview', 'Time', 'Status'],
      colWidths: [25, 50, 15, 10],
      wordWrap: true
    });

    for (const conv of conversations) {
      table.push([
        conv.unread ? chalk.bold(conv.name) : conv.name,
        conv.preview,
        conv.timestamp,
        conv.unread ? chalk.yellow('●') : ''
      ]);
    }

    return table.toString();
  }

  formatMessagesTable(messages: Array<{
    direction: 'sent' | 'received';
    text: string;
    timestamp: string;
  }>): string {
    if (this.options.json || !this.isTTY) {
      return this.format(messages);
    }

    if (this.options.csv) {
      return this.formatCSV(messages);
    }

    const table = new Table({
      head: ['Direction', 'Message', 'Time'],
      colWidths: [12, 60, 15],
      wordWrap: true
    });

    for (const msg of messages) {
      const direction = msg.direction === 'sent' 
        ? chalk.blue('→ Sent')
        : chalk.green('← Received');
      
      table.push([direction, msg.text, msg.timestamp]);
    }

    return table.toString();
  }

  success(message: string): void {
    if (!this.options.quiet) {
      console.log(chalk.green('✓'), message);
    }
  }

  error(message: string): void {
    if (!this.options.quiet) {
      console.error(chalk.red('✗'), message);
    }
  }

  warning(message: string): void {
    if (!this.options.quiet) {
      console.warn(chalk.yellow('⚠'), message);
    }
  }

  info(message: string): void {
    if (!this.options.quiet) {
      console.log(chalk.blue('ℹ'), message);
    }
  }
}
