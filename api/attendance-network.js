const extractClientIp = (request) => {
  const headers = request?.headers || {}
  const firstHeaderIp = (value) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .find(Boolean)

  return (
    firstHeaderIp(headers['x-vercel-forwarded-for']) ||
    firstHeaderIp(headers['cf-connecting-ip']) ||
    firstHeaderIp(headers['x-real-ip']) ||
    firstHeaderIp(headers['x-forwarded-for']) ||
    request?.socket?.remoteAddress ||
    null
  )
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('Expires', '0')

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Chỉ hỗ trợ phương thức GET.' })
  }

  const rawIp = extractClientIp(request)
  const ip = rawIp ? String(rawIp).replace(/^::ffff:/i, '').trim() : null

  return response.status(200).json({
    ip: ip || null,
    timestamp: new Date().toISOString()
  })
}

