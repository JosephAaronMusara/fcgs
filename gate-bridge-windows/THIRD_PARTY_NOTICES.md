# FCGS Gate Bridge Windows third-party runtime

The production Windows Gate Bridge package uses pinned third-party runtime components. They are prepared on the FCGS build/deployment server, checksum-verified, and then served to the one-time Windows installer through the FCGS Portal.

- Node.js 22.16.0 Windows x64 `node.exe` - official Node.js distribution. SHA-256: `c5ff4c736112dd483c750fd4149d30c8a116db1a49b8b3ec88be4b65e6c86c19`.
- WinSW 2.12.0 Windows x64 `WinSW-x64.exe`, renamed to `FCGSGateBridgeService.exe` - MIT licensed Windows Service wrapper. SHA-256: `05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da`.

Run `npm run gate:bridge:prepare-windows-runtime` once on a build/deployment machine with outbound internet access. The preparation script downloads only these pinned URLs and rejects binaries whose SHA-256 does not match the pinned value. It also downloads the corresponding Node.js and WinSW license files into the release assets directory.

The FCGS production mini-PC installer never downloads these components directly from third-party sites. It downloads the already-pinned release from the FCGS Portal and independently verifies the SHA-256 manifest before installation.
