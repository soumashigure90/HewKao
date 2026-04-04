const express = require('express')
const cors    = require('cors')
const jwt     = require('jsonwebtoken')
const bcrypt  = require('bcrypt')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())
const path = require("path");

app.use(express.static("public"));

app.get("/", (req, res) => {
 res.sendFile(path.join(__dirname, "public", "shop.html"));
});

// ── Supabase ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const JWT_SECRET = process.env.JWT_SECRET || 'mochi-secret-change-this'

// ── Auth Middleware ──
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  next()
}

// ═══════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' })

  const { data: member, error } = await supabase
    .from('members')
    .select('*')
    .eq('username', username)
    .single()

  if (error || !member) return res.status(401).json({ error: 'Wrong username or password' })

  const match = await bcrypt.compare(password, member.password)
  if (!match) return res.status(401).json({ error: 'Wrong username or password' })

  const token = jwt.sign(
    { id: member.id, username: member.username, role: member.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({ token, role: member.role, username: member.username })
})

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { username, email, password, address, phone } = req.body
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' })
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

  const hashed = await bcrypt.hash(password, 10)
  const { data, error } = await supabase
    .from('members')
    .insert({ username, email, password: hashed, role: 'member', address: address||null, phone: phone||null })
    .select()
    .single()

  if (error) {
    if (error.message.includes('username')) return res.status(400).json({ error: 'Username already taken' })
    if (error.message.includes('email'))    return res.status(400).json({ error: 'Email already registered' })
    return res.status(400).json({ error: error.message })
  }

  const token = jwt.sign(
    { id: data.id, username: data.username, role: data.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ message: 'Registered successfully', token, role: data.role, username: data.username })
})

// ═══════════════════════════════════════
// PRODUCTS ROUTES
// ═══════════════════════════════════════

// GET /api/products — public (active only)
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/admin/products — admin (all)
app.get('/api/admin/products', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/admin/products — add product
app.post('/api/admin/products', auth, adminOnly, async (req, res) => {
  const { name, name_th, type, emoji, price, stock, status, badge, description, file_url } = req.body
  if (!name || !type || !price) return res.status(400).json({ error: 'Missing required fields' })

  const { data, error } = await supabase
    .from('products')
    .insert({ name, name_th, type, emoji, price, stock: stock || null, status: status || 'active', badge, description, file_url })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/admin/products/:id — edit product
app.put('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  const updates = req.body

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/admin/products/:id — delete product
app.delete('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Deleted' })
})

// ═══════════════════════════════════════
// DISCOUNT ROUTES
// ═══════════════════════════════════════

// GET /api/admin/discounts
app.get('/api/admin/discounts', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('discounts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/admin/discounts
app.post('/api/admin/discounts', auth, adminOnly, async (req, res) => {
  const { code, type, value, max_uses, expires_at, status } = req.body
  if (!code || !type || !value) return res.status(400).json({ error: 'Missing fields' })

  const { data, error } = await supabase
    .from('discounts')
    .insert({ code: code.toUpperCase(), type, value, max_uses: max_uses || null, expires_at: expires_at || null, status: status || 'active' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/admin/discounts/:id
app.delete('/api/admin/discounts/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from('discounts').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Deleted' })
})

// POST /api/check-discount — validate discount code
app.post('/api/check-discount', auth, async (req, res) => {
  const { code } = req.body
  const { data, error } = await supabase
    .from('discounts')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('status', 'active')
    .single()

  if (error || !data) return res.status(404).json({ error: 'Code not found or expired' })
  if (data.max_uses && data.used_count >= data.max_uses) return res.status(400).json({ error: 'Code has reached max uses' })
  if (data.expires_at && new Date(data.expires_at) < new Date()) return res.status(400).json({ error: 'Code has expired' })

  res.json({ valid: true, type: data.type, value: data.value })
})

// ═══════════════════════════════════════
// ORDERS ROUTES
// ═══════════════════════════════════════

// GET /api/admin/orders
app.get('/api/admin/orders', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, members(username, email), order_items(*, products(name))`)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ═══════════════════════════════════════
// MEMBERS ROUTES
// ═══════════════════════════════════════

// GET /api/admin/members
app.get('/api/admin/members', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('members')
    .select('id, username, email, role, created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ═══════════════════════════════════════
// IMAGE UPLOAD (admin only — key stays server-side)
// ═══════════════════════════════════════
app.post('/api/admin/upload', auth, adminOnly, async (req, res) => {
  try {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks)
        const contentType = req.headers['content-type'] || 'image/jpeg'
        const ext = contentType.split('/')[1]?.split(';')[0]?.split('+')[0] || 'jpg'
        const filename = `product_${Date.now()}.${ext}`

        const { data, error } = await supabase.storage
          .from('products')
          .upload(filename, buffer, {
            contentType,
            upsert: true
          })

        if (error) {
          console.error('Storage error:', error)
          return res.status(500).json({ error: error.message })
        }

        const { data: { publicUrl } } = supabase.storage
          .from('products')
          .getPublicUrl(filename)

        res.json({ url: publicUrl })
      } catch(inner) {
        console.error('Upload inner error:', inner)
        res.status(500).json({ error: inner.message })
      }
    })
    req.on('error', err => {
      console.error('Request error:', err)
      res.status(500).json({ error: err.message })
    })
  } catch(e) {
    console.error('Upload error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`HewKao API running on port ${PORT}`))
