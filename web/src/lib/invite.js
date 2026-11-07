// One source of truth for the bot invite link. Permissions are computed from named bits so a change is reviewable.
// Removed vs the old 1375332592887: CreateInstantInvite, ManageWebhooks. Added: MoveMembers, MuteMembers, ManageGuildExpressions.
const OLD_PERMISSIONS = 1375332592887n
const REMOVE = (1n << 0n) | (1n << 29n)
const ADD = (1n << 24n) | (1n << 22n) | (1n << 30n)

export const INVITE_PERMISSIONS = ((OLD_PERMISSIONS & ~REMOVE) | ADD).toString()

export const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || ''

// null when VITE_DISCORD_CLIENT_ID is unset, so callers can render a warning instead of a wrong link.
export const INVITE_URL = CLIENT_ID
  ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${INVITE_PERMISSIONS}&scope=bot+applications.commands`
  : null
