import { useState } from 'react'
import { Shield, Zap, Bot, Music, Gamepad2, Settings, Smile, Radio, Wrench, Search, X } from 'lucide-react'
import { Layout } from '../components/Layout'

const CATEGORIES = {
  moderation: {
    icon: Shield, color: 'var(--error)',
    commands: [
      { name: 'ban', desc: 'Ban a member from the server' },
      { name: 'unban', desc: 'Unban a member' },
      { name: 'kick', desc: 'Kick a member from the server' },
      { name: 'mute', desc: 'Mute a member' },
      { name: 'unmute', desc: 'Unmute a member' },
      { name: 'warn', desc: 'Warn a member' },
      { name: 'jail', desc: 'Jail a member, restricting channel access' },
      { name: 'hardmute', desc: 'Fully mute a member (removes all roles)' },
      { name: 'softban', desc: 'Ban and immediately unban to clear messages' },
      { name: 'purge', desc: 'Bulk delete messages' },
      { name: 'selfpurge', desc: 'Delete your own recent messages' },
      { name: 'lock', desc: 'Lock a channel' },
      { name: 'hide', desc: 'Hide a channel from members' },
      { name: 'slowmode', desc: 'Set channel slowmode' },
      { name: 'drag', desc: 'Move a user to your voice channel' },
      { name: 'nickname', desc: "Change a member's nickname" },
      { name: 'role', desc: 'Add or remove roles from a member' },
      { name: 'imute', desc: 'Mute a member in images only' },
      { name: 'rmute', desc: 'Mute a member in reactions only' },
      { name: 'modlog', desc: 'View moderation history for a user' },
      { name: 'modstats', desc: 'View moderator action statistics' },
      { name: 'banlist', desc: 'View server ban list' },
      { name: 'mutelist', desc: 'View currently muted members' },
      { name: 'history', desc: 'Full moderation history for a member' },
      { name: 'note', desc: 'Add a private moderator note on a member' },
    ],
  },
  config: {
    icon: Settings, color: 'var(--fg-2)',
    commands: [
      { name: 'welcome', desc: 'Configure welcome messages' },
      { name: 'goodbye', desc: 'Configure goodbye messages' },
      { name: 'autorole', desc: 'Auto-assign roles to new members' },
      { name: 'reactionrole', desc: 'Set up reaction roles' },
      { name: 'antinuke', desc: 'Anti-nuke protection settings' },
      { name: 'antiraid', desc: 'Anti-raid detection and response' },
      { name: 'antispam', desc: 'Spam detection settings' },
      { name: 'antilink', desc: 'Link filtering settings' },
      { name: 'wordfilter', desc: 'Custom word filter' },
      { name: 'aimod', desc: 'AI-powered moderation settings' },
      { name: 'logging', desc: 'Server logging configuration' },
      { name: 'auditlog', desc: 'Audit log settings' },
      { name: 'prefix', desc: 'Change bot prefix' },
      { name: 'starboard', desc: 'Starboard configuration' },
      { name: 'ticket', desc: 'Support ticket system' },
      { name: 'voicemaster', desc: 'Temporary voice channels' },
      { name: 'boosterrole', desc: 'Custom roles for boosters' },
      { name: 'birthday', desc: 'Birthday tracking and announcements' },
      { name: 'counter', desc: 'Member count channels' },
      { name: 'confession', desc: 'Anonymous confession channel' },
      { name: 'autoresponder', desc: 'Custom auto-responses' },
      { name: 'customcommand', desc: 'Create custom commands' },
      { name: 'stickymessage', desc: 'Pin a message that stays at the bottom' },
      { name: 'bumpreminder', desc: 'Remind members to bump the server' },
      { name: 'nightwatch', desc: 'Late-night moderation rules' },
      { name: 'setup', desc: 'Interactive server setup wizard' },
      { name: 'quicksetup', desc: 'One-click server configuration templates' },
      { name: 'settings', desc: 'View current server settings' },
      { name: 'rolesetup', desc: 'Bulk role creation and configuration' },
      { name: 'backup', desc: 'Backup and restore server configuration' },
      { name: 'configaudit', desc: 'Audit config for broken references' },
    ],
  },
  economy: {
    icon: Gamepad2, color: 'var(--success)',
    commands: [
      { name: 'daily', desc: 'Claim daily coins' },
      { name: 'work', desc: 'Work for coins' },
      { name: 'beg', desc: 'Beg for coins' },
      { name: 'bank', desc: 'Deposit or withdraw from bank' },
      { name: 'transfer', desc: 'Send coins to another member' },
      { name: 'rob', desc: 'Attempt to rob another member' },
      { name: 'shop', desc: 'Browse the server shop' },
      { name: 'inventory', desc: 'View your inventory' },
      { name: 'coinflip', desc: 'Gamble with a coin flip' },
      { name: 'blackjack', desc: 'Play blackjack' },
      { name: 'slots', desc: 'Play the slot machine' },
      { name: 'leaderboard', desc: 'View richest members' },
      { name: 'fish', desc: 'Cast a line and catch fish for coins' },
      { name: 'hunt', desc: 'Hunt animals for coins' },
      { name: 'crime', desc: 'Commit a crime for risky rewards' },
      { name: 'heist', desc: 'Recruit a crew and rob the bank' },
    ],
  },
  leveling: {
    icon: Zap, color: 'var(--warning)',
    commands: [
      { name: 'rank', desc: "View your or another member's rank card" },
      { name: 'xpleaderboard', desc: 'View XP leaderboard' },
      { name: 'leveling', desc: 'Configure leveling settings' },
      { name: 'setlevel', desc: "Set a member's level" },
    ],
  },
  music: {
    icon: Music, color: 'var(--info)',
    commands: [
      { name: 'play', desc: 'Play a song or playlist' },
      { name: 'skip', desc: 'Skip the current song' },
      { name: 'stop', desc: 'Stop playback and clear queue' },
      { name: 'pause', desc: 'Pause or resume playback' },
      { name: 'queue', desc: 'View the current queue' },
      { name: 'nowplaying', desc: "Show what's currently playing" },
      { name: 'volume', desc: 'Adjust playback volume' },
      { name: 'loop', desc: 'Toggle loop mode' },
      { name: 'shuffle', desc: 'Shuffle the queue' },
    ],
  },
  ai: {
    icon: Bot, color: 'var(--accent)',
    commands: [
      { name: 'ask', desc: 'Ask the AI a question' },
      { name: 'summarize', desc: 'Summarize recent messages in a channel' },
      { name: 'sentiment', desc: 'Analyze the mood of a conversation' },
      { name: 'vibe', desc: 'Read the room — channel mood at a glance' },
      { name: 'roast', desc: 'AI-generated roast of a member' },
      { name: 'persona', desc: 'Chat with an AI persona' },
    ],
  },
  fun: {
    icon: Smile, color: 'var(--cat-amber)',
    commands: [
      { name: '8ball', desc: 'Ask the magic 8-ball' },
      { name: 'meme', desc: 'Get a random meme' },
      { name: 'trivia', desc: 'Play a trivia game' },
      { name: 'rps', desc: 'Rock paper scissors' },
      { name: 'ship', desc: 'Ship two members' },
      { name: 'truthordare', desc: 'Truth or dare' },
      { name: 'wyr', desc: 'Would you rather' },
      { name: 'uwuify', desc: 'UwUify text' },
      { name: 'mock', desc: 'Spongebob mock text' },
      { name: 'confess', desc: 'Send an anonymous confession' },
      { name: 'cat', desc: 'Random cat image' },
      { name: 'dog', desc: 'Random dog image' },
      { name: 'hug', desc: 'Hug someone' },
      { name: 'kiss', desc: 'Kiss someone' },
      { name: 'slap', desc: 'Slap someone' },
      { name: 'pat', desc: 'Pat someone' },
      { name: 'bite', desc: 'Bite someone' },
      { name: 'bonk', desc: 'Bonk someone' },
      { name: 'blacktea', desc: 'Sip tea at someone' },
    ],
  },
  lastfm: {
    icon: Radio, color: 'var(--cat-rose)',
    commands: [
      { name: 'fm', desc: 'Last.fm now playing and stats' },
    ],
  },
  utility: {
    icon: Wrench, color: 'var(--fg-3)',
    commands: [
      { name: 'help', desc: 'Show help for commands' },
      { name: 'ping', desc: 'Check bot latency' },
      { name: 'uptime', desc: 'Bot uptime' },
      { name: 'botinfo', desc: 'Bot statistics and info' },
      { name: 'server', desc: 'Server information' },
      { name: 'userinfo', desc: 'User information' },
      { name: 'avatar', desc: "View a user's avatar" },
      { name: 'banner', desc: "View a user's banner" },
      { name: 'membercount', desc: 'Server member count' },
      { name: 'roleinfo', desc: 'Role information' },
      { name: 'inrole', desc: 'List members with a role' },
      { name: 'bots', desc: 'List server bots' },
      { name: 'invites', desc: 'View server invites' },
      { name: 'emoji', desc: 'View or manage emoji' },
      { name: 'sticker', desc: 'View sticker info' },
      { name: 'poll', desc: 'Create a poll' },
      { name: 'remind', desc: 'Set a reminder' },
      { name: 'afk', desc: 'Set AFK status' },
      { name: 'snipe', desc: 'View last deleted message' },
      { name: 'quote', desc: 'Quote a message' },
      { name: 'translate', desc: 'Translate text' },
      { name: 'define', desc: 'Look up a word definition' },
      { name: 'calculate', desc: 'Calculator' },
      { name: 'timezone', desc: 'Timezone conversion' },
      { name: 'giveaway', desc: 'Create a giveaway' },
      { name: 'github', desc: 'View GitHub repo/user info' },
      { name: 'firstmessage', desc: 'Find first message in channel' },
      { name: 'joinposition', desc: 'Your server join position' },
      { name: 'newusers', desc: 'View recently joined members' },
      { name: 'channelstats', desc: 'Channel activity stats' },
      { name: 'voice', desc: 'Voice channel utilities' },
      { name: 'catchup', desc: 'Catch up on missed messages' },
      { name: 'toprole', desc: "View member's highest role" },
      { name: 'roleaudit', desc: 'Audit role permissions' },
      { name: 'staleperms', desc: 'Find stale permission overrides' },
      { name: 'ghostcheck', desc: 'Find inactive members' },
      { name: 'boostimpact', desc: 'Analyze boost impact' },
      { name: 'besttime', desc: 'Find best time to post' },
      { name: 'milestone', desc: 'Server milestones' },
      { name: 'spotlight', desc: 'Member spotlight' },
      { name: 'threadwatch', desc: 'Watch a thread for updates' },
    ],
  },
}

export function Commands() {
  const [activeCategory, setActiveCategory] = useState('moderation')
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const allCommands = Object.entries(CATEGORIES).flatMap(([cat, data]) =>
    data.commands.map(c => ({ ...c, category: cat, color: data.color }))
  )

  const totalCount = allCommands.length

  const filteredCommands = search.trim()
    ? allCommands.filter(c =>
        c.name.includes(search.toLowerCase()) ||
        c.desc.toLowerCase().includes(search.toLowerCase()) ||
        c.category.includes(search.toLowerCase())
      )
    : CATEGORIES[activeCategory]?.commands || []

  return (
    <Layout>
      <style>{`
        .cmd-row { transition: background 80ms var(--ease-default); }
        .cmd-row:hover { background: var(--surface-hover); }
        .cat-btn { transition: all 100ms var(--ease-default); cursor: pointer; border: none; position: relative; }
        .cat-btn:hover { background: var(--surface-hover) !important; }
        @media (max-width: 768px) {
          .cmd-layout { flex-direction: column !important; }
          .cmd-sidebar { width: 100% !important; flex-direction: row !important; overflow-x: auto !important; border-right: none !important; border-bottom: 1px solid var(--border-subtle) !important; padding: var(--space-2) !important; gap: 2px !important; }
          .cmd-sidebar > button { white-space: nowrap; }
        }
      `}</style>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-10) var(--space-6) 0' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
            fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
            letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-2)',
          }}>
            Commands
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--fg-3)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)', fontWeight: 'var(--weight-medium)' }}>{totalCount}</span> commands across {Object.keys(CATEGORIES).length} categories.
            Prefix: <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)' }}>;</code> or slash.
          </p>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          height: 'var(--input-height-lg)', padding: '0 var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          border: `1px solid ${searchFocused ? 'var(--border-focus)' : 'var(--border-default)'}`,
          background: 'var(--surface-1)',
          boxShadow: searchFocused ? '0 0 0 3px rgba(255, 255, 255, 0.05)' : 'none',
          transition: 'border-color 100ms, box-shadow 100ms',
          marginBottom: 'var(--space-8)',
        }}>
          <Search size={15} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label="Search commands"
            placeholder="Search commands..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 'var(--text-base)', color: 'var(--fg-1)', fontFamily: 'var(--font-body)',
              letterSpacing: 'var(--tracking-base)',
            }}
          />
          {search && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {filteredCommands.length}
              </span>
              <button onClick={() => setSearch('')} aria-label="Clear search" style={{ display: 'flex', color: 'var(--fg-3)', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="cmd-layout" style={{ maxWidth: 1000, margin: '0 auto', padding: '0 var(--space-6) var(--space-20)', display: 'flex', gap: 0 }}>
        {/* Category sidebar */}
        {!search && (
          <div className="cmd-sidebar" style={{
            width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2,
            borderRight: '1px solid var(--border-subtle)', paddingRight: 'var(--space-5)',
          }}>
            {Object.entries(CATEGORIES).map(([key, data]) => {
              const Icon = data.icon
              const active = activeCategory === key
              return (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className="cat-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-2-5)', borderRadius: 'var(--radius-md)',
                    textAlign: 'left',
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    border: active ? '1px solid var(--border-accent)' : '1px solid transparent',
                    color: active ? 'var(--fg-1)' : 'var(--fg-3)',
                    fontSize: 'var(--text-sm)', fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-normal)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {active && <div style={{ position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)', width: 2, height: 14, borderRadius: 2, background: 'var(--accent)' }} />}
                  <Icon size={14} style={{ color: active ? data.color : 'var(--fg-4)', flexShrink: 0 }} />
                  <span style={{ textTransform: 'capitalize', flex: 1 }}>{key}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                    {data.commands.length}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Commands list */}
        <div style={{ flex: 1, paddingLeft: search ? 0 : 'var(--space-5)' }}>
          {!search && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{
                fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)',
                textTransform: 'capitalize', letterSpacing: 'var(--tracking-snug)',
                marginBottom: 2,
              }}>
                {activeCategory}
              </h2>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {CATEGORIES[activeCategory].commands.length} commands
              </p>
            </div>
          )}

          <div style={{
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-default)',
            background: 'var(--surface-1)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xs)',
          }}>
            {filteredCommands.map((cmd, i) => (
              <div
                key={cmd.name + (cmd.category || '')}
                className="cmd-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  padding: 'var(--space-2-5) var(--space-4)',
                  borderBottom: i < filteredCommands.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <code style={{
                  fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
                  color: search ? (cmd.color || 'var(--accent)') : CATEGORIES[activeCategory]?.color || 'var(--accent)',
                  fontFamily: 'var(--font-mono)', minWidth: 110,
                }}>
                  ;{cmd.name}
                </code>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-3)', flex: 1 }}>{cmd.desc}</span>
                {search && (
                  <span style={{
                    fontSize: 'var(--text-xs)', color: 'var(--fg-4)', textTransform: 'capitalize',
                    background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '2px 6px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {cmd.category}
                  </span>
                )}
              </div>
            ))}
            {filteredCommands.length === 0 && (
              <div style={{ padding: 'var(--space-10) var(--space-4)', textAlign: 'center', color: 'var(--fg-3)', fontSize: 'var(--text-base)' }}>
                No commands found for "{search}"
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
