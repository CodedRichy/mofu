import { useCallback, useEffect, useRef, useState } from 'react'

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // insecure origin or denied permission: fall back to a hidden textarea
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

// One copy state for the whole page: which string was copied last, and a message for the aria-live region.
export function useCopy(resetMs = 1600) {
  const [copied, setCopied] = useState(null)
  const [message, setMessage] = useState('')
  const timer = useRef(0)

  const copy = useCallback(async (text) => {
    const ok = await writeClipboard(text)
    clearTimeout(timer.current)
    setCopied(ok ? text : null)
    setMessage(ok ? `Copied ${text}` : `Could not copy. Select the text and copy it manually.`)
    timer.current = setTimeout(() => setCopied(null), resetMs)
  }, [resetMs])

  useEffect(() => () => clearTimeout(timer.current), [])
  return { copy, copied, message }
}
