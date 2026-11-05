'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'

type Message = { id: string; status: string; body: string; to_number: string; audience: string;
  provider_error: string | null; requires_attention: boolean; created_at: string }
export default function SmsDeliveryPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [notice, setNotice] = useState('Loading delivery status…')
  const [loadState, setLoadState] = useState<'loading'|'loaded'|'error'>('loading')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const token = await getAuthToken()
    if (!token) throw new Error('Sign in to view your message delivery.')
    const response = await fetch('/api/tenant/sms-delivery', { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Delivery status is temporarily unavailable. Please try again.')
    const data = await response.json()
    if (!Array.isArray(data.messages)) throw new Error('Delivery status is temporarily unavailable. Please try again.')
    return data.messages as Message[]
  }, [])
  const apply = useCallback((messages: Message[]) => {
    setMessages(messages)
    setLoadState('loaded')
    setNotice('')
  }, [])
  const loadFailed = useCallback((error: unknown) => {
    setLoadState('error')
    setNotice(error instanceof Error && error.message === 'Sign in to view your message delivery.'
      ? error.message : 'Delivery status is temporarily unavailable. Please try again.')
  }, [])
  const refresh = useCallback(async () => {
    setLoadState('loading')
    setNotice('Loading delivery status…')
    try { apply(await load()); return true }
    catch (error) { loadFailed(error); return false }
  }, [load, apply, loadFailed])
  useEffect(() => {
    let active = true
    void load().then(messages => { if (active) apply(messages) }).catch(error => { if (active) loadFailed(error) })
    return () => { active = false }
  }, [load, apply, loadFailed])
  async function retry(id: string) {
    setBusy(true)
    try {
      const token = await getAuthToken()
      const response = await fetch('/api/tenant/sms-delivery', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Retry could not be scheduled.')
      if (await refresh()) setNotice('The message is queued for another delivery attempt.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Retry could not be scheduled.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 text-text-pri">
    <h1 className="text-2xl font-semibold">SMS delivery</h1>
    <p className="text-text-dim">Accepted messages are with the provider. Delivered messages have a delivery receipt. An unknown result needs investigation before sending again.</p>
    <button type="button" disabled={busy || loadState === 'loading'} onClick={() => void refresh()}
      className="rounded border border-ink-line px-4 py-2">{loadState === 'loading' ? 'Refreshing…' : 'Refresh'}</button>
    <p role={loadState === 'error' ? 'alert' : 'status'}>{notice}</p>
    {loadState === 'loaded' && !messages.length && <p>No messages have been queued yet.</p>}
    {loadState === 'error' && messages.length > 0 && <p className="text-text-dim">Showing the last loaded messages. Their delivery status may have changed.</p>}
    <ul className="space-y-4">{messages.map(message => <li key={message.id} className="space-y-2 rounded border border-ink-line p-4">
      <div className="flex flex-wrap justify-between gap-2"><strong>{message.status}</strong>
        <time>{new Date(message.created_at).toLocaleString('en-AU')}</time></div>
      <p>{message.audience === 'tradie' ? 'Tradie' : 'Customer'} · {message.to_number}</p>
      <p className="whitespace-pre-wrap break-words">{message.body}</p>
      {message.requires_attention && <p>Needs attention{message.provider_error ? ` · provider code ${message.provider_error}` : ''}</p>}
      {['failed','undelivered'].includes(message.status) && message.provider_error !== '21610' &&
        <button type="button" disabled={busy || loadState === 'loading'} onClick={() => void retry(message.id)} className="rounded border border-ink-line px-4 py-2">Retry this message</button>}
    </li>)}</ul>
  </main>
}
