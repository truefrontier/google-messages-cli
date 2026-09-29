# google-messages-cli v0.1.0 - Summary

## Binary & Commands

**Binary name:** `gmsg`

**Commands:**
1. `gmsg version` - Show version (0.1.0)
2. `gmsg login` (alias: `pair`) - Open headed browser for QR code pairing
3. `gmsg status` - Check pairing status
4. `gmsg conversations list` - List recent conversations
5. `gmsg conversations show <query>` - Show messages from a conversation
6. `gmsg messages send --to <name|number> --text "..." [--yes]` - Send message (dry-run by default)

## Authentication & Profile

**Profile path:** `~/.google-messages-cli/chrome-profile/`

**Login flow:**
1. Run `gmsg login`
2. Headed Chromium window opens to messages.google.com
3. Scan QR code with phone to pair
4. Session persists in profile directory
5. Future commands use saved session (headless)

**Session safety:**
- Only one client should use profile at a time
- Recommend: Home Desk agent owns live sends
- Other agents query or delegate to Home Desk

## Output Formats

**Auto-JSON:** When stdout is not a TTY (agent mode)
**Human tables:** When interactive terminal

**Options:**
- `--json` - Force JSON output
- `--compact` - Compact JSON (no whitespace)
- `--select <fields>` - Select specific fields (comma-separated)
- `--csv` - CSV output
- `--quiet` - Suppress all output except errors

## Exit Codes

- `0` - OK
- `1` - General error
- `3` - Auth needed (not paired)
- `4` - Not found (conversation not found)
- `5` - Send blocked (dry-run mode)

## Send Safety

**Default: DRY-RUN**
- `gmsg messages send --to "Alice" --text "Hi"` → exits with code 5, no send
- `gmsg messages send --to "Alice" --text "Hi" --yes` → actually sends

No auto-retry on sends. Dry-run prevents accidental messages during testing.

## Implementation

- **Language:** TypeScript
- **Browser:** Playwright with persistent Chromium context
- **Session storage:** Chrome user data profile on disk
- **Extraction:** DOM scraping with durable selectors (Google Messages web)
- **Tests:** Jest - validates dry-run gating, JSON output shape, exit codes

## Repository

**Repo URL:** https://origin.cursor.com/git/kevnk/tmp-5ad8f2ee3d035c76.git
**Current branch:** main
**Commit:** 439946d

## Development

```bash
npm install
npm run build
npm test
npm link  # for local testing
```

## Safety Notes

1. **NEVER commit chrome-profile/ to git** - contains session cookies
2. **NEVER paste session cookies** in README, chat, or cloud MCP
3. **One client per profile** - concurrent access breaks pairing
4. **Dry-run by default** - explicit `--yes` required to send
5. **Home Desk pattern** - designate one agent to own sends

## Agent Integration Example

```bash
# Check status (exit 0 = paired, 3 = needs pairing)
gmsg status --json --quiet
echo $?

# List conversations (auto-JSON for pipes)
gmsg conversations list | jq '.[] | select(.unread == true)'

# Show specific conversation
gmsg conversations show "Alice" --json --select direction,text,timestamp

# Send (dry-run first)
gmsg messages send --to "Bob" --text "Test message"
# If safe, actually send
gmsg messages send --to "Bob" --text "Test message" --yes
```

## Next Steps

When ready to publish:
1. Test login flow with real Google Messages pairing
2. Verify conversation list extraction with live data
3. Test message send with --yes flag
4. Consider adding message search/filter
5. Consider adding read/unread marking
6. Consider adding attachment support
