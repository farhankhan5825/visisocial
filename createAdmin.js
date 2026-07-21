/**
 * Script to create a default admin user
 * Usage: node createAdmin.js
 */


const dotenv = require('dotenv');
dotenv.config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin'); // Your new Admin model
const config = require('./config/appConfig'); // App config for MONGODB_URI

const MONGODB_URI = config.database?.uri || 'mongodb://localhost:27017/visisocial';

// Admin info - change before running
if (!process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD in your environment before running createAdmin.js');
  process.exit(1);
}
const adminData = {
  name: 'VisiSocial Admin',
  email: process.env.ADMIN_EMAIL || 'admin@visisocial.com',
  password: process.env.ADMIN_PASSWORD,
  role: 'superadmin'
};

(async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const adminCollection = db.collection('admins');

    // Show database info
    const stats = await adminCollection.stats().catch(() => null);
    console.log('Database:', db.databaseName);
    console.log('Host:', mongoose.connection.hosts || mongoose.connection.host);
    if (stats) console.log('Collection stats for "admins":', stats);

    // Check if admin exists
    const existing = await Admin.findOne({ email: adminData.email });
    if (existing) {
      console.log(`⚠️ Admin already exists: ${existing.email}`);
    } else {
      const newAdmin = new Admin(adminData);
      await newAdmin.save();
      console.log('🌟 Admin user created successfully!');
      console.log(`Email: ${adminData.email}`);
      console.log(`Password: ${adminData.password}`);
    }

    // List all admins
    const admins = await Admin.find({}, '-password').lean();
    console.log('\n🌟 Current Admins:');
    admins.forEach(a => {
      console.log(`- ${a.name} | ${a.email} | Role: ${a.role} | Status: ${a.status}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin user:', err);
    process.exit(1);
  }
})();
