const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- middleware ----------
const requireAuth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: 'Требуется вход' });

const requireAdmin = (req, res, next) =>
  req.session.user?.role === 'admin'
    ? next()
    : res.status(403).json({ error: 'Только для администратора' });

// ---------- auth ----------
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните имя, email и пароль' });
  if (!/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ error: 'Некорректный email' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const id = db
    .prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim().toLowerCase(), phone || null, bcrypt.hashSync(password, 10))
    .lastInsertRowid;

  req.session.user = { id, name, email, role: 'user' };
  res.status(201).json(req.session.user);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json(req.session.user);
});

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/auth/me', (req, res) => res.json(req.session.user || null));

// ---------- каталог ----------
app.get('/api/attractions', (req, res) => {
  const { category, q } = req.query;
  let sql = 'SELECT * FROM attractions WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (q) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/attractions/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attractions WHERE id = ?').get(req.params.id);
  a ? res.json(a) : res.status(404).json({ error: 'Не найдено' });
});

app.get('/api/ticket-types', (req, res) =>
  res.json(db.prepare('SELECT * FROM ticket_types ORDER BY min_age').all())
);

// слоты на дату + сколько мест свободно
app.get('/api/attractions/:id/slots', (req, res) => {
  const { date } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    return res.status(400).json({ error: 'Укажите date=YYYY-MM-DD' });
  const rows = db
    .prepare(
      `SELECT s.id, s.starts_at, s.capacity,
              s.capacity - COALESCE((
                SELECT SUM(bi.quantity) FROM bookings b
                JOIN booking_items bi ON bi.booking_id = b.id
                WHERE b.slot_id = s.id AND b.status != 'cancelled'), 0) AS free
       FROM slots s
       WHERE s.attraction_id = ? AND s.starts_at LIKE ?
       ORDER BY s.starts_at`
    )
    .all(req.params.id, `${date}%`);
  res.json(rows);
});

// ---------- бронирование ----------
// items: [{ ticket_type_id, quantity }]. Цену считает СЕРВЕР, клиенту не доверяем.
const createBooking = db.transaction((userId, slotId, items) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
  if (!slot) throw Object.assign(new Error('Слот не найден'), { status: 404 });
  if (new Date(slot.starts_at) < new Date())
    throw Object.assign(new Error('Слот уже прошёл'), { status: 400 });

  const getType = db.prepare('SELECT * FROM ticket_types WHERE id = ?');
  let total = 0;
  let guests = 0;
  const lines = items.map((it) => {
    const type = getType.get(it.ticket_type_id);
    const qty = Number(it.quantity);
    if (!type || !Number.isInteger(qty) || qty <= 0)
      throw Object.assign(new Error('Некорректные билеты'), { status: 400 });
    total += type.price * qty;
    guests += qty;
    return { type, qty };
  });
  if (guests === 0) throw Object.assign(new Error('Выберите хотя бы один билет'), { status: 400 });

  // проверка мест внутри той же транзакции (better-sqlite3 сериализует записи)
  const taken = db
    .prepare(
      `SELECT COALESCE(SUM(bi.quantity), 0) AS n FROM bookings b
       JOIN booking_items bi ON bi.booking_id = b.id
       WHERE b.slot_id = ? AND b.status != 'cancelled'`
    )
    .get(slotId).n;
  if (taken + guests > slot.capacity)
    throw Object.assign(
      new Error(`Недостаточно мест: свободно ${slot.capacity - taken}`),
      { status: 409 }
    );

  const bookingId = db
    .prepare('INSERT INTO bookings (user_id, slot_id, total_price) VALUES (?, ?, ?)')
    .run(userId, slotId, total).lastInsertRowid;
  const addItem = db.prepare(
    'INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
  );
  lines.forEach((l) => addItem.run(bookingId, l.type.id, l.qty, l.type.price));
  return { id: bookingId, total_price: total, guests };
});

app.post('/api/bookings', requireAuth, (req, res) => {
  const { slot_id, items } = req.body || {};
  if (!slot_id || !Array.isArray(items))
    return res.status(400).json({ error: 'Нужны slot_id и items' });
  try {
    res.status(201).json(createBooking(req.session.user.id, slot_id, items));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/bookings/my', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.status, b.total_price, b.created_at, s.starts_at, a.title
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN attractions a ON a.id = s.attraction_id
       WHERE b.user_id = ? ORDER BY s.starts_at DESC`
    )
    .all(req.session.user.id);
  res.json(rows);
});

app.patch('/api/bookings/:id/cancel', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b || b.user_id !== req.session.user.id)
    return res.status(404).json({ error: 'Бронь не найдена' });
  if (b.status === 'cancelled') return res.status(400).json({ error: 'Уже отменена' });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  res.json({ ok: true });
});

// ---------- админка ----------
app.get('/api/admin/bookings', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT b.id, b.status, b.total_price, b.created_at, s.starts_at,
                    a.title, u.name AS user_name, u.email
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN attractions a ON a.id = s.attraction_id
             JOIN users u ON u.id = b.user_id`;
  const params = [];
  if (status) { sql += ' WHERE b.status = ?'; params.push(status); }
  res.json(db.prepare(sql + ' ORDER BY b.created_at DESC').all(...params));
});

app.patch('/api/admin/bookings/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'confirmed', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Недопустимый статус' });
  const r = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Бронь не найдена' });
});

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  res.json({
    bookings: db.prepare("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status").all(),
    revenue: db
      .prepare("SELECT COALESCE(SUM(total_price),0) AS sum FROM bookings WHERE status = 'confirmed'")
      .get().sum,
  });
});

app.post('/api/admin/attractions', requireAuth, requireAdmin, (req, res) => {
  const { title, description, category, image } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'Нужны title и category' });
  const id = db
    .prepare('INSERT INTO attractions (title, description, category, image) VALUES (?, ?, ?, ?)')
    .run(title, description || '', category, image || null).lastInsertRowid;
  res.status(201).json({ id });
});

app.delete('/api/admin/attractions/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM attractions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
