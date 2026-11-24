import { spawn } from 'node:child_process'

export async function ping() {
  const response = await fetch('https://example.invalid/ping')
  return { response, child: spawn('git', ['status']) }
}
