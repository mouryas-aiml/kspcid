/**
 * Starts A0b as a detached, resumable background compiler.
 *
 * Intentionally does not use shell redirection or an interactive Catalyst
 * command. The child owns its log file and remains alive after this launcher
 * exits.
 */
import { open } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const logDir = resolve(appRoot, 'logs')
const logPath = resolve(logDir, 'a0b-full-routing.log')
const pidPath = resolve(logDir, 'a0b-full-routing.pid')

await mkdir(logDir, { recursive: true })
const log = await open(logPath, 'a')
const child = spawn(
  process.execPath,
  ['--import', 'tsx', resolve(appRoot, 'etl/08_full_routing.ts')],
  {
    cwd: appRoot,
    detached: true,
    env: process.env,
    stdio: ['ignore', log.fd, log.fd],
  },
)
child.unref()
await (await import('node:fs/promises')).writeFile(pidPath, `${child.pid}\n`, 'utf8')
await log.close()

process.stdout.write(
  `A0b full routing started detached · pid ${child.pid} · ${logPath}\n`,
)
