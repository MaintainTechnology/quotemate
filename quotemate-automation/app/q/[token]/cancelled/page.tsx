export const dynamic = 'force-dynamic'

export default async function CancelledPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '4rem auto', padding: '0 1rem', color: '#111' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Payment cancelled</h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>
        No worries — you haven't been charged. Your quote is still valid; tap any of the three options
        in the SMS to come back.
      </p>
      <p style={{ marginTop: '2rem', fontSize: '0.85rem', color: '#666' }}>
        Quote ref: {token.slice(0, 8)}
      </p>
    </main>
  )
}
