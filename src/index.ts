/**
 * dsh-auditor-plugin — read-only static security audit for DSH plugins.
 *
 * The audited package is never imported, required, spawned, or evaluated.
 * This module only reads `package.json` and source text, resolves package
 * paths, and parses dependency ranges.
 *
 * @module dsh-auditor-plugin
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import semver from 'semver'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-auditor-plugin'
export const inject: string[] = ['tools']

type Verdict = 'safe' | 'caution' | 'risky'
type Severity = 'low' | 'medium' | 'high' | 'critical'
type WeightedKind =
  | 'install_script'
  | 'child_process'
  | 'fs_access'
  | 'network_access'
  | 'npm_vuln'

interface Finding {
  rule: string
  severity: Severity
  evidence: string
}

interface AuditResult {
  score: number
  verdict: Verdict
  findings: Finding[]
}

interface UnsafeDependency {
  readonly name: string
  readonly versions: readonly string[] | '*'
  readonly severity: Severity
  readonly reason: string
}

const TOOL_NAME = 'audit_plugin'
const MAX_FILES = 200
const MAX_FILE_BYTES = 1_000_000
const MAX_FINDINGS = 50

/**
 * Reproducible safety-score weights. Each category is deducted at most once
 * when the scanner passes deduplicated findings to computeScore().
 */
const FINDING_WEIGHTS: Record<WeightedKind, number> = {
  install_script: 40,
  child_process: 25,
  fs_access: 15,
  network_access: 10,
  npm_vuln: 10,
}

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'] as const

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
])

const SOURCE_ROOTS = ['src', 'lib', 'dist', 'client', 'build', 'scripts'] as const

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'coverage',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  'examples',
  'docs',
  'vendor',
  'third_party',
])

const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

/**
 * Curated, version-specific list. It is a fast first pass, not a substitute
 * for `npm audit`; unknown packages are not considered safe.
 */
const KNOWN_UNSAFE_DEPENDENCIES: readonly UnsafeDependency[] = [
  {
    name: 'event-stream',
    versions: ['3.3.6'],
    severity: 'critical',
    reason: 'compromised release that shipped the flatmap-stream backdoor',
  },
  {
    name: 'flatmap-stream',
    versions: '*',
    severity: 'critical',
    reason: 'malicious payload published during the event-stream compromise',
  },
  {
    name: 'ua-parser-js',
    versions: ['0.7.29', '0.8.0', '1.0.0'],
    severity: 'critical',
    reason: 'compromised releases (2021)',
  },
  {
    name: 'coa',
    versions: ['2.0.3', '2.0.4', '2.0.5', '2.0.6'],
    severity: 'critical',
    reason: 'compromised releases (2021)',
  },
  {
    name: 'node-ipc',
    versions: ['10.1.1', '10.1.2', '10.1.3', '11.0.0'],
    severity: 'high',
    reason: 'protestware releases (2022)',
  },
  {
    name: 'colors',
    versions: ['1.4.1'],
    severity: 'medium',
    reason: 'protestware release (2022)',
  },
  {
    name: 'faker',
    versions: ['6.6.6'],
    severity: 'medium',
    reason: 'protestware release (2022)',
  },
  {
    name: 'peacenotwar',
    versions: '*',
    severity: 'high',
    reason: 'protestware package',
  },
  {
    name: 'crossenv',
    versions: '*',
    severity: 'critical',
    reason: 'typosquat of cross-env',
  },
  {
    name: 'eslint-scope',
    versions: ['3.7.2'],
    severity: 'high',
    reason: 'compromised release (2018)',
  },
  {
    name: 'getcookies',
    versions: '*',
    severity: 'high',
    reason: 'malicious package (2018)',
  },
]

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const CHILD_PROCESS_RE =
  /(?:from\s*['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|import\s*\(\s*['"](?:node:)?child_process['"]\s*\))/

const FS_IMPORT_RE =
  /(?:from\s*['"](?:node:)?fs(?:\/promises)?['"]|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/

const EVAL_RE = /(?<![\w.$])eval\s*\(/
const NEW_FUNCTION_RE = /new\s+Function\s*\(/

const NETWORK_RE =
  /\b(?:fetch|axios(?:\.\w+)?)\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.connect\s*\(|new\s+WebSocket\s*\(|navigator\.sendBeacon\s*\(/

const INSTALL_SUSPICIOUS_RE =
  /(?:\b(?:curl|wget|Invoke-WebRequest|iwr)\b[\s\S]{0,180}\|\s*(?:sudo\s+)?(?:ba)?sh\b|\bInvoke-Expression\b|\biex\s*\(|\beval\s*\(|\bbase64\s+(?:-d|--decode)\b|--unsafe-perm\b|\b(?:child_process|execSync|spawnSync|writeFileSync|rmSync|unlinkSync)\b)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

function clip(value: string, max = 300): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`
}

function finding(
  rule: string,
  severity: Severity,
  evidence: string,
): Finding {
  return { rule, severity, evidence: clip(evidence) }
}

function failed(rule: string, evidence: string): AuditResult {
  return {
    score: 0,
    verdict: 'risky',
    findings: [{ rule, severity: 'critical', evidence: clip(evidence) }],
  }
}

async function isFileWithinLimit(file: string): Promise<boolean> {
  try {
    const info = await stat(file)
    return info.isFile() && info.size <= MAX_FILE_BYTES
  } catch {
    return false
  }
}

async function isPluginRoot(root: string): Promise<boolean> {
  try {
    const info = await stat(path.join(root, 'package.json'))
    return info.isFile()
  } catch {
    return false
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    const info = await stat(dir)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function walk(
  dir: string,
  out: Set<string>,
  signal: AbortSignal,
): Promise<void> {
  if (out.size >= MAX_FILES) return
  signal.throwIfAborted()

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (signal.aborted) throw error
    return
  }

  for (const entry of entries) {
    if (out.size >= MAX_FILES) return
    if (entry.isSymbolicLink()) continue

    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, out, signal)
      continue
    }

    if (!entry.isFile()) continue
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    if (await isFileWithinLimit(full)) out.add(full)
  }
}

/**
 * Collect runtime source files without following symlinks or entering
 * installed dependencies, tests, docs, and vendored code.
 */
async function collectSourceFiles(
  root: string,
  signal: AbortSignal,
): Promise<string[]> {
  const files = new Set<string>()

  for (const dir of SOURCE_ROOTS) {
    const full = path.join(root, dir)
    if (await isDirectory(full)) await walk(full, files, signal)
  }

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const full = path.join(root, entry.name)
      if (await isFileWithinLimit(full)) files.add(full)
    }
  } catch (error) {
    if (signal.aborted) throw error
  }

  if (files.size === 0) await walk(root, files, signal)
  return [...files].slice(0, MAX_FILES)
}

/**
 * Resolve a package name or absolute directory. `createRequire().resolve()`
 * only resolves a path; it never loads the target module.
 */
async function resolveTarget(
  target: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted()

  if (path.isAbsolute(target)) {
    const root = path.resolve(target)
    return (await isPluginRoot(root)) ? root : undefined
  }

  if (!PACKAGE_NAME_RE.test(target)) return undefined

  const candidates: string[] = []

  try {
    const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'))
    candidates.push(path.dirname(requireFromCwd.resolve(`${target}/package.json`)))
  } catch {
    // Packages may not export ./package.json; fall through to directory probes.
  }

  candidates.push(path.join(process.cwd(), 'node_modules', target))

  const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  try {
    const profiles = await readdir(path.join(dshHome, 'profiles'), {
      withFileTypes: true,
    })
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue
      candidates.push(
        path.join(dshHome, 'profiles', profile.name, 'node_modules', target),
      )
    }
  } catch (error) {
    if (signal.aborted) throw error
  }

  for (const candidate of candidates) {
    signal.throwIfAborted()
    const root = path.resolve(candidate)
    if (await isPluginRoot(root)) return root
  }

  return undefined
}

async function readPackage(
  root: string,
  signal: AbortSignal,
): Promise<{ pkg: Record<string, unknown> } | { error: string }> {
  try {
    const raw = await readFile(path.join(root, 'package.json'), {
      encoding: 'utf8',
      signal,
    })
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!isRecord(parsed)) {
      return { error: 'package.json root is not an object' }
    }
    return { pkg: parsed }
  } catch (error) {
    if (signal.aborted) throw error
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function scanManifest(pkg: Record<string, unknown>): Finding[] {
  const dsh = isRecord(pkg.dsh) ? pkg.dsh : undefined
  const bundle = dsh && isRecord(dsh.bundle) ? dsh.bundle : undefined
  if (!bundle || typeof bundle.patch !== 'string' || bundle.patch.trim() === '') {
    return [
      finding(
        'manifest:dsh-bundle',
        'low',
        'package.json has no dsh.bundle.patch; the package may not be installable as a DSH bundle.',
      ),
    ]
  }
  return []
}

function scanInstallScripts(pkg: Record<string, unknown>): Finding[] {
  const scripts = asStringRecord(pkg.scripts)
  const findings: Finding[] = []

  for (const hook of INSTALL_HOOKS) {
    const script = scripts[hook]
    if (typeof script !== 'string' || script.trim() === '') continue

    const suspicious = INSTALL_SUSPICIOUS_RE.test(script)
    findings.push(
      finding(
        `install-script:${hook}`,
        suspicious ? 'high' : 'medium',
        `package.json: scripts.${hook} = ${script}`,
      ),
    )
  }

  return findings
}

function matchesUnsafeVersion(
  spec: string,
  versions: readonly string[] | '*',
): boolean {
  if (versions === '*') return true

  const raw = spec.trim()
  if (raw === '') return false

  for (const badVersion of versions) {
    if (raw === badVersion) return true

    const range = semver.validRange(raw, { loose: true })
    if (
      range &&
      semver.satisfies(badVersion, range, {
        loose: true,
        includePrerelease: true,
      })
    ) {
      return true
    }

    if (raw.includes(badVersion)) return true
  }

  return false
}

function isUnpinned(spec: string): boolean {
  const raw = spec.trim()
  return (
    raw === '' ||
    raw === '*' ||
    raw.toLowerCase() === 'latest' ||
    raw.startsWith('>=') ||
    raw.startsWith('>') ||
    /(?:^|[.\d])(?:x|X|\*)$/.test(raw)
  )
}

function isRemoteSpec(spec: string): boolean {
  return /^(?:https?:|git\+|git:\/\/|github:)/i.test(spec.trim())
}

function scanDependencies(pkg: Record<string, unknown>): Finding[] {
  const dependencies = {
    ...asStringRecord(pkg.dependencies),
    ...asStringRecord(pkg.optionalDependencies),
  }
  const findings: Finding[] = []

  for (const [depName, spec] of Object.entries(dependencies)) {
    const known = KNOWN_UNSAFE_DEPENDENCIES.find(
      (item) => item.name === depName,
    )
    if (known && matchesUnsafeVersion(spec, known.versions)) {
      findings.push(
        finding(
          `npm-vuln:${depName}`,
          known.severity,
          `${depName}@${spec} — ${known.reason}`,
        ),
      )
      continue
    }

    if (isRemoteSpec(spec)) {
      findings.push(
        finding(
          `remote-dependency:${depName}`,
          'medium',
          `${depName}@${spec} is installed from a remote source, not a pinned registry version.`,
        ),
      )
      continue
    }

    if (isUnpinned(spec)) {
      findings.push(
        finding(
          `unpinned-dependency:${depName}`,
          'low',
          `${depName}@${spec} uses an unbounded version range.`,
        ),
      )
    }
  }

  return findings
}

async function scanSource(
  root: string,
  signal: AbortSignal,
): Promise<Finding[]> {
  const files = await collectSourceFiles(root, signal)
  const findings: Finding[] = []

  for (const file of files) {
    signal.throwIfAborted()

    let text: string
    try {
      text = await readFile(file, { encoding: 'utf8', signal })
    } catch (error) {
      if (signal.aborted) throw error
      continue
    }

    const relative = path.relative(root, file) || path.basename(file)
    let childProcessFound = false
    let fsFound = false
    let networkFound = false
    let dynamicEvalFound = false

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line === undefined) continue
      const trimmed = line.trim()
      if (
        trimmed === '' ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      ) {
        continue
      }

      if (!childProcessFound && CHILD_PROCESS_RE.test(line)) {
        childProcessFound = true
        findings.push(
          finding(
            'child-process',
            'medium',
            `${relative}:${index + 1}: ${line.trim()}`,
          ),
        )
      }

      if (!fsFound && FS_IMPORT_RE.test(line)) {
        fsFound = true
        findings.push(
          finding(
            'fs-access',
            'low',
            `${relative}:${index + 1}: ${line.trim()}`,
          ),
        )
      }

      if (!networkFound && NETWORK_RE.test(line)) {
        networkFound = true
        findings.push(
          finding(
            'network-access',
            'medium',
            `${relative}:${index + 1}: ${line.trim()}`,
          ),
        )
      }

      if (!dynamicEvalFound && (EVAL_RE.test(line) || NEW_FUNCTION_RE.test(line))) {
        dynamicEvalFound = true
        findings.push(
          finding(
            'eval',
            'high',
            `${relative}:${index + 1}: ${line.trim()}`,
          ),
        )
      }
    }
  }

  return findings
}

function findingKind(rule: string): WeightedKind | undefined {
  const normalized = rule.toLowerCase().replace(/_/g, '-')
  if (normalized.startsWith('install-script')) return 'install_script'
  if (normalized === 'child-process' || normalized === 'eval') {
    return 'child_process'
  }
  if (normalized === 'fs-access') return 'fs_access'
  if (normalized === 'network-access') return 'network_access'
  if (
    normalized.startsWith('npm-vuln')
    || normalized.startsWith('unsafe-dependency')
    || normalized.startsWith('remote-dependency')
    || normalized.startsWith('unpinned-dependency')
  ) {
    return 'npm_vuln'
  }
  return undefined
}

/**
 * Reproducible safety score: 100 minus the weight of every finding.
 * A clean plugin scores 100; a plugin with all five risk categories scores 0.
 */
export function computeScore(findings: readonly Finding[]): number {
  let penalty = 0
  for (const item of findings) {
    const kind = findingKind(item.rule)
    if (kind !== undefined) penalty += FINDING_WEIGHTS[kind]
  }
  return Math.max(0, 100 - penalty)
}

function verdictFromScore(score: number): Verdict {
  if (score >= 80) return 'safe'
  if (score >= 40) return 'caution'
  return 'risky'
}

/**
 * One finding per weighted category keeps the score reproducible even when a
 * large plugin imports fs in fifty files or declares two install hooks.
 * Unweighted findings (for example a missing dsh.bundle.patch) stay separate.
 */
function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const grouped = new Map<string, Finding>()
  const unweighted: Finding[] = []

  for (const item of findings) {
    const kind = findingKind(item.rule)
    if (kind === undefined) {
      unweighted.push(item)
      continue
    }

    const existing = grouped.get(kind)
    if (existing === undefined) {
      grouped.set(kind, item)
      continue
    }

    const itemIsStronger =
      SEVERITY_RANK[item.severity] < SEVERITY_RANK[existing.severity]
    grouped.set(kind, {
      rule: itemIsStronger ? item.rule : existing.rule,
      severity: itemIsStronger ? item.severity : existing.severity,
      evidence: clip(`${existing.evidence}; ${item.evidence}`),
    })
  }

  return [...grouped.values(), ...unweighted]
}

function publicFindings(findings: readonly Finding[]): Finding[] {
  return [...findings]
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
    )
    .slice(0, MAX_FINDINGS)
    .map(({ rule, severity, evidence }) => ({ rule, severity, evidence }))
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        'Read-only security audit of a DSH plugin before installing or enabling it. '
        + 'Reads package.json and source files, checks install/postinstall scripts, '
        + 'curated dependency risks, and imports of child_process, eval, fs, and network. '
        + 'Never imports, executes, or installs the audited package.',
      parameters: {
        target: {
          type: 'string',
          required: true,
          description:
            'Installed package name (for example "dsh-ego-browser") or an absolute path to the plugin root.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            score: {
              type: 'number',
              required: true,
              description: 'Safety score from 100 (clean) to 0 (all weighted risks).',
            },
            verdict: {
              type: 'string',
              required: true,
              enum: ['safe', 'caution', 'risky'],
            },
            findings: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  rule: { type: 'string', required: true },
                  severity: {
                    type: 'string',
                    required: true,
                    enum: ['low', 'medium', 'high', 'critical'],
                  },
                  evidence: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: JSON.stringify(value, null, 2) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const target = args.target.trim()
        if (target === '') {
          return failed(
            'target-empty',
            'target must be a package name or an absolute plugin directory.',
          )
        }

        exec.signal.throwIfAborted()

        const root = await resolveTarget(target, exec.signal)
        if (root === undefined) {
          return failed(
            'target-not-found',
            `Could not resolve plugin target "${target}".`,
          )
        }

        const packageResult = await readPackage(root, exec.signal)
        if ('error' in packageResult) {
          return failed(
            'package-json-invalid',
            `${target}: ${packageResult.error}`,
          )
        }

        const pkg = packageResult.pkg
        const findings = dedupeFindings([
          ...scanManifest(pkg),
          ...scanInstallScripts(pkg),
          ...scanDependencies(pkg),
          ...(await scanSource(root, exec.signal)),
        ])

        const score = computeScore(findings)
        return {
          score,
          verdict: verdictFromScore(score),
          findings: publicFindings(findings),
        }
      },
    }),
  )
}
