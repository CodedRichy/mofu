import { useState, useEffect } from 'react'

// Editing a list through a text box: keep what the user typed ("a, b," or a trailing newline) in local state,
// push the parsed array up on every change, and only re-sync from the parent when it changed from outside.
const SPLIT = { comma: /,/, line: /\n/ }

export function parseList(text, mode = 'comma') {
  return String(text).split(SPLIT[mode]).map(s => s.trim()).filter(Boolean)
}

export function useListText(list, onList, mode = 'comma') {
  const joiner = mode === 'line' ? '\n' : ', '
  const [text, setText] = useState(() => (list || []).join(joiner))
  useEffect(() => {
    if (JSON.stringify(parseList(text, mode)) !== JSON.stringify(list || [])) setText((list || []).join(joiner))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])
  return [text, (t) => { setText(t); onList(parseList(t, mode)) }]
}
