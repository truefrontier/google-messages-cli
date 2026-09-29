# google-messages-cli

Agent-native CLI for Google Messages for web (`messages.google.com`).

## Installation

```bash
npm install -g google-messages-cli
```

Or install locally:

```bash
npm install
npm run build
npm link
```

## Quick Start

1. **Pair with your phone** (one-time setup):
   ```bash
   gmsg login
   ```
   This opens a browser window where you scan a QR code with your phone.

2. **List conversations**:
   ```bash
   gmsg conversations list
   ```

3. **View messages**:
   ```bash
   gmsg conversations show "Alice"
   ```

4. **Send a message** (dry-run by default):
   ```bash
   gmsg messages send --to "Alice" --text "Hello!" --yes
   ```

## Commands

### Authentication

- `gmsg login` (alias: `gmsg pair`)  
  Open Google Messages in browser and wait for phone pairing. Session persists in `~/.google-messages-cli/chrome-profile/`.

- `gmsg status`  
  Check if the session is paired and active.

### Conversations

- `gmsg conversations list`  
  List recent conversations with contact names, message previews, timestamps, and unread indicators.

- `gmsg conversations show <query>`  
  Show messages from a conversation. `<query>` can be a contact name or phone number.

### Messages

- `gmsg messages send --to <name|number> --text "message"`  
  Send a message. **Requires `--yes` flag to actually send** (dry-run by default).

### Other

- `gmsg version`  
  Show CLI version.

## Output Formats

By default, output is formatted as human-readable tables when running in a terminal. For agent use, output automatically switches to JSON when stdout is not a TTY.

### Options

- `--json` - Force JSON output
- `--compact` - Compact JSON (no formatting)
- `--select <fields>` - Select specific fields (comma-separated)
- `--csv` - Output in CSV format
- `--quiet` - Suppress all output except errors
- `--profile <path>` - Use custom Chrome profile path

### Examples

```bash
# JSON output
gmsg conversations list --json

# Compact JSON
gmsg conversations list --json --compact

# Select specific fields
gmsg conversations list --json --select name,unread

# CSV output
gmsg conversations list --csv

# Quiet mode (only errors)
gmsg status --quiet
```

## Exit Codes

- `0` - Success
- `1` - General error
- `3` - Authentication needed (not paired with phone)
- `4` - Resource not found (conversation not found)
- `5` - Send blocked (dry-run mode, add --yes to send)

## Agent Notes

### Authentication Flow

The CLI uses a **persistent Playwright/Chromium profile** stored in `~/.google-messages-cli/chrome-profile/`. This means:

- You only need to pair with your phone once
- The session persists across CLI invocations
- No need to paste cookies or manage tokens manually

### Session Management

**Important**: Only one client should use the Chrome profile at a time. If you have multiple agents or processes, designate one "Home Desk" agent to own message sending. Other agents should delegate send requests to the Home Desk.

If two processes use the same profile simultaneously:
- Google Messages may log one of them out
- You'll need to run `gmsg login` again to re-pair

### Send Safety

The `gmsg messages send` command is **dry-run by default**. You must explicitly pass `--yes` to actually send a message:

```bash
# This will NOT send (exit code 5)
gmsg messages send --to "Alice" --text "Hello"

# This WILL send (exit code 0)
gmsg messages send --to "Alice" --text "Hello" --yes
```

This prevents accidental message sends during testing or agent development.

### Profile Path

The default profile path is `~/.google-messages-cli/chrome-profile/`.

**Never commit this directory to git.** It contains your Google Messages session and should be treated as sensitive.

You can use a custom profile path with the `--profile` option:

```bash
gmsg --profile /path/to/custom/profile login
```

## Implementation Details

This CLI uses Playwright to interact with the Google Messages web interface. It:

- Launches a persistent Chromium browser context with saved cookies/session
- Navigates to `messages.google.com/web/conversations`
- Extracts conversation and message data from the DOM
- Can send messages via the web interface

The CLI prefers to intercept any XHR/fetch endpoints exposed by Google Messages for more reliable data extraction, but falls back to DOM scraping with durable selectors when needed.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (during development)
npm run dev
```

## Version

Current version: **0.1.0**

## License

MIT
