/**
 * Desktop Host control transport.
 *
 * The Electron shell spawned the Host with a Node IPC channel
 * (`process.send` / `process.on('message')`). Tauri has no such channel, so the
 * Host can also speak newline-delimited JSON over piped stdio: frames are
 * written with a synchronous `fs.writeSync(1, …)` (so `ready`, `fatal` and
 * `shutdown-complete` survive an immediate exit) and read line by line from
 * stdin. Non-JSON lines are ignored rather than rejecting the stream.
 *
 * `DSH_DESKTOP_STDIO_TRANSPORT=1` selects the stdio transport; otherwise the
 * Node IPC transport is used unchanged, so the Electron path is unaffected.
 */

import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

/** Control surface the Host entry uses to talk to its shell. */
export interface DesktopHostTransport {
  readonly connected: boolean
  send(message: object): Promise<void>
  onMessage(listener: (message: unknown) => void): void
  onDisconnect(listener: () => void): void
  disconnect(): void
}

function createIpcTransport(): DesktopHostTransport {
  const messageListeners = new Set<(message: unknown) => void>()
  const disconnectListeners = new Set<() => void>()
  process.on('message', (message: unknown) => {
    for (const listener of messageListeners) listener(message)
  })
  process.once('disconnect', () => {
    for (const listener of disconnectListeners) listener()
  })
  return {
    get connected(): boolean { return process.connected },
    send: (message: object): Promise<void> => new Promise((resolve, reject) => {
      if (!process.connected || process.send === undefined) { resolve(); return }
      process.send(message, (error: unknown) => { if (error === null) resolve(); else reject(error) })
    }),
    onMessage: (listener) => { messageListeners.add(listener) },
    onDisconnect: (listener) => { disconnectListeners.add(listener) },
    disconnect: () => { if (process.connected) process.disconnect() },
  }
}

function createStdioTransport(): DesktopHostTransport {
  const messageListeners = new Set<(message: unknown) => void>()
  const disconnectListeners = new Set<() => void>()
  let closed = false

  const close = (): void => {
    if (closed) return
    closed = true
    for (const listener of disconnectListeners) listener()
  }

  const reader = createInterface({ input: process.stdin, terminal: false })
  reader.on('line', (line: string) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    let parsed: unknown
    try { parsed = JSON.parse(trimmed) } catch { return }
    if (typeof parsed !== 'object' || parsed === null) return
    for (const listener of messageListeners) listener(parsed)
  })
  reader.on('close', close)
  process.stdin.on('end', close)
  process.stdin.on('error', close)

  return {
    get connected(): boolean { return !closed },
    send: (message: object): Promise<void> => new Promise((resolve) => {
      if (closed) { resolve(); return }
      try {
        writeSync(1, `${JSON.stringify(message)}\n`)
        resolve()
      } catch {
        close()
        resolve()
      }
    }),
    onMessage: (listener) => { messageListeners.add(listener) },
    onDisconnect: (listener) => { disconnectListeners.add(listener) },
    disconnect: close,
  }
}

/** Select the transport from the environment; the Electron IPC path is the default. */
export function createDesktopHostTransport(): DesktopHostTransport {
  return process.env.DSH_DESKTOP_STDIO_TRANSPORT === '1'
    ? createStdioTransport()
    : createIpcTransport()
}
