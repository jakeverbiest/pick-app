#!/usr/bin/env node
/**
 * repair-precache-seeds.js — one-off repair for the off-center precache
 * seed bug fixed in gridKeysAround() on 2026-09-07.
 *
 * WHY. gridKeysAround() used to store the STEPPED point as each cell's
 * representative fetch point, which preserved the original hand-picked
 * seed's offset within its cell across the whole generated block. 56 of the
 * 1,226 roster tiles ended up seeded ~539m from their own cell centers.
 * refreshStreetTile fetches a 600m disc around that point and files it under
 * the cell key, so those tiles cached the wrong half of their own cell — and
 * because they were the original Brooklyn block they sat at the front of the
 * drip queue, so all 56 were already written (60% of everything cached).
 *
 * Measured on cell 40.67_-74.00: a live fetch at the true cell center matched
 * 196/202 (97%) of that cell's segment_status docs; the cached off-center
 * disc matched 12/202 (6%). Symptom: the map overview showed almost no
 * streets as cleaned, while tapping into the neighborhood (a live whole-ring
 * query that never used these tiles) showed the full history.
 *
 * WHAT THIS DOES.
 *   1. Rewrites the 56 off-center roster entries to their true cell centers.
 *   2. DELETES the precache_streets docs that were written from an off-center
 *      seed. Deleting is deliberate: the client fails OPEN on a precache miss
 *      (OVERPASS_PRECACHE_SPEC.md §3), so those cells simply go back to the
 *      live-Overpass path — correct, just slower — instead of continuing to
 *      serve wrong geometry for up to the 52-day staleness ceiling.
 *   3. Resets the drip cursor to 0 so the recentered Brooklyn block is
 *      re-warmed first (~1.2 days at 8 tiles/4h) rather than in ~25 days.
 *
 * Only tiles whose stored seed is >150m from their cell center are touched;
 * the 38 correctly-centered tiles already cached are left alone.
 *
 * Deploy the gridKeysAround fix BEFORE running this, or the next Monday
 * roster rebuild writes the bad coordinates straight back.
 *
 * Usage:
 *   node repair-precache-seeds.js            # dry run, prints the plan
 *   node repair-precache-seeds.js --apply    # execute
 *
 * Requires ~/.secrets/pick-app/serviceAccountKey.json. Safe to re-run: it
 * recomputes what is off-center each time, so a second run is a no-op.
 */
const admin=require('firebase-admin');
admin.initializeApp({credential:admin.credential.cert(require(process.env.HOME+'/.secrets/pick-app/serviceAccountKey.json'))});
const db=admin.firestore();
const G=0.01, R=6371000, rad=x=>x*Math.PI/180;
const dist=(a,b,c,d)=>{const dLat=rad(c-a),dLon=rad(d-b);const x=Math.sin(dLat/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
const center=k=>{const [a,b]=k.split('_').map(Number);return {lat:a+G/2, lon:b+G/2};};
const DRY = process.argv[2] !== '--apply';
(async()=>{
 const ref=db.doc('precache_meta/nyc_street_roster');
 const r=(await ref.get()).data();
 const badKeys=[];
 const tiles=r.tiles.map(t=>{const c=center(t.key);
   if(dist(t.lat,t.lon,c.lat,c.lon)>150){badKeys.push(t.key); return {...t, lat:c.lat, lon:c.lon};}
   return t;});
 console.log(`${DRY?'DRY RUN':'APPLYING'}`);
 console.log(`roster tiles to recenter: ${badKeys.length} / ${r.tiles.length}`);
 // Only delete cached docs that were WRITTEN from an off-center seed.
 const written=await db.collection('precache_streets').get();
 const toDelete=written.docs.filter(d=>{const x=d.data(); const c=center(d.id);
   return dist(x.seedLat,x.seedLon,c.lat,c.lon)>150;}).map(d=>d.id);
 console.log(`precache_streets docs to delete: ${toDelete.length} / ${written.size}`);
 console.log(`cursor ${r.cursor} -> 0 (re-warm the recentered Brooklyn block first)`);
 if(DRY){console.log('\nre-run with --apply to execute'); process.exit(0);}
 await ref.update({ tiles, cursor: 0, updatedAt: Date.now() });
 console.log('✓ roster recentered, cursor reset');
 for(let i=0;i<toDelete.length;i+=400){
   const b=db.batch(); toDelete.slice(i,i+400).forEach(k=>b.delete(db.collection('precache_streets').doc(k)));
   await b.commit();
 }
 console.log(`✓ deleted ${toDelete.length} poisoned tiles (clients now fail open to live Overpass)`);
 process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
