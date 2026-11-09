import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateWifiAttendance,
  isPublicIp,
  matchWifiLocation,
  matchesNetworkEntry,
  normalizeIp,
  normalizeNetworkEntry,
  normalizeWifiAttendanceSettings,
  parseAllowedIpsInput
} from './attendanceWifi.js'

test('normalizeIp handles IPv4, IPv4-mapped IPv6, and canonical IPv6', () => {
  assert.equal(normalizeIp(' 203.113.148.25 '), '203.113.148.25')
  assert.equal(normalizeIp('::ffff:203.113.148.25'), '203.113.148.25')
  assert.equal(normalizeIp('2001:0ee0:4f80:0000:0000:0000:0000:0001'), '2001:ee0:4f80::1')
  assert.equal(normalizeIp('fe80::1%eth0'), null)
  assert.equal(normalizeIp('999.1.1.1'), null)
})

test('isPublicIp rejects loopback, private LAN, CGNAT, and documentation ranges', () => {
  assert.equal(isPublicIp('127.0.0.1'), false)
  assert.equal(isPublicIp('192.168.1.10'), false)
  assert.equal(isPublicIp('10.0.0.5'), false)
  assert.equal(isPublicIp('172.20.0.1'), false)
  assert.equal(isPublicIp('100.64.10.1'), false)
  assert.equal(isPublicIp('::1'), false)
  assert.equal(isPublicIp('fe80::1'), false)
  assert.equal(isPublicIp('2001:db8::1'), false)
  assert.equal(isPublicIp('118.70.128.45'), true)
  assert.equal(isPublicIp('2402:800:61c3:abcd::10'), true)
})

test('normalizeNetworkEntry and matchesNetworkEntry support exact public IPs and CIDR prefixes', () => {
  assert.equal(normalizeNetworkEntry('118.70.128.45'), '118.70.128.45')
  assert.equal(normalizeNetworkEntry('2402:800:61c3:abcd::/64'), '2402:800:61c3:abcd::/64')
  assert.equal(normalizeNetworkEntry('192.168.1.1'), null)
  assert.equal(normalizeNetworkEntry('2402:800::/32'), null)

  assert.equal(matchesNetworkEntry('118.70.128.45', '118.70.128.45'), true)
  assert.equal(matchesNetworkEntry('118.70.128.46', '118.70.128.45'), false)
  assert.equal(matchesNetworkEntry('2402:800:61c3:abcd:1234:5678:9abc:def0', '2402:800:61c3:abcd::/64'), true)
  assert.equal(matchesNetworkEntry('2402:800:61c3:abce::1', '2402:800:61c3:abcd::/64'), false)
})

test('parseAllowedIpsInput deduplicates valid entries and reports invalid ones', () => {
  const parsed = parseAllowedIpsInput('118.70.128.45\n192.168.1.1, 118.70.128.45\n2402:800:61c3:abcd::/64')
  assert.deepEqual(parsed.validEntries, ['118.70.128.45', '2402:800:61c3:abcd::/64'])
  assert.deepEqual(parsed.invalidEntries, ['192.168.1.1'])
})

test('evaluateWifiAttendance enforces Wi-Fi requirement when enabled and matches office Wi-Fi', () => {
  const wifiSettings = normalizeWifiAttendanceSettings({
    enabled: true,
    requireWifi: true,
    locations: [
      {
        id: 'wifi_han',
        name: 'Văn phòng Hà Nội (HAN)',
        ssid: 'ECO_HAN_5G',
        address: 'Bưu cục Hà Nội',
        allowedIps: ['118.70.128.45', '2402:800:61c3:abcd::/64'],
        isActive: true
      }
    ]
  })

  const matched = evaluateWifiAttendance({ ip: '118.70.128.45' }, wifiSettings)
  assert.equal(matched.allowed, true)
  assert.equal(matched.mode, 'wifi')
  assert.equal(matched.matchedLocation?.name, 'Văn phòng Hà Nội (HAN)')

  const blocked = evaluateWifiAttendance({ ip: '14.162.10.20' }, wifiSettings)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.mode, 'wifi_blocked')
  assert.equal(matchWifiLocation('14.162.10.20', wifiSettings), null)
})

