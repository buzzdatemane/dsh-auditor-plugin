import test from 'node:test'
import assert from 'node:assert/strict'
import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { apply, computeScore } from '../src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => path.join(here, 'fixtures', name)

function createHarness() {
  const definitions = new Map()
  const ctx = {
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
  }
  return { ctx, definitions }
}

function audit(definitions, target) {
  const definition = definitions.get('audit_plugin')
  assert.ok(definition, 'audit_plugin should be registered')
  return definition
    .execute({ target }, { signal: new AbortController().signal })
    .then((result) => {
      const violations = validateJsonSchemaValue(
        definition.output.schema,
        result,
      )
      assert.deepEqual(violations, [])
      return result
    })
}

function assertValidResult(result) {
  assert.equal(typeof result.score, 'number')
  assert.ok(Number.isInteger(result.score))
  assert.ok(result.score >= 0 && result.score <= 100)
  assert.ok(['safe', 'caution', 'risky'].includes(result.verdict))
  assert.ok(Array.isArray(result.findings))

  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), [
      'evidence',
      'rule',
      'severity',
    ])
    assert.equal(typeof finding.rule, 'string')
    assert.equal(typeof finding.evidence, 'string')
    assert.ok(
      ['low', 'medium', 'high', 'critical'].includes(finding.severity),
    )
  }

  const roundTrip = JSON.parse(JSON.stringify(result))
  assert.equal(roundTrip.score, result.score)
  assert.equal(roundTrip.verdict, result.verdict)
  assert.equal(roundTrip.findings.length, result.findings.length)
}

const sampleFinding = (rule, severity = 'medium') => ({
  rule,
  severity,
  evidence: 'unit-test fixture',
})

test('clean plugin scores 100 and is safe', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  assert.ok(definitions.has('audit_plugin'))

  const result = await audit(definitions, fixture('clean'))
  assertValidResult(result)
  assert.equal(result.score, 100)
  assert.equal(result.verdict, 'safe')
  assert.deepEqual(result.findings, [])

  const definition = definitions.get('audit_plugin')
  assert.equal(definition.name, 'audit_plugin')
  const rendered = definition.output.render(
    { target: fixture('clean') },
    result,
  )
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.deepEqual(JSON.parse(rendered[0].text), result)
})

test('install script costs 40 points and yields caution', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const result = await audit(definitions, fixture('install-hook'))
  assertValidResult(result)
  assert.equal(result.score, 60)
  assert.equal(result.verdict, 'caution')
  assert.ok(
    result.findings.some(
      (finding) => finding.rule === 'install-script:postinstall',
    ),
  )
})

test('child_process plus network costs 35 points and yields caution', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const result = await audit(definitions, fixture('child-network'))
  assertValidResult(result)
  assert.equal(result.score, 65)
  assert.equal(result.verdict, 'caution')

  const rules = new Set(result.findings.map((finding) => finding.rule))
  assert.ok(rules.has('child-process'))
  assert.ok(rules.has('network-access'))
})

test('computeScore applies the published weights', () => {
  assert.equal(computeScore([]), 100)
  assert.equal(computeScore([sampleFinding('install_script')]), 60)
  assert.equal(
    computeScore([
      sampleFinding('child_process'),
      sampleFinding('network_access'),
    ]),
    65,
  )
  assert.equal(
    computeScore([
      sampleFinding('install_script'),
      sampleFinding('child_process'),
      sampleFinding('fs_access'),
      sampleFinding('network_access'),
      sampleFinding('npm_vuln'),
    ]),
    0,
  )
})

test('risky fixture combines categories and scores 10', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const result = await audit(definitions, fixture('risky'))
  assertValidResult(result)
  assert.equal(result.score, 10)
  assert.equal(result.verdict, 'risky')

  const rules = new Set(result.findings.map((finding) => finding.rule))
  assert.ok(rules.has('install-script:postinstall'))
  assert.ok(rules.has('npm-vuln:event-stream'))
  assert.ok(rules.has('eval'))
  assert.ok(rules.has('fs-access'))
})

test('never executes the audited install script', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const root = fixture('install-hook')
  const marker = path.join(root, 'EXECUTED')
  await rm(marker, { force: true })

  const result = await audit(definitions, root)
  assertValidResult(result)
  assert.ok(
    result.findings.some(
      (finding) => finding.rule === 'install-script:postinstall',
    ),
  )

  await assert.rejects(access(marker), { code: 'ENOENT' })
  await assert.rejects(access(path.join(process.cwd(), 'EXECUTED')), {
    code: 'ENOENT',
  })
})

test('fails closed for an unknown target', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const result = await audit(definitions, 'dsh-plugin-that-does-not-exist-xyz')
  assertValidResult(result)
  assert.equal(result.verdict, 'risky')
  assert.equal(result.score, 0)
  assert.equal(result.findings[0].rule, 'target-not-found')
})

test('fails closed for an empty target', async () => {
  const { ctx, definitions } = createHarness()
  apply(ctx)

  const result = await audit(definitions, '   ')
  assertValidResult(result)
  assert.equal(result.verdict, 'risky')
  assert.equal(result.score, 0)
  assert.equal(result.findings[0].rule, 'target-empty')
})
