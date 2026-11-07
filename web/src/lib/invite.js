// One source of truth for the bot invite link on the site. The permission value is the same minimum set the bot's
// /invite command builds (src/commands/utility/invite.js, no Administrator); keep the two in step.
export const INVITE_PERMISSIONS = '1374824819926'

// The application (client) id is public. VITE_DISCORD_CLIENT_ID overrides it, e.g. for a test app.
export const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || '1513061919517315142'

// null when VITE_DISCORD_CLIENT_ID is unset, so callers can render a warning instead of a wrong link.
export const INVITE_URL = CLIENT_ID
  ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${INVITE_PERMISSIONS}&scope=bot+applications.commands`
  : null
