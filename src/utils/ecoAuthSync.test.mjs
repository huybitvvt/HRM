import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLocalFallbackHrmProfile,
  decodeEcoSsoPayload,
  mapEcoRoleMaskToHrm,
  syncEcoUserToHrmProfile
} from './ecoAuthSync.js'

test('mapEcoRoleMaskToHrm maps MANAGER (32) and DIRECTOR (64) to admin', () => {
  assert.deepEqual(mapEcoRoleMaskToHrm(32, 'codtest'), {
    role: 'admin',
    position: 'Quản lý bưu cục',
    department: 'Quản lý bưu cục'
  })
  assert.deepEqual(mapEcoRoleMaskToHrm(64, 'director'), {
    role: 'admin',
    position: 'Ban giám đốc',
    department: 'Ban giám đốc'
  })
  assert.deepEqual(mapEcoRoleMaskToHrm(4, 'driver01'), {
    role: 'user',
    position: 'Tài xế chặng cuối',
    department: 'Giao nhận'
  })
})

test('decodeEcoSsoPayload decodes UTF-8 base64url ECO user payload', () => {
  const ecoUser = {
    id: '42',
    username: 'ecotest',
    full_name: 'ECO Payment COD Test',
    role_mask: 32
  }
  const token = Buffer.from(JSON.stringify(ecoUser), 'utf8').toString('base64url')
  const decoded = decodeEcoSsoPayload(token)
  assert.equal(decoded.id, '42')
  assert.equal(decoded.full_name, 'ECO Payment COD Test')
  assert.equal(decoded.role_mask, 32)
})

test('buildLocalFallbackHrmProfile creates valid HRM profile from ECO user', () => {
  const profile = buildLocalFallbackHrmProfile({
    id: '99',
    username: 'ecopaymentcodtest',
    full_name: 'ECO Payment COD Test',
    email: 'codtest@eco.vn',
    role_mask: 32,
    hubs: [{ id: 1, code: 'HAN', name: 'Bưu cục Hà Nội' }]
  })
  assert.equal(profile.role, 'admin')
  assert.equal(profile.ho_va_ten, 'ECO Payment COD Test')
  assert.equal(profile.vi_tri, 'Quản lý bưu cục')
  assert.equal(profile.chi_nhanh, 'Bưu cục Hà Nội')
  assert.equal(profile.ecoUserId, '99')
})

test('syncEcoUserToHrmProfile returns fallback profile when supabaseClient is null', async () => {
  const profile = await syncEcoUserToHrmProfile(
    {
      id: '7',
      username: 'shipper01',
      full_name: 'Tài xế ECO',
      role_mask: 4
    },
    null
  )
  assert.equal(profile.role, 'user')
  assert.equal(profile.ho_va_ten, 'Tài xế ECO')
  assert.equal(profile.ecoUserId, '7')
})
