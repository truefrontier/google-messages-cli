#!/bin/bash
# Agent usage examples for google-messages-cli

echo "=== google-messages-cli Agent Integration Examples ==="
echo

# Example 1: Check if paired
echo "1. Check pairing status:"
echo "   $ gmsg status --json --quiet"
echo "   Exit code: 3 = needs pairing, 0 = paired"
echo

# Example 2: List conversations with JSON filtering
echo "2. List unread conversations:"
echo "   $ gmsg conversations list --json | jq '.[] | select(.unread == true)'"
echo

# Example 3: Get specific fields
echo "3. Get conversation names and unread status:"
echo "   $ gmsg conversations list --json --select name,unread"
echo

# Example 4: Show conversation by contact name
echo "4. Show messages from specific contact:"
echo "   $ gmsg conversations show \"Alice\" --json"
echo

# Example 5: Dry-run send (default, safe for testing)
echo "5. Test send (dry-run, exits with code 5):"
echo "   $ gmsg messages send --to \"Bob\" --text \"Test message\""
echo "   → No message sent, exit code 5"
echo

# Example 6: Actual send (requires explicit --yes)
echo "6. Actually send a message:"
echo "   $ gmsg messages send --to \"Bob\" --text \"Hello!\" --yes"
echo "   → Message sent, exit code 0"
echo

# Example 7: Compact JSON for minimal output
echo "7. Compact JSON (single line):"
echo "   $ gmsg conversations list --json --compact"
echo

# Example 8: CSV export
echo "8. Export to CSV:"
echo "   $ gmsg conversations list --csv > conversations.csv"
echo

# Example 9: Quiet mode (only errors)
echo "9. Silent status check:"
echo "   $ gmsg status --quiet"
echo "   → Check exit code: \$?"
echo

# Example 10: Custom profile path
echo "10. Use custom profile:"
echo "    $ gmsg --profile /custom/path login"
echo

echo "=== Session Safety ==="
echo "⚠ Only one client should use the profile at a time"
echo "⚠ Home Desk pattern: One agent owns sends, others query"
echo "⚠ Profile location: ~/.google-messages-cli/chrome-profile/"
echo "⚠ NEVER commit the profile directory to git"
echo

echo "=== Exit Codes ==="
echo "0 = Success"
echo "1 = General error"
echo "3 = Not paired (run 'gmsg login' first)"
echo "4 = Conversation not found"
echo "5 = Send blocked (dry-run mode, add --yes to send)"
