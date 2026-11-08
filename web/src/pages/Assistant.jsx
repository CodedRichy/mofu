import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Plus, LogIn, Sparkles, Trash2 } from 'lucide-react'
import { Layout, NOISE_SVG } from '../components/Layout'
import { useToken, loginUrl as buildLoginUrl } from '../lib/auth'
import { BRAND } from '../lib/brand'

function ChatInput({ onSend, disabled }) {
  const [val, setVal] = useState('')
  const [focused, setFocused] = useState(false)
  const textRef = useRef(null)

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (val.trim()) { onSend(val.trim()); setVal('') }
    }
  }

  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto'
      textRef.current.style.height = Math.min(textRef.current.scrollHeight, 160) + 'px'
    }
  }, [val])

  return (
    <div style={{ padding: 'var(--space-3) var(--space-5) var(--space-4)', flexShrink: 0 }}>
      <div style={{
        border: `1px solid ${focused ? 'var(--border-focus)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-xl)', overflow: 'hidden',
        background: 'var(--surface-1)',
        boxShadow: focused ? '0 0 0 3px rgba(255, 255, 255, 0.04)' : 'var(--shadow-xs)',
        transition: 'border-color 100ms var(--ease-default), box-shadow 100ms var(--ease-default)',
      }}>
        <textarea
          ref={textRef}
          value={val} onChange={e => setVal(e.target.value)} onKeyDown={handleKey}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          rows={1} placeholder={`Ask ${BRAND} anything...`} disabled={disabled}
          style={{
            display: 'block', width: '100%', background: 'transparent', border: 'none', outline: 'none',
            padding: 'var(--space-3) var(--space-4) var(--space-1-5)',
            fontSize: 'var(--text-base)', color: 'var(--fg-1)',
            lineHeight: 1.6, resize: 'none', fontFamily: 'var(--font-body)',
            letterSpacing: 'var(--tracking-base)', maxHeight: 160,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', padding: 'var(--space-1) var(--space-3) var(--space-2)', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>Shift+Enter for new line</span>
          <button
            onClick={() => { if (val.trim()) { onSend(val.trim()); setVal('') } }}
            disabled={!val.trim() || disabled}
            style={{
              width: 30, height: 30, borderRadius: 'var(--radius-md)',
              background: val.trim() ? 'var(--accent)' : 'var(--surface-2)',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: val.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 120ms var(--ease-default)',
              boxShadow: val.trim() ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}
          >
            <Send size={13} style={{ color: val.trim() ? 'var(--accent-fg)' : 'var(--fg-4)' }} />
          </button>
        </div>
      </div>
      <p style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--fg-4)', marginTop: 'var(--space-2)' }}>
        {BRAND} AI can make mistakes. Verify important information.
      </p>
    </div>
  )
}

function MessageBubble({ msg }) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: 'var(--space-3) 0' }}>
        <div style={{
          maxWidth: '72%',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-2-5) var(--space-4)',
          boxShadow: 'var(--shadow-xs)',
        }}>
          <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--fg-1)', lineHeight: 1.65 }}>{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ margin: 'var(--space-4) 0' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2-5)', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
        <div style={{
          width: 26, height: 26, borderRadius: 'var(--radius-md)',
          overflow: 'hidden', flexShrink: 0,
          border: '1px solid var(--border-subtle)',
        }}>
          <img src="/logo.jpg" alt={BRAND} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-1)', lineHeight: '26px', fontFamily: 'var(--font-display)' }}>{BRAND}</span>
      </div>
      <div style={{ paddingLeft: 36 }}>
        {msg.content.split('\n').map((line, i) => {
          if (!line) return <br key={i} />
          return <p key={i} style={{ margin: '2px 0', color: 'var(--fg-2)', fontSize: 'var(--text-base)', lineHeight: 1.75 }}>{line}</p>
        })}
      </div>
    </div>
  )
}

export function Assistant() {
  const [messages, setMessages] = useState([])
  const [typing, setTyping] = useState(false)
  const bottomRef = useRef(null)
  const token = useToken()

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollTop = bottomRef.current.scrollHeight
  }, [messages, typing])

  if (!token) {
    const loginUrl = buildLoginUrl()
    return (
      <Layout>
        <style>{`
          @keyframes reveal { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
          @keyframes drift { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        `}</style>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '70vh', padding: 'var(--space-10) var(--space-6)', textAlign: 'center',
        }}>
          <div style={{ animation: 'drift 5s ease-in-out infinite', marginBottom: 'var(--space-6)' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 'var(--radius-xl)',
              overflow: 'hidden', border: '1px solid var(--border-accent)',
              boxShadow: 'var(--shadow-accent-lg)',
            }}>
              <img src="/logo.jpg" alt={BRAND} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>

          <div style={{ animation: 'reveal 0.6s var(--ease-default) 0.1s both' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)',
              background: 'var(--accent-subtle)', border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-full)', padding: '4px 11px', marginBottom: 'var(--space-4)',
            }}>
              <Sparkles size={11} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--accent)' }}>AI Assistant</span>
            </div>
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
            letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-2)',
            animation: 'reveal 0.6s var(--ease-default) 0.15s both',
          }}>
            {BRAND} AI Assistant
          </h1>
          <p style={{
            fontSize: 'var(--text-base)', color: 'var(--fg-3)', lineHeight: 1.6,
            maxWidth: 420, marginBottom: 'var(--space-8)',
            animation: 'reveal 0.6s var(--ease-default) 0.2s both',
          }}>
            Ask questions, get moderation advice, configure settings — all through natural conversation.
          </p>

          <a href={loginUrl} style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
            height: 44, padding: '0 22px', borderRadius: 'var(--radius-lg)',
            background: '#5865F2', color: '#fff',
            fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)',
            textDecoration: 'none', fontFamily: 'var(--font-body)',
            boxShadow: '0 0 32px rgba(88,101,242,0.25), var(--shadow-md)',
            animation: 'reveal 0.6s var(--ease-default) 0.3s both',
          }}>
            <LogIn size={15} />
            Login with Discord
          </a>

          <div style={{ marginTop: 'var(--space-12)', display: 'grid', gap: 'var(--space-2-5)', textAlign: 'left', maxWidth: 400, width: '100%', animation: 'reveal 0.6s var(--ease-default) 0.4s both' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>Example questions</span>
            {[
              'How should I set up automod for my server?',
              'Summarize what happened in #general today',
              'What are the best XP settings for a 5k member server?',
            ].map(q => (
              <div key={q} style={{
                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-1)',
                fontSize: 'var(--text-sm)', color: 'var(--fg-3)',
                fontStyle: 'italic',
              }}>
                "{q}"
              </div>
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  const handleSend = async (text) => {
    setMessages(m => [...m, { id: Date.now(), role: 'user', content: text }])
    setTyping(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages.slice(-10) }),
      })
      const data = await res.json().catch(() => null)
      setTyping(false)
      const content = res.ok && data?.response ? data.response
        : res.status === 401 ? 'Your session expired. Sign in again to keep chatting.'
        : 'Sorry, I could not process that request.'
      setMessages(m => [...m, { id: Date.now() + 1, role: 'assistant', content }])
    } catch {
      setTyping(false)
      setMessages(m => [...m, { id: Date.now() + 1, role: 'assistant', content: 'The AI is not answering right now. Try again in a minute.' }])
    }
  }

  return (
    <Layout bare>
      <div className="assistant-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div className="assistant-aside" style={{
          width: 'var(--sidebar-width)', flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-subtle)',
        }}>
          <div style={{ padding: 'var(--space-3) var(--space-3) var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-1)', marginBottom: 'var(--space-3)' }}>
              <img src="/logo.jpg" alt={BRAND} style={{ width: 22, height: 22, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--fg-1)' }}>{BRAND} AI</span>
            </div>
            <button
              onClick={() => setMessages([])}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
                height: 'var(--input-height-sm)', padding: '0 var(--space-2-5)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-1)', border: '1px solid var(--border-default)',
                color: 'var(--fg-2)', fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-body)', cursor: 'pointer',
                transition: 'var(--transition-fast)',
              }}
            >
              <Plus size={13} /> New conversation
            </button>
          </div>
          <div className="dash-hide-narrow" style={{ flex: 1, padding: 'var(--space-1) var(--space-2)' }}>
            {messages.length > 0 && (
              <div style={{
                fontSize: 'var(--text-xs)', color: 'var(--fg-3)',
                padding: 'var(--space-2) var(--space-2-5)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {messages[0]?.content?.slice(0, 30)}...
                </span>
                <button onClick={() => setMessages([])} aria-label="Clear conversation" style={{ color: 'var(--fg-3)', cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={11} />
                </button>
              </div>
            )}
            {messages.length === 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-4)', padding: 'var(--space-2-5) var(--space-2)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', fontWeight: 'var(--weight-medium)' }}>
                No conversations
              </div>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {/* Top bar */}
          <div style={{
            height: 'var(--topbar-height)', borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 var(--space-5)', flexShrink: 0,
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--glass-blur))',
          }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--fg-2)' }}>
              {messages.length > 0 ? 'Conversation' : 'New conversation'}
            </span>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)',
              fontSize: 'var(--text-xs)', color: 'var(--fg-4)',
              background: 'var(--surface-1)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-full)', padding: '3px 8px',
            }}>
              <Bot size={10} />
              Qwen3.8 27B
            </div>
          </div>

          {/* Messages */}
          <div ref={bottomRef} className="assistant-msgs" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-10)' }}>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--space-3)' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                  border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)',
                }}>
                  <img src="/logo.jpg" alt={BRAND} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <p style={{ color: 'var(--fg-3)', fontSize: 'var(--text-md)', fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-medium)' }}>What can I help with?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-4)', maxWidth: 400, justifyContent: 'center' }}>
                  {['Set up automod', 'XP settings', 'Moderation tips', 'Economy balance'].map(q => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      style={{
                        fontSize: 'var(--text-xs)', color: 'var(--fg-3)',
                        padding: '6px 12px', borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--border-default)',
                        background: 'var(--surface-1)', cursor: 'pointer',
                        transition: 'var(--transition-fast)',
                        fontFamily: 'var(--font-body)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-accent)'; e.currentTarget.style.color = 'var(--fg-1)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--fg-3)' }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
            {typing && (
              <div style={{ display: 'flex', gap: 'var(--space-2-5)', alignItems: 'flex-start', margin: 'var(--space-4) 0' }}>
                <div style={{ width: 26, height: 26, borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--border-subtle)' }}>
                  <img src="/logo.jpg" alt={BRAND} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ paddingTop: 8, display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%', background: 'var(--fg-3)',
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <ChatInput onSend={handleSend} disabled={typing} />
        </div>
      </div>
    </Layout>
  )
}
