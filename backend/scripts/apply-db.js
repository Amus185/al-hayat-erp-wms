// One-shot script to apply schema.sql then seed.sql to Supabase
// Uses the Supabase REST API (PostgREST) to detect connectivity,
// then tries multiple connection strings
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Supabase direct DB — try multiple hostnames Supabase provides
const PROJECT = 'hhlaaxnavljaskemnzmv';
const PASSWORD = 'WPEaZSFAeEnYht8C';

const connectionStrings = [
  // IPv4 direct
  `postgresql://postgres.${PROJECT}:${PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  // IPv4 Session Pooler (port 5432)
  `postgresql://postgres.${PROJECT}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  // IPv4 Transaction Pooler (port 6543)
  `postgresql://postgres.${PROJECT}:${PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${PROJECT}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  // Standard direct
  `postgresql://postgres:${PASSWORD}@db.${PROJECT}.supabase.co:5432/postgres`,
];

async function tryConnect(connectionString) {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    console.log('Connected via:', connectionString.split('@')[1]);
    return client;
  } catch (e) {
    console.log('Failed:', connectionString.split('@')[1], '-', e.message);
    try { await client.end(); } catch {}
    return null;
  }
}

async function run() {
  let client = null;
  for (const cs of connectionStrings) {
    client = await tryConnect(cs);
    if (client) break;
  }

  if (!client) {
    console.error('Could not connect to Supabase with any connection string.');
    console.log('\n📋 MANUAL OPTION: Copy the SQL from database/schema.sql and database/seed.sql');
    console.log('   into the Supabase SQL Editor at: https://supabase.com/dashboard/project/' + PROJECT + '/sql/new');
    process.exit(1);
  }

  // Apply schema
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  try {
    await client.query(schema);
    console.log('✅ schema.sql applied successfully');
  } catch (e) {
    if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
      console.log('⚠️  Schema already exists — skipping (tables already present)');
    } else {
      console.error('Schema error:', e.message);
    }
  }

  // Apply seed
  const seed = fs.readFileSync(path.join(__dirname, '../database/seed.sql'), 'utf8');
  try {
    await client.query(seed);
    console.log('✅ seed.sql applied successfully');
  } catch (e) {
    if (e.message && (e.message.includes('duplicate key') || e.message.includes('already exists'))) {
      console.log('⚠️  Seed data already exists — skipping');
    } else {
      console.error('Seed error (non-fatal):', e.message);
    }
  }

  await client.end();
  console.log('\n✅ Done! Supabase database is ready.');
}

run().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
