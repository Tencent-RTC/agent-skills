import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEndpoint, SUPPORTED_REGIONS, CHINA_SITE_ENDPOINT, INTL_SITE_ENDPOINT } from './endpoint.js'

test('ap-guangzhou resolves to the China site', () => {
  assert.equal(resolveEndpoint('ap-guangzhou'), CHINA_SITE_ENDPOINT)
})

test('the four international regions resolve to the international site', () => {
  for (const region of ['ap-singapore', 'ap-tokyo', 'na-ashburn', 'na-siliconvalley']) {
    assert.equal(resolveEndpoint(region), INTL_SITE_ENDPOINT, region)
  }
})

test('every supported region resolves to one of the two known hosts', () => {
  for (const region of SUPPORTED_REGIONS) {
    const endpoint = resolveEndpoint(region)
    assert.ok(
      endpoint === CHINA_SITE_ENDPOINT || endpoint === INTL_SITE_ENDPOINT,
      `${region} → ${endpoint}`
    )
  }
})

test('an explicit override wins over the derived endpoint', () => {
  assert.equal(
    resolveEndpoint('ap-guangzhou', 'trtc.example.internal'),
    'trtc.example.internal'
  )
})

test('a blank or whitespace-only override is ignored', () => {
  assert.equal(resolveEndpoint('ap-guangzhou', ''), CHINA_SITE_ENDPOINT)
  assert.equal(resolveEndpoint('ap-tokyo', '   '), INTL_SITE_ENDPOINT)
})

test('an override is trimmed', () => {
  assert.equal(resolveEndpoint('ap-tokyo', '  host.example  '), 'host.example')
})
