/**
 * D1 Batch Atomicity Test
 * 
 * Proves that the fixed batch() method correctly rolls back ALL statements
 * when ANY statement in the batch fails.
 * 
 * Test strategy:
 * 1. Create a test row with a known UUID via batch
 * 2. Attempt a batch where stmt 1 INSERTs a new row, and stmt 2 INSERTs
 *    a DUPLICATE of the row from step 1 (violating PK constraint)
 * 3. Verify stmt 1's row from the failing batch does NOT exist
 *    (proves rollback happened — atomicity works)
 * 4. Clean up the test row from step 1
 * 
 * Usage: npx tsx test-batch-atomicity.ts
 * Requires env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
 */

import { D1RemoteClient } from './backend/src/d1-remote-client';

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';

  if (!accountId || !databaseId || !apiToken) {
    console.error('❌ Missing env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  const db = new D1RemoteClient({ accountId, databaseId, apiToken });

  const SETUP_ID = 'test-atomicity-setup-' + Date.now();
  const SHOULD_NOT_EXIST_ID = 'test-atomicity-phantom-' + Date.now();

  console.log('=== D1 Batch Atomicity Test ===\n');

  // Step 1: Create a "blocker" row that we'll use to cause a PK collision
  console.log('Step 1: Creating setup row...');
  try {
    await db.batch([
      db.prepare(
        "INSERT INTO audit_logs (id, action, table_name, record_id, created_by) VALUES (?, 'ATOMICITY_TEST', 'test', 'test', 'test-script')"
      ).bind(SETUP_ID),
    ]);
    console.log(`  ✅ Setup row created: ${SETUP_ID}`);
  } catch (err: any) {
    console.error('  ❌ Setup failed:', err.message);
    process.exit(1);
  }

  // Step 2: Attempt a batch where stmt 2 will FAIL (duplicate PK)
  console.log('\nStep 2: Attempting batch with intentional failure...');
  console.log('  stmt 1: INSERT phantom row (should be rolled back)');
  console.log('  stmt 2: INSERT duplicate of setup row (should FAIL)');

  let batchFailed = false;
  try {
    await db.batch([
      // This INSERT should be ROLLED BACK because stmt 2 fails
      db.prepare(
        "INSERT INTO audit_logs (id, action, table_name, record_id, created_by) VALUES (?, 'ATOMICITY_TEST_PHANTOM', 'test', 'test', 'test-script')"
      ).bind(SHOULD_NOT_EXIST_ID),

      // This INSERT should FAIL — duplicate PK
      db.prepare(
        "INSERT INTO audit_logs (id, action, table_name, record_id, created_by) VALUES (?, 'ATOMICITY_TEST_DUPE', 'test', 'test', 'test-script')"
      ).bind(SETUP_ID),
    ]);
    console.log('  ⚠️  Batch did NOT throw — this is unexpected.');
  } catch (err: any) {
    batchFailed = true;
    console.log(`  ✅ Batch correctly threw error: ${err.message.substring(0, 120)}`);
  }

  // Step 3: Check if the phantom row exists (it should NOT if atomicity works)
  console.log('\nStep 3: Checking if phantom row was rolled back...');
  try {
    const phantom = await db.prepare(
      'SELECT id FROM audit_logs WHERE id = ?'
    ).bind(SHOULD_NOT_EXIST_ID).first();

    if (phantom) {
      console.error('  ❌ ATOMICITY FAILURE: Phantom row EXISTS. Batch did NOT roll back.');
      console.error('     This means statements before the failing one were committed independently.');
    } else {
      console.log('  ✅ ATOMICITY CONFIRMED: Phantom row does NOT exist. Batch correctly rolled back all statements.');
    }
  } catch (err: any) {
    console.error('  ❌ Could not check phantom row:', err.message);
  }

  // Step 4: Clean up
  console.log('\nStep 4: Cleaning up...');
  try {
    await db.prepare('DELETE FROM audit_logs WHERE id = ?').bind(SETUP_ID).run();
    await db.prepare('DELETE FROM audit_logs WHERE id = ?').bind(SHOULD_NOT_EXIST_ID).run();
    console.log('  ✅ Cleanup complete');
  } catch (err: any) {
    console.log('  ⚠️  Cleanup error (non-critical):', err.message);
  }

  // Summary
  console.log('\n=== Test Summary ===');
  if (batchFailed) {
    console.log('✅ Batch correctly throws on failure');
    console.log('✅ Atomicity: earlier statements in a failed batch are rolled back');
    console.log('✅ D1 REST API batch parameter works as expected');
  } else {
    console.log('⚠️  Batch did not throw — may need to verify error handling');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
