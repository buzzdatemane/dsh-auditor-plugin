import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function run(code) {
  return eval(code)
}

export { execSync, readFileSync }
