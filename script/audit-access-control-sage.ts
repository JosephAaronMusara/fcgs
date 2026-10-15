/** Read-only Sage / student association preflight. Safe for production; NO account writes. */
import 'dotenv/config';
import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 await client.connect();
 try{
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '20000ms'");
  const summary=await client.query(`SELECT school_id,
   COUNT(*)::int AS student_records,
   COUNT(*) FILTER (WHERE NULLIF(btrim(fees_customer_id),'') IS NOT NULL)::int AS legacy_sage_ids,
   COUNT(*) FILTER (WHERE NULLIF(btrim(fees_customer_id),'') IS NULL)::int AS missing_sage_ids,
   COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived_records
   FROM students GROUP BY school_id ORDER BY school_id`);
  const duplicate=await client.query(`SELECT school_id,COUNT(*)::int AS collided_identifiers, SUM(n)::int AS records_in_collision
   FROM (SELECT school_id, lower(btrim(fees_customer_id)) AS code,COUNT(*)::int AS n FROM students WHERE nullif(btrim(fees_customer_id),'') IS NOT NULL GROUP BY school_id, lower(btrim(fees_customer_id)) HAVING COUNT(*)>1) x GROUP BY school_id ORDER BY school_id`);
  const seen=await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sage_identity_links') AS installed`);
  console.log('Sage identity READ-ONLY preflight / counts by school (no customer secrets printed)');
  console.table(summary.rows);
  console.log('Legacy duplicate-code groups (require independent verification before uniqueness approval):');console.table(duplicate.rows);
  if(seen.rows[0].installed){
   const links=await client.query(`SELECT school_id,COUNT(*)::int AS verified_links FROM sage_identity_links GROUP BY school_id ORDER BY school_id`);
   console.log('Explicitly verified Sage links:');console.table(links.rows);
   const mismatches=await client.query(`SELECT count(*)::int AS mismatched_visible_ids FROM sage_identity_links x JOIN students s ON s.id=x.student_id WHERE s.school_id <> x.school_id OR lower(btrim(s.fees_customer_id))<>x.normalized_code OR s.fees_customer_id IS NULL`);
   console.log('Verified link/visible ID conflicts:',mismatches.rows[0].mismatched_visible_ids);
  }else console.log('sage_identity_links migration not installed. No associations have been certified by the new workflow.');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e;}finally{await client.end();}
}
main().catch(e=>{console.error('Sage preflight FAILED:',e.message);process.exitCode=1;});
