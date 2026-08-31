import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { assetRegister, assetVehicleDetails, organizations, schools, transportVehicles } from "../shared/schema";

const normalize = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const schoolRows = await db.select({ id: schools.id, name: schools.name, organizationId: schools.organizationId }).from(schools);
  const assets = await db.select({ asset: assetRegister, details: assetVehicleDetails })
    .from(assetRegister)
    .leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id))
    .where(eq(assetRegister.assetClass, "vehicle"));
  const transport = await db.select().from(transportVehicles);
  const exact: any[] = [];
  const probable: any[] = [];
  const assetOnly: any[] = [];
  const conflicts: any[] = [];
  const matchedTransportIds = new Set<number>();

  for (const row of assets) {
    const reg = normalize(row.details?.registrationNumber);
    const vin = normalize(row.details?.vin);
    const engine = normalize(row.details?.engineNumber);
    const sameSchool = transport.filter((v) => !row.asset.schoolId || v.schoolId === row.asset.schoolId);
    const vinMatches = vin ? sameSchool.filter((v: any) => normalize((v as any).vin) === vin) : [];
    const regMatches = reg ? sameSchool.filter((v) => normalize(v.registrationNumber) === reg) : [];
    const candidates = vinMatches.length ? vinMatches : regMatches;
    if (candidates.length === 1) {
      const v = candidates[0]; matchedTransportIds.add(v.id);
      const makeModel = normalize(v.makeModel);
      const assetMakeModel = normalize(`${row.details?.make || ""}${row.details?.model || ""}`);
      (vinMatches.length || !assetMakeModel || !makeModel || makeModel.includes(assetMakeModel) || assetMakeModel.includes(makeModel) ? exact : probable).push({
        assetId: row.asset.id, assetNumber: row.asset.assetNumber, registration: row.details?.registrationNumber, transportVehicleId: v.id, transportRegistration: v.registrationNumber, schoolId: row.asset.schoolId,
      });
    } else if (candidates.length > 1) {
      conflicts.push({ assetId: row.asset.id, assetNumber: row.asset.assetNumber, registration: row.details?.registrationNumber, candidateTransportVehicleIds: candidates.map((v) => v.id) });
    } else {
      assetOnly.push({ assetId: row.asset.id, assetNumber: row.asset.assetNumber, registration: row.details?.registrationNumber, schoolId: row.asset.schoolId });
    }
  }

  const transportOnly = transport.filter((v) => !matchedTransportIds.has(v.id)).map((v) => ({
    transportVehicleId: v.id, registration: v.registrationNumber, ownershipType: v.ownershipType, schoolId: v.schoolId,
  }));

  const summary = {
    mode: "READ_ONLY",
    organisations: orgs.length,
    vehicleAssets: assets.length,
    transportVehicles: transport.length,
    exactMatches: exact.length,
    probableMatches: probable.length,
    assetOnly: assetOnly.length,
    transportOnly: transportOnly.length,
    conflicts: conflicts.length,
  };
  console.log(JSON.stringify({ summary }, null, 2));
  for (const [classification, rows] of Object.entries({ exact, probable, assetOnly, transportOnly, conflicts })) {
    console.log(`\n# ${classification} (${rows.length})`);
    for (const row of rows) console.log(JSON.stringify(row));
  }
  console.log("\nNo records were changed. Confirm probable/conflict matches manually before linking Fleet profiles.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pool.end(); });
