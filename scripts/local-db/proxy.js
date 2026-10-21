// Stand-in for the two Supabase paths the app talks to, in front of PostgREST:
//   /auth/v1/user   -> "this token belongs to the test admin"
//   /auth/v1/token  -> password sign-in (password "wrong" is refused, anything else works)
//   /rest/v1/*      -> PostgREST (the real data API), with the /rest/v1 prefix removed
const http = require('http'), fs = require('fs')
const USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'admin@test.local', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.url.startsWith('/auth/v1/user')) return json(200, USER)
  if (req.method === 'POST' && req.url.startsWith('/auth/v1/token')) {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let b = {}; try { b = JSON.parse(raw) } catch {}
      if (b.password === 'wrong') return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' })
      json(200, { access_token: fs.readFileSync('/tmp/jwt.txt', 'utf8').trim(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER })
    })
    return
  }
  const path = req.url.replace(/^\/rest\/v1/, '') || '/'
  const p = http.request({ host: '127.0.0.1', port: 3001, path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
  req.pipe(p)
}).listen(3000, '127.0.0.1')
