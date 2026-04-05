require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const jwt     = require('jsonwebtoken')
const bcrypt  = require('bcrypt')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public')) // serve HTML files

// GET /api/verify — ตรวจสอบ token ว่ายังใช้ได้ไหม
app.get('/api/verify', auth, (req, res) => {
  res.json({ valid: true, role: req.user.role, username: req.user.username })
})

// Redirect root to shop.html
app.get('/', (req, res) => {
  res.redirect('/shop.html')
})

// ── Supabase ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const JWT_SECRET = process.env.JWT_SECRET || 'hewkao-secret-2025-xK9mP2nQ'

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

// POST /api/orders — create order (ไม่บังคับ login)
app.post('/api/orders', async (req, res) => {
  const { total, note, items, guest_info } = req.body
  if (!items || !items.length) return res.status(400).json({ error: 'No items' })

  // ถ้ามี token ก็ใช้ user id ได้ ถ้าไม่มีก็เป็น guest
  let member_id = null
  const token = req.headers.authorization?.split(' ')[1]
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      member_id = decoded.id
    } catch(e) {}
  }

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({ member_id, total, note: note||null, status: 'pending', guest_info: guest_info||null })
      .select()
      .single()
    if (orderErr) throw orderErr

    const orderItems = items.map(i => ({
      order_id:   order.id,
      product_id: i.product_id,
      quantity:   i.quantity,
      price:      i.price
    }))
    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
    if (itemsErr) throw itemsErr

    res.json({ id: order.id, status: order.status })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/my-orders — ดู order ของตัวเอง
app.get('/api/my-orders', auth, async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`id, total, status, note, created_at,
        order_items(quantity, price, products(name, name_th, emoji, image_url, type))`)
      .eq('member_id', req.user.id)
      .order('created_at', { ascending: false })
    if (error) throw error

    // ดึง download_links แยก
    const orderIds = orders.map(o => o.id)
    let dlMap = {}
    if (orderIds.length > 0) {
      const { data: links } = await supabase
        .from('download_links')
        .select('order_id, url, product_id, products(name, name_th)')
        .in('order_id', orderIds)
      if (links) {
        links.forEach(l => {
          if (!dlMap[l.order_id]) dlMap[l.order_id] = []
          dlMap[l.order_id].push(l)
        })
      }
    }

    const result = orders.map(o => ({
      ...o,
      download_links: dlMap[o.id] || []
    }))
    res.json(result)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})
app.get('/api/admin/orders', auth, adminOnly, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1
  const limit = parseInt(req.query.limit) || 10
  const from  = (page - 1) * limit
  const to    = from + limit - 1

  const { data, error, count } = await supabase
    .from('orders')
    .select(`*, members(username, email, address, phone, full_name, country), order_items(quantity, price, products(name, name_th, emoji, type))`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ orders: data, total: count, page, limit })
})

// GET /api/admin/orders/new-count — จำนวน order pending ใหม่
app.get('/api/admin/orders/new-count', auth, adminOnly, async (req, res) => {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ count })
})

// PUT /api/admin/orders/:id — confirm or reject + auto download link
app.put('/api/admin/orders/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  const { status } = req.body
  if (!['pending','paid','shipped','cancelled'].includes(status))
    return res.status(400).json({ error: 'Invalid status' })

  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })

  // ถ้า confirm (paid) → สร้าง download links สำหรับ digital items
  if (status === 'paid') {
    try {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, products(name, type, file_url)')
        .eq('order_id', id)

      const digitalItems = items?.filter(i => i.products?.type === 'digital' && i.products?.file_url) || []

      for (const item of digitalItems) {
        // แปลง Google Drive view link → download link
        let dlUrl = item.products.file_url
        const match = dlUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
        if (match) {
          dlUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`
        }
        await supabase.from('download_links').upsert({
          order_id:   parseInt(id),
          product_id: item.product_id,
          url:        dlUrl,
          created_at: new Date().toISOString()
        }, { onConflict: 'order_id,product_id' })
      }
    } catch(e) { console.error('Download link error:', e) }
  }

  res.json(data)
})

// DELETE /api/admin/orders/:id
app.delete('/api/admin/orders/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  // ลบ order_items ก่อน
  await supabase.from('order_items').delete().eq('order_id', id)
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Deleted' })
})

// ═══════════════════════════════════════
// MEMBERS ROUTES
// ═══════════════════════════════════════

// GET /api/admin/members
app.get('/api/admin/members', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('members')
    .select('id, username, email, role, address, phone, created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/admin/members/:id
app.delete('/api/admin/members/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params
  // ป้องกันลบ admin ตัวเอง
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' })
  const { data: member } = await supabase.from('members').select('role').eq('id', id).single()
  if (member?.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin accounts' })
  const { error } = await supabase.from('members').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Deleted' })
})

// GET /api/profile
app.get('/api/profile', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('members')
    .select('id, username, email, address, phone, full_name, country, created_at')
    .eq('id', req.user.id)
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PUT /api/profile
app.put('/api/profile', auth, async (req, res) => {
  const { address, phone, full_name, country } = req.body
  const { data, error } = await supabase
    .from('members')
    .update({
      address:   address   || null,
      phone:     phone     || null,
      full_name: full_name || null,
      country:   country   || null
    })
    .eq('id', req.user.id)
    .select('id, username, email, address, phone, full_name, country')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})
// ═══════════════════════════════════════

// GET /api/settings — public
app.get('/api/settings', async (req, res) => {
  const { data, error } = await supabase.from('shop_settings').select('key, value')
  if (error) return res.status(500).json({ error: error.message })
  const result = {}
  data.forEach(r => { result[r.key] = r.value })
  res.json(result)
})

// POST /api/admin/settings — save all settings
app.post('/api/admin/settings', auth, adminOnly, async (req, res) => {
  const settings = req.body
  try {
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value: value || '' }))
    const { error } = await supabase
      .from('shop_settings')
      .upsert(rows, { onConflict: 'key' })
    if (error) throw error
    res.json({ message: 'Saved' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/admin/change-password
app.post('/api/admin/change-password', auth, adminOnly, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' })
  const { data: member } = await supabase.from('members').select('password').eq('id', req.user.id).single()
  if (!member) return res.status(404).json({ error: 'User not found' })
  const match = await bcrypt.compare(currentPassword, member.password)
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' })
  const hashed = await bcrypt.hash(newPassword, 10)
  await supabase.from('members').update({ password: hashed }).eq('id', req.user.id)
  res.json({ message: 'Password updated' })
})
// ═══════════════════════════════════════

// GET /api/page-content?lang=en
app.get('/api/page-content', async (req, res) => {
  const lang = req.query.lang || 'en'
  const { data, error } = await supabase
    .from('page_content')
    .select('key, value')
    .eq('lang', lang)
  if (error) return res.status(500).json({ error: error.message })
  // แปลงเป็น object { key: value }
  const result = {}
  data.forEach(row => { result[row.key] = row.value })
  res.json(result)
})

// POST /api/admin/page-content — save page content
app.post('/api/admin/page-content', auth, adminOnly, async (req, res) => {
  const { lang, content } = req.body
  if (!lang || !content) return res.status(400).json({ error: 'Missing fields' })
  try {
    // upsert ทุก key
    const rows = Object.entries(content).map(([key, value]) => ({ lang, key, value }))
    const { error } = await supabase
      .from('page_content')
      .upsert(rows, { onConflict: 'lang,key' })
    if (error) throw error
    res.json({ message: 'Saved' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})
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
