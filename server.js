require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const jwt      = require('jsonwebtoken')
const bcrypt   = require('bcrypt')
const multer   = require('multer')
const FormData = require('form-data')
const fetch    = require('node-fetch')
const nodemailer = require('nodemailer')
const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')
const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public')) // serve HTML files

// GET /api/stripe-key — ส่ง publishable key ให้ frontend
app.get('/api/stripe-key', (req, res) => {
  res.json({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '' })
})

// POST /api/create-payment-intent — สร้าง Stripe PaymentIntent
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount_thb, currency, order_description } = req.body
    if (!amount_thb || amount_thb <= 0) return res.status(400).json({ error: 'Invalid amount' })

    // Stripe ใช้ smallest currency unit — THB = สตางค์ (x100), USD = cents (x100)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount_thb * 100), // THB สตางค์
      currency: (currency || 'thb').toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: order_description || 'HewKao Shop Order',
      metadata: { shop: 'Shigure_S' }
    })

    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: amount_thb,
      currency: currency || 'thb'
    })
  } catch(e) {
    console.error('Stripe error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/verify — ตรวจสอบ token ว่ายังใช้ได้ไหม
app.get('/api/verify', auth, (req, res) => {
  res.json({ valid: true, role: req.user.role, username: req.user.username })
})

// Redirect root to shop.html
app.get('/', (req, res) => {
  res.redirect('/shop.html')
})

// Artist shops
app.get('/kono82', (req, res) => {
  res.sendFile(__dirname + '/public/shop-kono82.html')
})

// ── Supabase ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const JWT_SECRET = process.env.JWT_SECRET || 'hewkao-secret-2025-xK9mP2nQ'

// ── Email helper ──
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'soumashigure2@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
  })
}

function emailStyle() {
  return `
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#FFF9F5; margin:0; padding:0; }
      .wrap { max-width:560px; margin:0 auto; background:#fff; border-radius:20px; overflow:hidden; box-shadow:0 4px 24px rgba(180,140,200,.15); }
      .header { background:linear-gradient(135deg,#FFB7C5,#C9B8F0); padding:32px 28px; text-align:center; }
      .header h1 { margin:0; color:#fff; font-size:22px; font-weight:700; letter-spacing:-.3px; }
      .header p { margin:6px 0 0; color:rgba(255,255,255,.85); font-size:13px; }
      .body { padding:28px; }
      .order-box { background:#FFF9F5; border-radius:14px; padding:16px 18px; margin-bottom:18px; }
      .order-box h3 { margin:0 0 12px; font-size:13px; font-weight:700; color:#8a7a9a; letter-spacing:.5px; }
      .item-row { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #FFE4EC; font-size:14px; }
      .item-row:last-child { border:none; }
      .item-name { color:#4a3f5c; font-weight:600; }
      .item-price { color:#e8829a; font-weight:700; }
      .total-row { display:flex; justify-content:space-between; font-size:16px; font-weight:700; color:#e8829a; margin-top:14px; padding-top:12px; border-top:2px solid #FFE4EC; }
      .addr-box { background:#EDE8FC; border-radius:12px; padding:14px 16px; margin-bottom:18px; font-size:13px; color:#4a3f5c; line-height:1.7; }
      .addr-box strong { display:block; font-size:11px; color:#8a7a9a; letter-spacing:.5px; margin-bottom:4px; }
      .btn { display:inline-block; background:#e8829a; color:#fff; padding:12px 28px; border-radius:12px; text-decoration:none; font-weight:700; font-size:14px; margin-top:6px; }
      .footer { text-align:center; padding:20px 28px; font-size:11px; color:#bbb; border-top:1px solid #FFE4EC; }
    </style>`
}

// ── Generate random discount code ──
function genCode(prefix='GIFT') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = prefix + '-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// ── Process freebie สำหรับ order ──
async function processFreebie(orderId, orderItems, toEmail, memberEmail) {
  try {
    // หา products ที่มี freebie
    const productIds = orderItems.map(i => i.product_id || i.id)
    const { data: products } = await supabase
      .from('products')
      .select('id, name, freebie_type, freebie_file, freebie_discount_type, freebie_discount_value, freebie_discount_uses')
      .in('id', productIds)
      .not('freebie_type', 'is', null)

    if (!products || products.length === 0) return

    const freebies = []

    for (const product of products) {
      if (product.freebie_type === 'file' && product.freebie_file) {
        // แปลง Google Drive link
        let dlUrl = product.freebie_file
        const match = dlUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
        if (match) dlUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`
        freebies.push({ type: 'file', name: product.name, url: dlUrl })

      } else if (product.freebie_type === 'discount') {
        // Generate unique code
        let code = genCode('GIFT')
        // ตรวจซ้ำ
        const { data: existing } = await supabase.from('discounts').select('id').eq('code', code)
        if (existing && existing.length > 0) code = genCode('HEWK')

        // Create discount
        const { data: dc, error: dcErr } = await supabase.from('discounts').insert({
          code,
          type:      product.freebie_discount_type || 'percent',
          value:     product.freebie_discount_value || 10,
          max_uses:  product.freebie_discount_uses || 1,
          status:    'active',
        }).select().single()

        if (dcErr) { console.error('Freebie discount insert error:', dcErr.message); continue }
        if (dc) {
          freebies.push({
            type: 'discount',
            name: product.name,
            code: dc.code,
            discount_type: dc.type,
            discount_value: dc.value,
            max_uses: dc.max_uses,
          })
        }
      }
    }

    if (freebies.length === 0) return

    // บันทึก freebies ลง order_freebies ทีละ row
    for (const f of freebies) {
      const { error: insertErr } = await supabase
        .from('order_freebies')
        .insert({ order_id: parseInt(orderId), freebie: f })
      if (insertErr) console.error('order_freebies insert error:', insertErr.message)
    }

    // ส่ง email
    const recipient = toEmail || memberEmail
    if (recipient) {
      const freebieHtml = freebies.map(f => {
        if (f.type === 'file') {
          return `<div style="background:#E2F8F2;border-radius:12px;padding:14px 16px;margin-bottom:10px;">
            <div style="font-size:12px;font-weight:700;color:#0f6e56;margin-bottom:6px;">🎁 ของแถมจาก ${f.name}</div>
            <a href="${f.url}" style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;">⬇️ Download ของแถม</a>
          </div>`
        } else {
          const discStr = f.discount_type === 'percent' ? `${f.discount_value}%` : `฿${f.discount_value}`
          return `<div style="background:#FFF8DC;border-radius:12px;padding:14px 16px;margin-bottom:10px;border:2px dashed #f0b429;">
            <div style="font-size:12px;font-weight:700;color:#c8860a;margin-bottom:8px;">🎫 Discount Code จาก ${f.name}</div>
            <div style="font-size:24px;font-weight:900;font-family:monospace;color:#4a3f5c;letter-spacing:3px;margin-bottom:6px;">${f.code}</div>
            <div style="font-size:12px;color:#8a7a9a;">ลด ${discStr} · ใช้ได้ ${f.max_uses} ครั้ง</div>
          </div>`
        }
      }).join('')

      const html = `<!DOCTYPE html><html><head>${emailStyle()}</head><body>
        <div class="wrap">
          <div class="header" style="background:linear-gradient(135deg,#FFE5A0,#FFB7C5);">
            <h1>🎁 ของแถมจาก HewKao!</h1>
            <p>Order #${orderId} · สิทธิพิเศษสำหรับคุณ</p>
          </div>
          <div class="body">
            <p style="color:#4a3f5c;font-size:14px;margin-bottom:20px;">
              ขอบคุณสำหรับการสั่งซื้อค่ะ! 🌸 นี่คือของแถมพิเศษสำหรับคุณ<br>
              <span style="color:#8a7a9a;font-size:13px;">Thank you for your purchase! Here are your special gifts.</span>
            </p>
            ${freebieHtml}
            <p style="font-size:12px;color:#8a7a9a;text-align:center;margin-top:16px;">
              มีคำถาม? ติดต่อเราได้เลยค่ะ · 
              <a href="mailto:soumashigure2@gmail.com" style="color:#e8829a;">soumashigure2@gmail.com</a>
            </p>
          </div>
          <div class="footer">HewKao Shop 🌸 · hewkao.shop</div>
        </div>
      </body></html>`

      await sendOrderEmail(recipient, `🎁 ของแถมพิเศษจาก Order #${orderId} — HewKao Shop`, html)
    }

    return freebies
  } catch(e) {
    console.error('Freebie error:', e)
    return []
  }
}

async function sendOrderEmail(toEmail, subject, html) {
  try {
    const t = createTransporter()
    await t.sendMail({ from: '"HewKao Shop 🌸" <soumashigure2@gmail.com>', to: toEmail, subject, html })
    console.log('Email sent to:', toEmail)
  } catch(e) { console.error('Email error:', e.message) }
}

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

// GET /api/products — public (active only), รองรับ ?artist=xxx
app.get('/api/products', async (req, res) => {
  let query = supabase
    .from('products')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (req.query.artist) {
    query = query.eq('artist', req.query.artist)
  }

  const { data, error } = await query
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
  const { name, name_th, type, emoji, price, stock, status, badge, description, file_url,
          shipping_dom_thb, shipping_intl_thb, shipping_intl_usd,
          freebie_type, freebie_file, freebie_discount_type, freebie_discount_value, freebie_discount_uses,
          artist } = req.body
  if (!name || !type || !price) return res.status(400).json({ error: 'Missing required fields' })

  const { data, error } = await supabase
    .from('products')
    .insert({ name, name_th, type, emoji, price, stock: stock || null, status: status || 'active', badge, description, file_url,
      shipping_dom_thb: shipping_dom_thb ?? null,
      shipping_intl_thb: shipping_intl_thb ?? null,
      shipping_intl_usd: shipping_intl_usd ?? null,
      freebie_type: freebie_type || null,
      freebie_file: freebie_file || null,
      freebie_discount_type: freebie_discount_type || null,
      freebie_discount_value: freebie_discount_value ?? null,
      freebie_discount_uses: freebie_discount_uses ?? 1,
      artist: artist || 'Shigure_S',
    })
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
  const { total, note, items, guest_info, guest_email, slip_ref, discount_code } = req.body
  if (!items || !items.length) return res.status(400).json({ error: 'No items' })

  let member_id = null
  const token = req.headers.authorization?.split(' ')[1]
  if (token) {
    try { const d = jwt.verify(token, JWT_SECRET); member_id = d.id } catch(e) {}
  }

  try {
    // ── ตรวจ stock ก่อน create order ──
    const productIds = items.map(i => i.product_id)
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, name, stock, status')
      .in('id', productIds)
    if (prodErr) throw prodErr

    for (const item of items) {
      const product = products.find(p => p.id === item.product_id)
      if (!product) return res.status(400).json({ error: `Product not found` })
      if (product.status !== 'active') return res.status(400).json({ error: `${product.name} is no longer available` })
      if (product.stock !== null && product.stock < item.quantity) {
        return res.status(400).json({
          error: product.stock === 0
            ? `${product.name} is out of stock`
            : `Only ${product.stock} left in stock for ${product.name}`
        })
      }
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({ member_id, total, note: note||null, status: 'pending', guest_info: guest_info||null, guest_email: guest_email||null, slip_ref: slip_ref||null })
      .select().single()
    if (orderErr) throw orderErr

    const orderItems = items.map(i => ({ order_id: order.id, product_id: i.product_id, quantity: i.quantity, price: i.price }))
    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
    if (itemsErr) throw itemsErr

    // ── Deduct stock ──
    for (const item of items) {
      const product = products.find(p => p.id === item.product_id)
      if (product.stock !== null) {
        await supabase
          .from('products')
          .update({ stock: Math.max(0, product.stock - item.quantity) })
          .eq('id', item.product_id)
      }
    }

    // ── Increment discount used_count ──
    if (discount_code) {
      try {
        const { data: dc } = await supabase
          .from('discounts')
          .select('id, used_count')
          .eq('code', discount_code.toUpperCase())
          .single()
        if (dc) {
          await supabase
            .from('discounts')
            .update({ used_count: (dc.used_count || 0) + 1 })
            .eq('id', dc.id)
        }
      } catch(e) { console.error('Discount increment error:', e) }
    }

    // ── ส่ง Order Confirmation Email ──
    try {
      const toEmail = guest_email || null
      // ดึง email member ถ้า login
      let memberEmail = null
      if (member_id) {
        const { data: mem } = await supabase.from('members').select('email').eq('id', member_id).single()
        memberEmail = mem?.email || null
      }
      const recipient = toEmail || memberEmail
      if (recipient) {
        const itemsHtml = products.map(pr => {
          const item = items.find(i => i.product_id === pr.id)
          return `<div class="item-row">
            <span class="item-name">${pr.name}${item?.quantity > 1 ? ' ×'+item.quantity : ''}</span>
            <span class="item-price">฿${(item.price * item.quantity).toLocaleString()}</span>
          </div>`
        }).join('')
        const addrInfo = guest_info
          ? `${guest_info.full_name || ''}${guest_info.phone ? ' · '+guest_info.phone : ''}<br>${guest_info.address || ''}${guest_info.country ? ', '+guest_info.country : ''}`
          : ''
        const html = `<!DOCTYPE html><html><head>${emailStyle()}</head><body>
          <div class="wrap">
            <div class="header">
              <h1>🎉 Order Received!</h1>
              <p>Order #${order.id} · ได้รับคำสั่งซื้อแล้ว</p>
            </div>
            <div class="body">
              <p style="color:#4a3f5c;font-size:14px;margin-bottom:20px;">ขอบคุณสำหรับการสั่งซื้อค่ะ! เราได้รับ order ของคุณแล้ว และจะดำเนินการโดยเร็วที่สุด 🌸<br>
              <span style="color:#8a7a9a;font-size:13px;">Thank you for your order! We'll process it as soon as possible.</span></p>
              <div class="order-box">
                <h3>📦 ORDER SUMMARY</h3>
                ${itemsHtml}
                <div class="total-row"><span>Total</span><span>฿${Number(total).toLocaleString()}</span></div>
              </div>
              ${addrInfo ? `<div class="addr-box"><strong>📍 DELIVERY ADDRESS</strong>${addrInfo}</div>` : ''}
              ${note ? `<div class="addr-box" style="background:#FFF8DC;"><strong>📝 NOTE</strong>${note}</div>` : ''}
              <p style="font-size:13px;color:#8a7a9a;text-align:center;margin-top:8px;">มีคำถามหรือปัญหา? ติดต่อเราได้เลยค่ะ<br>
              <a href="mailto:soumashigure2@gmail.com" style="color:#e8829a;">soumashigure2@gmail.com</a></p>
            </div>
            <div class="footer">HewKao Shop 🌸 · hewkao.shop</div>
          </div>
        </body></html>`
        await sendOrderEmail(recipient, `🌸 Order #${order.id} Confirmed! · ยืนยันคำสั่งซื้อ`, html)
      }
    } catch(e) { console.error('Order confirmation email error:', e) }

    // ── Process Freebie (ส่งทันทีที่ order สร้าง เพราะจ่ายเงินแล้ว) ──
    const freebieItems = items.map(i => ({ product_id: i.product_id }))
    let memberEmailForFreebie = null
    if (member_id) {
      const { data: mem } = await supabase.from('members').select('email').eq('id', member_id).single()
      memberEmailForFreebie = mem?.email || null
    }
    // await เพื่อได้ freebies ก่อน return response
    const freebies = await processFreebie(order.id, freebieItems, guest_email, memberEmailForFreebie) || []

    res.json({ id: order.id, status: order.status, freebies })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// POST /api/verify-slip — verify PromptPay slip via EasySlip
app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ valid: false, message: 'No slip file' })
    const amount = parseFloat(req.body.amount) || 0

    const form = new FormData()
    form.append('file', req.file.buffer, {
      filename: 'slip.jpg',
      contentType: req.file.mimetype || 'image/jpeg'
    })

    const easyRes = await fetch('https://developer.easyslip.com/api/v1/verify', {
      method: 'POST',
      headers: { 'Authorization': `Bearer fd52f6c2-f0a5-4153-8133-6f5ef6dac605`, ...form.getHeaders() },
      body: form
    })

    const data = await easyRes.json()
    console.log('EasySlip response:', JSON.stringify(data))

    if (!easyRes.ok || data.status !== 200) {
      return res.json({ valid: false, message: data.message || 'สลิปไม่ถูกต้อง' })
    }

    const slip = data.data

    // ✅ ตรวจว่าโอนมาให้เราจริง — เช็คเบอร์ปลายทาง
    const PROMPTPAY_NUMBER = '0957562647'
    const receiverAcct = slip?.receiver?.account?.proxy?.account || slip?.receiver?.account?.value || ''
    const receiverClean = receiverAcct.replace(/[-\s]/g, '')

    // EasySlip mask เบอร์เป็น xxx-xxx-2647 เช็คแค่ 4 ตัวท้าย
    const last4 = PROMPTPAY_NUMBER.slice(-4) // 2647
    const receiverLast4 = receiverClean.replace(/x/gi,'').replace(/-/g,'').slice(-4)

    const receiverMatch =
      receiverClean === PROMPTPAY_NUMBER ||
      receiverClean === '66' + PROMPTPAY_NUMBER.substring(1) ||
      receiverClean.endsWith(last4) ||
      receiverAcct.replace(/-/g,'').endsWith(last4)

    if (!receiverMatch) {
      console.log('Receiver mismatch:', receiverAcct, '!=', PROMPTPAY_NUMBER)
      return res.json({ valid: false, message: 'สลิปนี้ไม่ได้โอนมาที่ร้านเรานะคะ กรุณาตรวจสอบอีกครั้ง 🙏' })
    }

    // ✅ ตรวจยอดเงิน (±1 บาท)
    const slipAmount = slip?.amount?.amount || 0
    if (Math.abs(slipAmount - amount) > 1) {
      return res.json({ valid: false, message: `ยอดเงินไม่ตรง (สลิป: ฿${slipAmount} / ที่ต้องชำระ: ฿${amount})` })
    }

    // ✅ ตรวจ transRef ซ้ำ — สลิปเดิมใช้ซ้ำไม่ได้
    const transRef = slip?.transRef
    if (transRef) {
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('slip_ref', transRef)
        .single()
      if (existing) {
        return res.json({ valid: false, message: 'สลิปนี้ถูกใช้ไปแล้วนะคะ กรุณาโอนใหม่อีกครั้ง 🙏' })
      }
    }

    res.json({ valid: true, amount: slipAmount, ref: transRef })
  } catch(e) {
    console.error('EasySlip error:', e.message)
    res.status(500).json({ valid: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบ' })
  }
})

// GET /api/orders/:id/freebies — ดึง freebies ของ order
app.get('/api/orders/:id/freebies', async (req, res) => {
  const { id } = req.params
  try {
    const { data, error } = await supabase
      .from('order_freebies')
      .select('freebie')
      .eq('order_id', parseInt(id))
    if (error) return res.json([])
    res.json((data || []).map(r => r.freebie))
  } catch(e) { res.json([]) }
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

    // ดึง order_freebies
    let freebieMap = {}
    if (orderIds.length > 0) {
      const { data: freebies } = await supabase
        .from('order_freebies')
        .select('order_id, freebie')
        .in('order_id', orderIds)
      if (freebies) {
        freebies.forEach(f => {
          if (!freebieMap[f.order_id]) freebieMap[f.order_id] = []
          freebieMap[f.order_id].push(f.freebie)
        })
      }
    }

    const result = orders.map(o => ({
      ...o,
      download_links: dlMap[o.id] || [],
      freebies: freebieMap[o.id] || []
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

// POST /api/orders/:id/auto-confirm — auto confirm digital orders
app.post('/api/orders/:id/auto-confirm', async (req, res) => {
  const { id } = req.params
  try {
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('product_id, products(name, type, file_url)')
      .eq('order_id', id)

    const allDigital = orderItems?.every(i => i.products?.type === 'digital')
    if (!allDigital) return res.status(400).json({ error: 'Not a digital-only order' })

    await supabase.from('orders').update({ status: 'paid' }).eq('id', id)

    const links = []
    for (const item of orderItems) {
      if (!item.products?.file_url) continue
      let dlUrl = item.products.file_url
      const match = dlUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
      if (match) dlUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`
      await supabase.from('download_links').upsert({
        order_id: parseInt(id), product_id: item.product_id,
        url: dlUrl, created_at: new Date().toISOString()
      }, { onConflict: 'order_id,product_id' })
      links.push({ url: dlUrl, name: item.products.name })
    }

    // ส่งเมล์ถ้ามี guest_email
    const { data: order } = await supabase.from('orders').select('guest_email, member_id, members(email)').eq('id', id).single()
    const toEmail = order?.guest_email || order?.members?.email
    if (toEmail && links.length > 0) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: 'soumashigure2@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        })
        const linksHtml = links.map(l => `<p><a href="${l.url}" style="background:#e8829a;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:bold;">⬇️ Download: ${l.name}</a></p>`).join('')
        await transporter.sendMail({
          from: '"HewKao Shop 🌸" <soumashigure2@gmail.com>',
          to: toEmail,
          subject: '🌸 Your HewKao Download is Ready!',
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#e8829a;">Thank you for your purchase! 🎉</h2>
            <p>Your download link${links.length > 1 ? 's are' : ' is'} ready:</p>
            ${linksHtml}
            <p style="font-size:12px;color:#888;margin-top:20px;">If you have any issues, please contact us at soumashigure2@gmail.com</p>
            <p style="font-size:12px;color:#888;">HewKao Shop 🌸</p>
          </div>`
        })
      } catch(mailErr) { console.error('Email error:', mailErr) }
    }

    res.json({ status: 'paid', download_links: links })
  } catch(e) { res.status(500).json({ error: e.message }) }
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

  // ── ส่ง Status Update Email ──
  try {
    const { data: fullOrder } = await supabase
      .from('orders')
      .select('guest_email, member_id, total, note, members(email), order_items(quantity, price, products(name, name_th))')
      .eq('id', id)
      .single()

    const toEmail = fullOrder?.guest_email || fullOrder?.members?.email
    if (toEmail && ['paid','shipped','cancelled'].includes(status)) {
      const statusMap = {
        paid:      { th: 'ยืนยันการชำระเงินแล้ว ✅',      en: 'Payment Confirmed ✅',       icon: '✅', color: '#4CAF50' },
        shipped:   { th: 'กำลังจัดส่ง 🚚',                en: 'Your Order is on the Way 🚚', icon: '🚚', color: '#2196F3' },
        cancelled: { th: 'คำสั่งซื้อถูกยกเลิก 🚫',         en: 'Order Cancelled 🚫',          icon: '🚫', color: '#e8829a' },
      }
      const st = statusMap[status]
      const itemsHtml = (fullOrder.order_items || []).map(i =>
        `<div class="item-row">
          <span class="item-name">${i.products?.name || '?'}${i.quantity > 1 ? ' ×'+i.quantity : ''}</span>
          <span class="item-price">฿${(i.price * i.quantity).toLocaleString()}</span>
        </div>`
      ).join('')

      const msgMap = {
        paid:      'เราได้รับการชำระเงินของคุณแล้วค่ะ กำลังเตรียมสินค้าให้คุณ 🌸<br><span style="color:#8a7a9a;font-size:13px;">We have received your payment and are preparing your order.</span>',
        shipped:   'สินค้าของคุณถูกส่งออกแล้วค่ะ รอรับที่บ้านได้เลย! 📦<br><span style="color:#8a7a9a;font-size:13px;">Your order has been shipped! Please wait for delivery.</span>',
        cancelled: 'คำสั่งซื้อของคุณถูกยกเลิกแล้วค่ะ หากมีข้อสงสัยกรุณาติดต่อเราได้เลย<br><span style="color:#8a7a9a;font-size:13px;">Your order has been cancelled. Please contact us if you have questions.</span>',
      }

      const html = `<!DOCTYPE html><html><head>${emailStyle()}</head><body>
        <div class="wrap">
          <div class="header" style="background:linear-gradient(135deg,${st.color}99,${st.color}55);">
            <h1>${st.icon} ${st.en}</h1>
            <p>Order #${id} · ${st.th}</p>
          </div>
          <div class="body">
            <p style="color:#4a3f5c;font-size:14px;margin-bottom:20px;">${msgMap[status]}</p>
            <div class="order-box">
              <h3>📦 ORDER #${id}</h3>
              ${itemsHtml}
              <div class="total-row"><span>Total</span><span>฿${Number(fullOrder.total).toLocaleString()}</span></div>
            </div>
            <p style="font-size:13px;color:#8a7a9a;text-align:center;">มีคำถาม? ติดต่อเราได้เลยค่ะ<br>
            <a href="mailto:soumashigure2@gmail.com" style="color:#e8829a;">soumashigure2@gmail.com</a></p>
          </div>
          <div class="footer">HewKao Shop 🌸 · hewkao.shop</div>
        </div>
      </body></html>`

      await sendOrderEmail(toEmail, `${st.icon} Order #${id} — ${st.en}`, html)
    }
  } catch(e) { console.error('Status update email error:', e) }

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

// GET /api/page-content?lang=en&shop=Shigure_S
app.get('/api/page-content', async (req, res) => {
  const lang = req.query.lang || 'en'
  const shop = req.query.shop || 'hewkao'
  const { data, error } = await supabase
    .from('page_content')
    .select('key, value')
    .eq('lang', lang)
    .eq('shop', shop)
  if (error) return res.status(500).json({ error: error.message })
  const result = {}
  data.forEach(row => { result[row.key] = row.value })
  res.json(result)
})

// POST /api/admin/page-content — save page content
app.post('/api/admin/page-content', auth, adminOnly, async (req, res) => {
  const { lang, content, shop } = req.body
  if (!lang || !content) return res.status(400).json({ error: 'Missing fields' })
  const shopId = shop || 'hewkao'
  try {
    const rows = Object.entries(content).map(([key, value]) => ({ lang, key, value, shop: shopId }))
    const { error } = await supabase
      .from('page_content')
      .upsert(rows, { onConflict: 'lang,key,shop' })
    if (error) throw error
    res.json({ message: 'Saved' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})
// ═══════════════════════════════════════
app.post('/api/admin/upload', auth, adminOnly, upload.single('file'), async (req, res) => {
  try {
    let buffer, contentType, ext

    if (req.file) {
      // multipart/form-data (จาก admin product image)
      buffer = req.file.buffer
      contentType = req.file.mimetype || 'image/jpeg'
      ext = contentType.split('/')[1]?.split(';')[0]?.split('+')[0] || 'jpg'
    } else {
      // raw binary (จาก hero/page bg upload)
      const chunks = []
      await new Promise((resolve, reject) => {
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', resolve)
        req.on('error', reject)
      })
      buffer = Buffer.concat(chunks)
      contentType = req.headers['content-type'] || 'image/jpeg'
      ext = contentType.split('/')[1]?.split(';')[0]?.split('+')[0] || 'jpg'
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received' })
    }

    const filename = `product_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage
      .from('products')
      .upload(filename, buffer, { contentType, upsert: true })

    if (error) {
      console.error('Storage error:', error)
      return res.status(500).json({ error: error.message })
    }

    const { data: { publicUrl } } = supabase.storage
      .from('products')
      .getPublicUrl(filename)

    res.json({ url: publicUrl })
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
