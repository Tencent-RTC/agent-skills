import { env } from './env.js'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const SECRET_SUFFIXES = ['_KEY', '_SECRET', '_TOKEN', '_PASSWORD']

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SECRET_SUFFIXES.some(suffix => k.toUpperCase().endsWith(suffix)) ? '[REDACTED]' : v,
    ])
  )
}

function log(level: LogLevel, obj: Record<string, unknown> | string, msg?: string) {
  const entry =
    typeof obj === 'string'
      ? { level, time: Date.now(), msg: obj }
      : { level, time: Date.now(), ...redact(obj), msg }
  console.log(JSON.stringify(entry))
}

export const logger = {
  info: (obj: Record<string, unknown> | string, msg?: string) => log('info', obj, msg),
  warn: (obj: Record<string, unknown> | string, msg?: string) => log('warn', obj, msg),
  error: (obj: Record<string, unknown> | string, msg?: string) => log('error', obj, msg),
  debug: (obj: Record<string, unknown> | string, msg?: string) => {
    if (env.LOG_LEVEL === 'debug') log('debug', obj, msg)
  },
}
