const Database = require('better-sqlite3');
const db = new Database('./data/medical-clinic.db');

db.exec(`
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date_of_birth DATE,
    gender TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    appointment_date DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE TABLE inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_mobile ON users(mobile);
CREATE INDEX idx_doctors_phone ON doctors(phone);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
`);

const insertUser = db.prepare('INSERT INTO users (name, mobile) VALUES (?, ?)');
const insertPatient = db.prepare('INSERT INTO patients (user_id, date_of_birth, gender, address) VALUES (?, ?, ?, ?)');
const insertDoctor = db.prepare('INSERT INTO doctors (name, specialty, phone) VALUES (?, ?, ?)');
const insertAppointment = db.prepare('INSERT INTO appointments (patient_id, doctor_id, appointment_date, status) VALUES (?, ?, ?, ?)');
const insertInventory = db.prepare('INSERT INTO inventory (product_name, quantity, price) VALUES (?, ?, ?)');

insertUser.run('John Doe', '919876543210');
insertUser.run('Jane Smith', '919876543211');
insertUser.run('Alice Johnson', '919876543212');
insertUser.run('Bob Brown', '919876543213');
insertUser.run('Charlie Davis', '919876543214');

insertPatient.run(1, '1980-05-15', 'Male', '123 Main St, City');
insertPatient.run(2, '1992-11-23', 'Female', '456 Elm St, City');
insertPatient.run(3, '1985-07-30', 'Female', '789 Maple St, City');
insertPatient.run(4, '1978-01-12', 'Male', '321 Oak St, City');
insertPatient.run(5, '1990-09-05', 'Male', '654 Pine St, City');

insertDoctor.run('Dr. Emily White', 'Cardiology', '919876543215');
insertDoctor.run('Dr. Michael Green', 'Neurology', '919876543216');
insertDoctor.run('Dr. Sarah Black', 'Pediatrics', '919876543217');
insertDoctor.run('Dr. David Blue', 'Orthopedics', '919876543218');
insertDoctor.run('Dr. Linda Yellow', 'Dermatology', '919876543219');

insertAppointment.run(1, 1, '2023-10-15 10:00:00', 'scheduled');
insertAppointment.run(2, 2, '2023-10-16 11:00:00', 'scheduled');
insertAppointment.run(3, 3, '2023-10-17 09:00:00', 'scheduled');
insertAppointment.run(4, 4, '2023-10-18 14:00:00', 'scheduled');
insertAppointment.run(5, 5, '2023-10-19 15:00:00', 'scheduled');

insertInventory.run('Aspirin', 100, 5.0);
insertInventory.run('Paracetamol', 200, 3.0);
insertInventory.run('Bandages', 150, 1.5);
insertInventory.run('Antibiotic Cream', 50, 10.0);
insertInventory.run('Cough Syrup', 75, 7.5);

module.exports = db;