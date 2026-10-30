#!/usr/bin/env python3
"""FCGS Option A: explicitly approved, AWS KMS-signed Windows Gate Bridge release.

Run ONLY from an independently trusted copy in the release operator's AWS
CloudShell. A GitHub Actions artifact is never trusted as executable code.
The signer does not publish/approve a release or contact operational Bridges.
"""

import argparse
import base64
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import zipfile

KMS_KEY_ARN = 'arn:aws:kms:af-south-1:359793380982:key/c746a4fa-cfeb-444a-90b3-a6055b799d00'
KMS_REGION = 'af-south-1'
PINNED_PUBLIC_DER_SHA256 = '30cbeea524bc83633081a6cfb7a798e22b74cc1099fa88ca62d29a22f495942c'
OPERATOR_ARN = 'arn:aws:iam::359793380982:user/fcgs-release-operator'
REPOSITORY = 'firstchoicegroupzw/fcgs-portal'
ASSET_NAMES = (
    'node.exe', 'FCGSGateBridgeService.exe', 'gate-bridge.cjs',
    'Start-GateBridge.ps1', 'Update-GateBridge.ps1',
    'LICENSE-Node.txt', 'LICENSE-WinSW.txt', 'THIRD_PARTY_NOTICES.md',
)
MAX_PACKAGE_UNCOMPRESSED = 245_000_000
MAX_PER_ASSET = 150_000_000
MANIFEST_MAX = 6144
HEX_SHA256 = re.compile(r'^[0-9a-f]{64}$')
COMMIT_SHA = re.compile(r'^[0-9a-f]{40}$')
RELEASE_ID = re.compile(r'^[A-Za-z0-9_-]{5,100}$')
VERSION = re.compile(r'^fcgs-gate-bridge/\d+\.\d+\.\d+$')


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def no_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def aws(*args, output='json'):
    cmd = ['aws', *args, '--region', KMS_REGION, '--no-cli-pager', '--output', output]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=90)
    if proc.returncode:
        # CLI errors are not swallowed: this includes MFA/session/key-policy denial.
        raise RuntimeError(f'AWS command failed ({args[0]} {args[1] if len(args)>1 else ""}): {proc.stderr.strip()[:700]}')
    return json.loads(proc.stdout) if output == 'json' else proc.stdout.strip()


def validate_unsigned_zip(path, expected_manifest_sha256, expected_commit, expected_release_id):
    expected_names = {'manifest.json', *(f'assets/{n}' for n in ASSET_NAMES)}
    with zipfile.ZipFile(path, 'r') as bundle:
        all_entries = bundle.infolist()
        files = [entry for entry in all_entries if not entry.is_dir()]
        names = [entry.filename for entry in files]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entries are forbidden')
        if set(names) != expected_names:
            raise ValueError(f'Unexpected or missing unsigned ZIP files: {sorted(set(names) ^ expected_names)}')
        uncompressed = 0
        for entry in all_entries:
            if entry.filename.startswith('/') or '\\' in entry.filename or '..' in entry.filename.split('/'):
                raise ValueError('Unsafe ZIP file path')
            mode = (entry.external_attr >> 16) & 0xFFFF
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise ValueError('Symbolic links are forbidden in an unsigned release')
            if entry.is_dir():
                if entry.filename != 'assets/':
                    raise ValueError('Unexpected ZIP directory')
                continue
            if entry.file_size <= 0 or entry.file_size > MAX_PER_ASSET:
                raise ValueError(f'Invalid ZIP entry size: {entry.filename}')
            uncompressed += entry.file_size
            if uncompressed > MAX_PACKAGE_UNCOMPRESSED:
                raise ValueError('ZIP release exceeds the maximum uncompressed size')
        manifest_bytes = bundle.read('manifest.json')
        if not manifest_bytes.endswith(b'\n') or len(manifest_bytes) > MANIFEST_MAX:
            raise ValueError('Invalid manifest byte format')
        digest = sha256(manifest_bytes)
        if digest != expected_manifest_sha256:
            raise ValueError(f'Manifest fingerprint does not match independently reviewed GitHub output: {digest}')
        manifest = json.loads(manifest_bytes.decode('utf-8'), object_pairs_hook=no_duplicate_json_keys)
        if not isinstance(manifest, dict):
            raise ValueError('Expected a JSON object manifest')
        if manifest.get('releaseId') != expected_release_id or not RELEASE_ID.fullmatch(expected_release_id):
            raise ValueError('Release ID not explicitly approved')
        if not VERSION.fullmatch(str(manifest.get('version', ''))):
            raise ValueError('Invalid Bridge version')
        if manifest.get('sourceRepository') != REPOSITORY:
            raise ValueError('Release did not originate from expected repository')
        if manifest.get('sourceCommit') != expected_commit or not COMMIT_SHA.fullmatch(expected_commit):
            raise ValueError('GitHub source commit does not match the separately reviewed commit')
        if not re.fullmatch(r'[1-9]\d*', str(manifest.get('githubRunId', ''))):
            raise ValueError('Missing GitHub run ID')
        if not re.fullmatch(r'[1-9]\d*', str(manifest.get('githubRunAttempt', ''))):
            raise ValueError('Missing GitHub run attempt')
        if manifest.get('platform') != 'win32-x64' or manifest.get('protocolVersion') != 1:
            raise ValueError('Unsupported update platform or protocol')
        assets = manifest.get('assets')
        if not isinstance(assets, list) or len(assets) != len(ASSET_NAMES):
            raise ValueError('Unexpected asset inventory')
        if {a.get('name') for a in assets if isinstance(a, dict)} != set(ASSET_NAMES):
            raise ValueError('Incorrect asset names')
        signed_assets = {}
        for asset in assets:
            if not isinstance(asset, dict):
                raise ValueError('Malformed asset description')
            name = asset['name']
            data = bundle.read('assets/' + name)
            if (not isinstance(asset.get('size'), int) or isinstance(asset.get('size'), bool)
                or len(data) != asset['size'] or len(data) < 8 or len(data) > MAX_PER_ASSET
                or not isinstance(asset.get('sha256'), str)
                or not HEX_SHA256.fullmatch(asset['sha256']) or sha256(data) != asset['sha256']):
                raise ValueError(f'Asset integrity check failed: {name}')
            signed_assets[name] = data
        return manifest_bytes, manifest, signed_assets


def write_signed_zip(target, manifest_bytes, signature, assets):
    if target.exists():
        raise FileExistsError(f'Output already exists; refusing overwrite: {target}')
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as signed:
        signed.writestr('manifest.json', manifest_bytes)
        signed.writestr('manifest.sig', signature)
        signed.writestr('signer-key-id.txt', KMS_KEY_ARN + '\n')
        for name in ASSET_NAMES:
            signed.writestr('assets/' + name, assets[name])


def perform_sign(args):
    expected_sha = args.expect_manifest_sha256.lower()
    commit = args.expect_commit.lower()
    if not HEX_SHA256.fullmatch(expected_sha) or not COMMIT_SHA.fullmatch(commit):
        raise ValueError('A reviewed manifest SHA-256 and full GitHub commit are mandatory')
    if not RELEASE_ID.fullmatch(args.approve_release_id):
        raise ValueError('Invalid release ID')
    if not (8 <= len(args.approval_reference.strip()) <= 120):
        raise ValueError('Approval reference must be 8–120 characters')

    manifest_bytes, manifest, assets = validate_unsigned_zip(
        args.unsigned_zip, expected_sha, commit, args.approve_release_id)

    # Verify identity and trusted key before showing the approval prompt.
    operator = aws('sts', 'get-caller-identity')
    if operator.get('Arn') != OPERATOR_ARN:
        raise PermissionError(f'Wrong signing identity: {operator.get("Arn")}')
    metadata = aws('kms', 'describe-key', '--key-id', KMS_KEY_ARN)['KeyMetadata']
    if (metadata.get('Arn') != KMS_KEY_ARN or metadata.get('KeyState') != 'Enabled'
        or metadata.get('KeyUsage') != 'SIGN_VERIFY'
        or metadata.get('KeySpec') != 'ECC_NIST_EDWARDS25519'):
        raise RuntimeError('KMS signing key metadata is inconsistent with approved key')
    public = aws('kms', 'get-public-key', '--key-id', KMS_KEY_ARN)
    public_der = base64.b64decode(public['PublicKey'], validate=True)
    if sha256(public_der) != PINNED_PUBLIC_DER_SHA256:
        raise RuntimeError('KMS public verification key fingerprint mismatch')
    if 'ED25519_SHA_512' not in public.get('SigningAlgorithms', []):
        raise RuntimeError('Expected Ed25519 signing algorithm is unavailable')

    print('\nFCGS GATE BRIDGE RELEASE — MANUAL SECURITY APPROVAL')
    print('  AWS signing identity:', OPERATOR_ARN)
    print('  GitHub repository:   ', manifest['sourceRepository'])
    print('  Source commit:       ', manifest['sourceCommit'])
    print('  GitHub run:          ', manifest['githubRunId'], 'attempt', manifest['githubRunAttempt'])
    print('  Release ID:          ', manifest['releaseId'])
    print('  Version:             ', manifest['version'])
    print('  Manifest SHA-256:    ', expected_sha)
    print('  Asset count:          8, all exact-byte hashes verified')
    print('  Pinned KMS public key:', PINNED_PUBLIC_DER_SHA256)
    print('  Approval reference:  ', args.approval_reference)
    print('  Does NOT publish, approve for installation, or affect Windows devices.')
    print('\nReview the actual source commit, workflow test logs and manifest SHA in GitHub.')
    expected_phrase = f'SIGN {args.approve_release_id} {expected_sha[:12]}'
    if input(f'\nTo authorise KMS signing, type exactly: {expected_phrase}\n> ').strip() != expected_phrase:
        raise PermissionError('Explicit per-release approval was not granted')

    with tempfile.TemporaryDirectory(prefix='fcgs-kms-sign-') as tmp:
        temp = Path(tmp)
        (temp / 'manifest.json').write_bytes(manifest_bytes)
        signed = aws('kms', 'sign', '--key-id', KMS_KEY_ARN,
            '--message', 'fileb://' + str(temp / 'manifest.json'),
            '--message-type', 'RAW', '--signing-algorithm', 'ED25519_SHA_512')
        signature = base64.b64decode(signed['Signature'], validate=True)
        if len(signature) != 64 or signed.get('SigningAlgorithm') != 'ED25519_SHA_512':
            raise RuntimeError('Unexpected KMS signature size or algorithm')
        (temp / 'manifest.sig').write_bytes(signature)
        checked = aws('kms', 'verify', '--key-id', KMS_KEY_ARN,
            '--message', 'fileb://' + str(temp / 'manifest.json'),
            '--message-type', 'RAW', '--signature', 'fileb://' + str(temp / 'manifest.sig'),
            '--signing-algorithm', 'ED25519_SHA_512')
        if checked.get('SignatureValid') is not True:
            raise RuntimeError('AWS rejected the signature verification')
        # Independent Ed25519 verification (same algorithm as Portal/Windows Node crypto).
        (temp / 'public.der').write_bytes(public_der)
        with (temp / 'public.pem').open('wb') as handle:
            subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', str(temp / 'public.der')],
                check=True, stdout=handle, timeout=30)
        offline = subprocess.run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', str(temp / 'public.pem'),
            '-sigfile', str(temp / 'manifest.sig'), '-rawin', '-in', str(temp / 'manifest.json')],
            capture_output=True, text=True, timeout=30)
        if offline.returncode != 0:
            raise RuntimeError('Independent Ed25519 verification failed: ' + offline.stderr[:350])

    output = args.output.resolve()
    audit_path = output.with_suffix('.approval.json')
    if output.exists() or audit_path.exists():
        raise FileExistsError('Signed output or approval record already exists; use a fresh destination')
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        write_signed_zip(output, manifest_bytes, signature, assets)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    audit = {
        'approvedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'approvalReference': args.approval_reference,
        'operatorArn': OPERATOR_ARN,
        'kmsSigningKeyArn': KMS_KEY_ARN,
        'releaseId': manifest['releaseId'],
        'version': manifest['version'],
        'sourceCommit': manifest['sourceCommit'],
        'githubRunId': manifest['githubRunId'],
        'githubRunAttempt': manifest['githubRunAttempt'],
        'manifestSha256': expected_sha,
        'signatureSha256': sha256(signature),
        'signedBundleSha256': sha256(output.read_bytes()),
    }
    audit_path.write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
    print('\nSIGNATURE VERIFIED by both AWS KMS and local Ed25519.')
    print('SIGNED PACKAGE: ', output)
    print('SIGNED ZIP SHA: ', audit['signedBundleSha256'])
    print('APPROVAL RECORD:', audit_path)
    print('NOT PUBLISHED OR APPROVED IN THE PORTAL. Automatic updates remain disabled.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('unsigned_zip', type=Path, help='Downloaded GitHub Actions UNSIGNED artifact ZIP')
    parser.add_argument('--expect-manifest-sha256', required=True,
        help='64-digit SHA from approved GitHub Actions preparation log (not copied from the ZIP)')
    parser.add_argument('--expect-commit', required=True,
        help='Full 40-character GitHub source commit from the reviewed Actions run')
    parser.add_argument('--approve-release-id', required=True)
    parser.add_argument('--approval-reference', required=True,
        help='FCGS change/ticket reference, e.g. FCGS-BRIDGE-2026-001')
    parser.add_argument('--output', required=True, type=Path,
        help='NEW signed release ZIP destination')
    args = parser.parse_args()
    perform_sign(args)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError, PermissionError, zipfile.BadZipFile, subprocess.TimeoutExpired) as exc:
        print('RELEASE SIGNING REFUSED:', str(exc), file=sys.stderr)
        sys.exit(1)
