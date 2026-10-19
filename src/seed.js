const bcrypt = require('bcryptjs');
const db = require('./db');

db.exec(`
  DELETE FROM booking_items; DELETE FROM bookings; DELETE FROM slots;
  DELETE FROM attractions; DELETE FROM ticket_types; DELETE FROM users;
  DELETE FROM sqlite_sequence;
`);

const addUser = db.prepare(
  'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)'
);
addUser.run('Админ', 'admin@lagoon.ru', '+7 900 000-00-00', bcrypt.hashSync('admin123', 10), 'admin');
addUser.run('Иван Петров', 'user@lagoon.ru', '+7 900 111-11-11', bcrypt.hashSync('user123', 10), 'user');

const addType = db.prepare(
  'INSERT INTO ticket_types (name, min_age, max_age, price) VALUES (?, ?, ?, ?)'
);
addType.run('Детский до 5 лет', 0, 4, 0);
addType.run('Детский 5–17 лет', 5, 17, 500);
addType.run('Взрослый 18+', 18, null, 1000);

const attractions = [
  ['Экстремальные аттракционы', 'Самые современные и захватывающие аттракционы для любителей острых ощущений.', 'extreme'],
  ['Зоопарк с редкими животными', 'Уникальная коллекция животных со всего мира в естественных условиях обитания.', 'zoo'],
  ['Водные развлечения', 'Открытые и закрытые бассейны, водные горки и зоны отдыха у воды.', 'water'],
  ['3D-кинотеатр мультиплекс', 'Современный кинотеатр с фильмами для всей семьи в формате 3D.', 'cinema'],
];
const addAttr = db.prepare(
  'INSERT INTO attractions (title, description, category, image) VALUES (?, ?, ?, ?)'
);
const addSlot = db.prepare(
  'INSERT INTO slots (attraction_id, starts_at, capacity) VALUES (?, ?, ?)'
);

const hours = ['10:00', '12:00', '14:00', '16:00', '18:00'];
const pad = (n) => String(n).padStart(2, '0');

db.transaction(() => {
  attractions.forEach((a, i) => {
    const id = addAttr.run(a[0], a[1], a[2], `/img/${a[2]}.svg`).lastInsertRowid;
    // слоты на 14 дней вперёд
    for (let d = 1; d <= 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      for (const h of hours) addSlot.run(id, `${day}T${h}`, 20 + i * 5);
    }
  });
})();

console.log('Готово. Админ: admin@lagoon.ru / admin123, пользователь: user@lagoon.ru / user123');
