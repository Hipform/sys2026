const SALT = 'pdf-notes-pin-v1'

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${SALT}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyPin(
  pin: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return true
  return (await hashPin(pin)) === hash
}
