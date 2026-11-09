const MAX_ALLOWED_IPS_PER_LOCATION = 20

const parseIpv4Octets = (raw) => {
  const text = String(raw || '').trim()
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null
  const parts = text.split('.').map(Number)
  if (parts.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return parts
}

const ipv4ToInt = (octets) =>
  (((octets[0] << 24) >>> 0) | ((octets[1] << 16) >>> 0) | ((octets[2] << 8) >>> 0) | (octets[3] >>> 0)) >>> 0

const parseIpv6Hextets = (raw) => {
  const text = String(raw || '').trim().toLowerCase()
  if (!text || text.includes('%')) return null

  // Handle IPv4-mapped IPv6 like ::ffff:192.0.2.128
  const lastColon = text.lastIndexOf(':')
  if (lastColon !== -1 && text.slice(lastColon + 1).includes('.')) {
    const v4Octets = parseIpv4Octets(text.slice(lastColon + 1))
    if (!v4Octets) return null
    const highHex = ((v4Octets[0] << 8) | v4Octets[1]).toString(16)
    const lowHex = ((v4Octets[2] << 8) | v4Octets[3]).toString(16)
    return parseIpv6Hextets(`${text.slice(0, lastColon)}:${highHex}:${lowHex}`)
  }

  const doubleColonParts = text.split('::')
  if (doubleColonParts.length > 2) return null

  const parseSide = (segment) => {
    if (!segment) return []
    const items = segment.split(':')
    for (const item of items) {
      if (!/^[\da-f]{1,4}$/.test(item)) return null
    }
    return items.map((item) => parseInt(item, 16))
  }

  if (doubleColonParts.length === 1) {
    const groups = parseSide(doubleColonParts[0])
    return groups && groups.length === 8 ? groups : null
  }

  const left = parseSide(doubleColonParts[0])
  const right = parseSide(doubleColonParts[1])
  if (!left || !right || left.length + right.length >= 8) return null
  const missing = 8 - (left.length + right.length)
  return [...left, ...Array(missing).fill(0), ...right]
}

const formatIpv6Canonical = (hextets) => {
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0

  for (let i = 0; i < 8; i += 1) {
    if (hextets[i] === 0) {
      if (curStart === -1) {
        curStart = i
        curLen = 1
      } else {
        curLen += 1
      }
      if (curLen > bestLen && curLen >= 2) {
        bestStart = curStart
        bestLen = curLen
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }

  if (bestStart === -1) {
    return hextets.map((h) => h.toString(16)).join(':')
  }

  const left = hextets.slice(0, bestStart).map((h) => h.toString(16)).join(':')
  const right = hextets.slice(bestStart + bestLen).map((h) => h.toString(16)).join(':')
  if (!left && !right) return '::'
  if (!left) return `::${right}`
  if (!right) return `${left}::`
  return `${left}::${right}`
}

export const normalizeIp = (value) => {
  const raw = String(value || '').trim()
  if (!raw || raw.includes('%')) return null
  const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw

  const v4 = parseIpv4Octets(unwrapped)
  if (v4) return v4.join('.')

  const v6 = parseIpv6Hextets(unwrapped)
  if (!v6) return null

  // Convert IPv4-mapped IPv6 ::ffff:a.b.c.d -> IPv4 a.b.c.d
  const isV4Mapped =
    v6[0] === 0 &&
    v6[1] === 0 &&
    v6[2] === 0 &&
    v6[3] === 0 &&
    v6[4] === 0 &&
    v6[5] === 0xffff
  if (isV4Mapped) {
    return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join('.')
  }

  return formatIpv6Canonical(v6)
}

const NON_PUBLIC_IPV4_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
].map(([ip, prefix]) => {
  const intVal = ipv4ToInt(parseIpv4Octets(ip))
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { network: (intVal & mask) >>> 0, mask }
})

export const isPublicIp = (value) => {
  const ip = normalizeIp(value)
  if (!ip) return false

  const v4 = parseIpv4Octets(ip)
  if (v4) {
    const intVal = ipv4ToInt(v4)
    return !NON_PUBLIC_IPV4_CIDRS.some(({ network, mask }) => ((intVal & mask) >>> 0) === network)
  }

  const v6 = parseIpv6Hextets(ip)
  if (!v6) return false
  // Global unicast 2000::/3 -> first hextet 0x2000..0x3fff
  if ((v6[0] & 0xe000) !== 0x2000) return false
  // Exclude documentation range 2001:db8::/32
  if (v6[0] === 0x2001 && v6[1] === 0x0db8) return false
  return true
}

export const normalizeNetworkEntry = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parts = raw.split('/')
  if (parts.length > 2) return null

  const ip = normalizeIp(parts[0])
  if (!ip || !isPublicIp(ip)) return null
  if (parts.length === 1) return ip

  if (!/^\d+$/.test(parts[1])) return null
  const prefix = Number(parts[1])
  const isV4 = Boolean(parseIpv4Octets(ip))
  if (isV4) {
    if (prefix < 24 || prefix > 32) return null
    return prefix === 32 ? ip : `${ip}/${prefix}`
  }
  if (prefix < 48 || prefix > 128) return null
  return prefix === 128 ? ip : `${ip}/${prefix}`
}

export const parseAllowedIpsInput = (value) => {
  const rawList = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\r\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)

  const validEntries = []
  const invalidEntries = []
  const seen = new Set()

  for (const item of rawList) {
    const normalized = normalizeNetworkEntry(item)
    if (!normalized) {
      invalidEntries.push(item)
      continue
    }
    if (!seen.has(normalized)) {
      seen.add(normalized)
      validEntries.push(normalized)
    }
  }

  return {
    validEntries: validEntries.slice(0, MAX_ALLOWED_IPS_PER_LOCATION),
    invalidEntries,
    overflowCount: Math.max(0, validEntries.length - MAX_ALLOWED_IPS_PER_LOCATION)
  }
}

export const matchesNetworkEntry = (clientIp, entry) => {
  const ip = normalizeIp(clientIp)
  const normalizedEntry = normalizeNetworkEntry(entry)
  if (!ip || !isPublicIp(ip) || !normalizedEntry) return false

  if (!normalizedEntry.includes('/')) {
    return ip === normalizedEntry
  }

  const [entryIp, prefixStr] = normalizedEntry.split('/')
  const prefix = Number(prefixStr)
  const clientV4 = parseIpv4Octets(ip)
  const entryV4 = parseIpv4Octets(entryIp)

  if (clientV4 && entryV4) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return ((ipv4ToInt(clientV4) & mask) >>> 0) === ((ipv4ToInt(entryV4) & mask) >>> 0)
  }

  const clientV6 = parseIpv6Hextets(ip)
  const entryV6 = parseIpv6Hextets(entryIp)
  if (!clientV6 || !entryV6) return false

  let remainingBits = prefix
  for (let i = 0; i < 8 && remainingBits > 0; i += 1) {
    const bits = Math.min(16, remainingBits)
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff
    if ((clientV6[i] & mask) !== (entryV6[i] & mask)) return false
    remainingBits -= bits
  }
  return true
}

export const normalizeWifiLocation = (item = {}, index = 0) => {
  const source = item && typeof item === 'object' ? item : {}
  const { validEntries } = parseAllowedIpsInput(source.allowedIps ?? source.allowed_ips ?? [])
  const rawLat = source.latitude ?? source.lat
  const rawLng = source.longitude ?? source.lng
  const latitude = rawLat !== undefined && rawLat !== null && rawLat !== '' && Number.isFinite(Number(rawLat))
    ? Number(rawLat)
    : null
  const longitude = rawLng !== undefined && rawLng !== null && rawLng !== '' && Number.isFinite(Number(rawLng))
    ? Number(rawLng)
    : null
  const radiusMeters = Number.isFinite(Number(source.radiusMeters ?? source.radius_meters)) && Number(source.radiusMeters ?? source.radius_meters) > 0
    ? Number(source.radiusMeters ?? source.radius_meters)
    : 100
  return {
    id: String(source.id || `wifi_${index + 1}`).trim(),
    name: String(source.name || '').trim(),
    ssid: String(source.ssid || '').trim(),
    address: String(source.address || '').trim(),
    latitude,
    longitude,
    radiusMeters,
    allowedIps: validEntries,
    isActive: source.isActive !== false && source.is_active !== false
  }
}

export const normalizeWifiAttendanceSettings = (raw = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {}
  const rawLocations = Array.isArray(source.locations) ? source.locations : []
  const locations = rawLocations
    .map((loc, idx) => normalizeWifiLocation(loc, idx))
    .filter((loc) => loc.name || loc.allowedIps.length > 0 || (loc.latitude !== null && loc.longitude !== null))

  return {
    enabled: Boolean(source.enabled),
    requireWifi: Boolean(source.requireWifi),
    locations
  }
}

export const matchWifiLocation = (clientIp, wifiSettings = {}) => {
  const normalizedIp = normalizeIp(clientIp)
  if (!normalizedIp || !isPublicIp(normalizedIp)) return null
  const settings = normalizeWifiAttendanceSettings(wifiSettings)
  for (const location of settings.locations) {
    if (!location.isActive || !location.allowedIps.length) continue
    const matchedRule = location.allowedIps.find((entry) => matchesNetworkEntry(normalizedIp, entry))
    if (matchedRule) {
      return {
        id: location.id,
        name: location.name || 'Wi-Fi Văn phòng',
        ssid: location.ssid || '',
        address: location.address || '',
        matchedIp: normalizedIp,
        matchedRule
      }
    }
  }
  return null
}

export const evaluateWifiAttendance = (networkStatus = {}, wifiSettings = {}) => {
  const settings = normalizeWifiAttendanceSettings(wifiSettings)
  const ip = normalizeIp(networkStatus?.ip)
  const isPublic = isPublicIp(ip)
  const activeLocations = settings.locations.filter((loc) => loc.isActive && loc.allowedIps.length > 0)
  const matchedLocation = matchWifiLocation(ip, settings)

  if (matchedLocation) {
    return {
      allowed: true,
      mode: 'wifi',
      ip,
      isPublic,
      matchedLocation,
      activeLocations,
      message: `Đã kết nối Wi-Fi hợp lệ: ${matchedLocation.name}${matchedLocation.ssid ? ` (${matchedLocation.ssid})` : ''}`
    }
  }

  if (settings.enabled && settings.requireWifi && activeLocations.length > 0) {
    return {
      allowed: false,
      mode: 'wifi_blocked',
      ip,
      isPublic,
      matchedLocation: null,
      activeLocations,
      message: ip
        ? `Chưa kết nối đúng Wi-Fi văn phòng đã đăng ký (IP hiện tại: ${ip}). Vui lòng kết nối Wi-Fi công ty rồi thử lại.`
        : 'Chưa xác định được IP mạng công ty. Vui lòng kết nối Wi-Fi văn phòng rồi thử lại.'
    }
  }

  return {
    allowed: true,
    mode: 'standard',
    ip,
    isPublic,
    matchedLocation: null,
    activeLocations,
    message: activeLocations.length > 0
      ? 'Chưa khớp Wi-Fi văn phòng — hệ thống sẽ ghi nhận vị trí GPS/thiết bị.'
      : 'Chấm công trực tuyến theo ca và vị trí thiết bị.'
  }
}

export const fetchCurrentNetworkStatus = async (wifiSettings = {}, options = {}) => {
  let detectedIp = null

  try {
    const response = await fetch('/api/attendance-network', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (response.ok) {
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await response.json()
        const normalized = normalizeIp(payload?.ip)
        if (normalized) detectedIp = normalized
      }
    }
  } catch {
    // Fallback to Supabase RPC if local /api is unavailable
  }

  if ((!detectedIp || !isPublicIp(detectedIp)) && options?.supabase) {
    try {
      const { data, error } = await options.supabase.rpc('get_online_attendance_network')
      if (!error && data?.ip) {
        const rpcIp = normalizeIp(data.ip)
        if (rpcIp && (isPublicIp(rpcIp) || !detectedIp)) {
          detectedIp = rpcIp
        }
      }
    } catch {
      // Ignore if migration has not been applied yet
    }
  }

  if (!detectedIp || !isPublicIp(detectedIp)) {
    const publicIpEndpoints = [
      'https://api64.ipify.org?format=json',
      'https://api.ipify.org?format=json'
    ]
    for (const endpoint of publicIpEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        })
        if (res.ok) {
          const json = await res.json()
          const candidate = normalizeIp(json?.ip)
          if (candidate && isPublicIp(candidate)) {
            detectedIp = candidate
            break
          }
        }
      } catch {
        // Ignore fallback failure
      }
    }
  }

  return evaluateWifiAttendance({ ip: detectedIp }, wifiSettings)
}

