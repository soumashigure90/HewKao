# MochiShop Backend

## วิธีติดตั้ง

### 1. ติดตั้ง dependencies
```
npm install
```

### 2. ตั้งค่า .env
เปิดไฟล์ `.env` แล้วใส่ค่าให้ครบ:
```
SUPABASE_URL=https://vhhyeldrildsjnznqkdo.supabase.co
SUPABASE_KEY=ใส่ anon key ของคุณ
JWT_SECRET=สุ่มข้อความอะไรก็ได้ยาวๆ
PORT=3000
```

### 3. รัน database schema
ไปที่ Supabase → SQL Editor → วาง schema.sql แล้วกด Run

### 4. รัน backend
```
npm start
```
หรือถ้ามี nodemon:
```
npm run dev
```

### 5. ทดสอบ
เปิด browser ไปที่ http://localhost:3000/api/products
ถ้าเห็น JSON แสดงว่าทำงานแล้ว ✅

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/login | - | เข้าสู่ระบบ |
| POST | /api/register | - | สมัครสมาชิก |
| GET | /api/products | - | ดูสินค้าทั้งหมด (public) |
| GET | /api/admin/products | Admin | ดูสินค้าทั้งหมดรวม hidden |
| POST | /api/admin/products | Admin | เพิ่มสินค้า |
| PUT | /api/admin/products/:id | Admin | แก้ไขสินค้า |
| DELETE | /api/admin/products/:id | Admin | ลบสินค้า |
| GET | /api/admin/discounts | Admin | ดูโค้ดส่วนลด |
| POST | /api/admin/discounts | Admin | สร้างโค้ดส่วนลด |
| DELETE | /api/admin/discounts/:id | Admin | ลบโค้ดส่วนลด |
| POST | /api/check-discount | Member | เช็คโค้ดส่วนลด |
| GET | /api/admin/orders | Admin | ดูออเดอร์ทั้งหมด |
| GET | /api/admin/members | Admin | ดูสมาชิกทั้งหมด |
