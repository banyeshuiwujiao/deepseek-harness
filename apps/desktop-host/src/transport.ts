/**
 * stdio JSON-lines transport for the Desktop Host.
 *
 * The Electron shell spawned the Host with a Node IPC channel and talked over
 * `process.send` / `process.on('message')`. The Tauri shell has no Node IPC
 * channel, so the Host instead speaks newline-delimited JSON on stdout
 * (outbound) and stdin (inbound). Message shapes and the wire protocol version
 * are unchanged, so the two shells stay wire-compatible.
 *
 * Frames are written with `fs.writeSync(1, ...)` rather than
 * `process.stdout.write`: the synchronous path guarantees a `ready`, `fatal` or
 * `shutdown-complete` frame is on the pipe before the Host exits, which the
 * async stdout buffer could otherwise truncate.
 */

import { writeSync } from 'node:fs'
import { createInterface, type Interface } from 'node:readline'

/** One decoded inbound frame; kept as an open record so the Host's own guards
 *  (`typeof message.requestId === 'number'`) keep narrowing as before. */
export type HostInboundMessage = Record<string, unknown>

/** Dispatches one decoded inbound frame. */
export type HostMessageHandler = (message: unknown) => void

export interface HostTransport {
  /** Whether outbound frames can still be delivered. */
  readonly connected: boolean
  /** Write one protocol frame. Never throws; a closed pipe is ignored. */
  send(message: object): void
  /** Register the inbound dispatcher. Only the first registration is used. */
  onMessage(handler: HostMessageHandler): void
  /** Register the handler invoked once when the shell closes stdin. */
  onDisconnect(handler: () => void): void
  /** Stop dispatching inbound frames and release the stdin reader. */
  disconnect(): void
}

export function createStdioTransport(): HostTransport {
  let connected = true
  let handler: HostMessageHandler | undefined
  let disconnectHandler: (() => void) | undefined
  let reader: Interface | undefined
  let closed = false

  const send = (message: object): void => {
    if (!connected) return
    try {
      writeSync(1, `${JSON.stringify(message)}\n`)
    } catch {
      // The shell closed stdout; protocol delivery is over but the Host may
      // still finish graceful teardown.
    }
  }

  const onMessage = (messageHandler: HostMessageHandler): void => {
    if (handler !== undefined) return
    handler = messageHandler
    reader = createInterface({ input: process.stdin, terminal: false })
    reader.on('line', (line) => {
      if (line.trim() === '') return
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        // A non-JSON line is not a protocol frame; ignore it rather than
        // rejecting the whole stream.
        return
      }
      if (typeof message !== 'object' || message === null || Array.isArray(message)) return
      handler?.(message as HostInboundMessage)
    })
    reader.on('close', () => {
      if (closed) return
      closed = true
      connected = false
      reader = undefined
      disconnectHandler?.()
    })
  }

  const onDisconnect = (disconnect: () => void): void => {
    if (disconnectHandler !== undefined) return
    disconnectHandler = disconnect
    // stdin may already be closed before the handler registers.
    if (closed) disconnect()
  }

  const disconnect = (): void => {
    connected = false
    reader?.close()
    reader = undefined
  }

  return {
    get connected(): boolean { return connected },
    send,
    onMessage,
    onDisconnect,
    disconnect,
  }
}
