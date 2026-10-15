/** Preserves all protocol-1.1 capabilities for newer compatible Bridge releases. */
export function gateBridgeSupports(softwareVersion: string | null | undefined, min: string): boolean {
 const m = /^fcgs-gate-bridge\/(\d+)\.(\d+)\.(\d+)$/.exec(softwareVersion || "");
 const target = /^(\d+)\.(\d+)\.(\d+)$/.exec(min);
 if (!m || !target) return false;
 const v = m.slice(1).map(Number), req = target.slice(1).map(Number);
 for (let i=0; i<3; i++) { if(v[i]!==req[i]) return v[i]>req[i]; }
 return true;
}
