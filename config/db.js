// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('🔗 === DATABASE CONNECTION START ===');
    
    // Check all possible environment variables
    const envVars = {
      'MONGODB_URI': process.env.MONGODB_URI,
      'DATABASE_URL': process.env.DATABASE_URL
    };
    
    console.log('📋 Environment variables check:');
    Object.entries(envVars).forEach(([key, value]) => {
      if (value) {
        // Mask password for security
        const masked = value.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
        console.log(`   ✅ ${key}: ${masked}`);
      } else {
        console.log(`   ❌ ${key}: Not set`);
      }
    });
    
    // Determine which connection string to use
    const mongoURI =
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL ||
      'mongodb://localhost:27017/visisocial';
    
    console.log(`🔌 Using connection string: ${mongoURI.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')}`);
    
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4
      retryWrites: true,
      w: 'majority',
      maxPoolSize: 10,
      minPoolSize: 2
    };
    
    console.log('⚙️ Connection options:', JSON.stringify(options, null, 2));
    console.log('⏳ Attempting connection...');
    
    const startTime = Date.now();
    
    await mongoose.connect(mongoURI, options);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Connection successful! (${duration}ms)`);
    console.log(`   Host: ${mongoose.connection.host}`);
    console.log(`   Port: ${mongoose.connection.port}`);
    console.log(`   Database: ${mongoose.connection.name}`);
    console.log(`   Ready State: ${mongoose.connection.readyState}`);
    console.log(`   Models registered: ${Object.keys(mongoose.connection.models).length}`);
    
    // Test the connection with a ping
    try {
      const pingResult = await mongoose.connection.db.admin().ping();
      console.log(`   Ping test: ${JSON.stringify(pingResult)}`);
    } catch (pingErr) {
      console.warn(`   ⚠️ Ping test failed: ${pingErr.message}`);
    }
    
    console.log('🔗 === DATABASE CONNECTION END ===\n');
    
  } catch (error) {
    console.error('❌ === DATABASE CONNECTION FAILED ===');
    console.error(`   Error: ${error.message}`);
    console.error(`   Name: ${error.name}`);
    console.error(`   Code: ${error.code || 'N/A'}`);
    console.error(`   Stack trace: ${error.stack ? error.stack.split('\n')[0] : 'N/A'}`);
    
    // Connection diagnostics
    console.error('\n🔧 DIAGNOSTICS:');
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('   Issue: Connection refused on port 27017');
      console.error('   Possible causes:');
      console.error('     - MongoDB service not running');
      console.error('     - Wrong port number');
      console.error('     - Firewall blocking connection');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('   Issue: Cannot resolve hostname');
      console.error('   Possible causes:');
      console.error('     - Incorrect MongoDB Atlas URL');
      console.error('     - DNS resolution issue');
      console.error('     - Internet connection problem');
    } else if (error.message.includes('auth')) {
      console.error('   Issue: Authentication failed');
      console.error('   Possible causes:');
      console.error('     - Wrong username/password');
      console.error('     - Database user not created in MongoDB Atlas');
      console.error('     - IP not whitelisted in MongoDB Atlas');
    } else if (error.message.includes('timed out')) {
      console.error('   Issue: Connection timeout');
      console.error('   Possible causes:');
      console.error('     - Network latency');
      console.error('     - Server overloaded');
      console.error('     - Firewall blocking');
    }
    
    console.error('❌ === END DIAGNOSTICS ===\n');
    
    throw error;
  }
};

module.exports = connectDB;