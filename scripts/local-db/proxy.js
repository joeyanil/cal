const http = require('http')
http.createServer((req, res) => {
  if (req.url.startsWith('/auth/v1/user')) { // stand-in for Supabase Auth: "this token belongs to the admin"
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'admin@test.local', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }))
  }
  const path = req.url.replace(/^\/rest\/v1/, '') || '/'
  const p = http.request({ host: '127.0.0.1', port: 3001, path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
  req.pipe(p)
}).listen(3000, '127.0.0.1')
