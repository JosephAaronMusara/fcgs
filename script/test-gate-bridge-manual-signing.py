#!/usr/bin/env python3
"""Offline security regression tests for the manual KMS signing handoff."""
import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('signer', HERE / 'fcgs-gate-bridge-manual-sign.py')
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


class SigningSecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='fcgs-release-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        for i, name in enumerate(signer.ASSET_NAMES):
            (self.assets / name).write_bytes((f'safe synthetic fixture number {i} ' * 4).encode('utf-8'))
        self.release = 'fcgs_test_111'
        self.version = 'fcgs-gate-bridge/1.1.1'
        self.commit = 'f' * 40
        self.output_dir = self.root / 'unsigned'
        self.node = subprocess.run(['node', str(HERE / 'gate-bridge-create-release-manifest.mjs'),
           self.version, self.release, str(self.assets), str(self.output_dir)],
           env={**os.environ, 'FCGS_RELEASE_SOURCE_COMMIT': self.commit,
                'FCGS_RELEASE_GITHUB_RUN_ID':'548201', 'FCGS_RELEASE_GITHUB_RUN_ATTEMPT':'1'},
           capture_output=True, text=True)
        if self.node.returncode:
            self.fail('Real manifest generator failed: ' + self.node.stderr)
        self.manifest = (self.output_dir / 'manifest.json').read_bytes()
        self.digest = hashlib.sha256(self.manifest).hexdigest()
        self.unsigned_zip = self.root / 'unsigned.zip'
        self.make_zip()

    def make_zip(self, override=None, duplicate=False):
        override = override or {}
        with zipfile.ZipFile(self.unsigned_zip, 'w') as z:
            z.writestr('manifest.json', override.get('manifest.json', self.manifest))
            for name in signer.ASSET_NAMES:
                entry = 'assets/' + name
                z.writestr(entry, override.get(entry, (self.assets / name).read_bytes()))
            if duplicate:
                z.writestr('manifest.json', self.manifest)

    def validate(self):
        return signer.validate_unsigned_zip(self.unsigned_zip, self.digest, self.commit, self.release)

    def test_valid_unsigned_package_is_accepted_for_review(self):
        contents, info, assets = self.validate()
        self.assertEqual(contents, self.manifest)
        self.assertEqual(info['sourceCommit'], self.commit)
        self.assertEqual(info['sourceRepository'], signer.REPOSITORY)
        self.assertEqual(len(assets), 8)

    def test_modified_manifest_fails(self):
        self.make_zip({'manifest.json': self.manifest.replace(b'1.1.1', b'1.1.2')})
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            self.validate()

    def test_modified_asset_fails(self):
        self.make_zip({'assets/node.exe': b'malicious payload bytes'})
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.validate()

    def test_wrong_source_commit_fails(self):
        with self.assertRaisesRegex(ValueError, 'commit'):
            signer.validate_unsigned_zip(self.unsigned_zip, self.digest, 'a'*40, self.release)

    def test_missing_explicit_sha_fails(self):
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            signer.validate_unsigned_zip(self.unsigned_zip, '0'*64, self.commit, self.release)

    def test_duplicate_zip_file_fails(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            self.make_zip(duplicate=True)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.validate()

    def test_extra_files_fail(self):
        with zipfile.ZipFile(self.unsigned_zip, 'a') as z:
            z.writestr('signing-private-key.pem', 'FORBIDDEN')
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            self.validate()

    def test_unapproved_release_id_fails(self):
        with self.assertRaisesRegex(ValueError, 'Release ID'):
            signer.validate_unsigned_zip(self.unsigned_zip, self.digest, self.commit, 'different_id')

    def test_untrusted_operator_denied_before_signing(self):
        args = self.arguments()
        def fake_aws(*params, **kw):
            if params[:2] == ('sts', 'get-caller-identity'):
                return {'Arn': 'arn:aws:iam::359793380982:root'}
            self.fail('No KMS calls may happen under root')
        with patch.object(signer, 'aws', side_effect=fake_aws):
            with self.assertRaises(PermissionError):
                signer.perform_sign(args)
        self.assertFalse(args.output.exists())

    def arguments(self):
        class Args: pass
        a = Args()
        a.unsigned_zip = self.unsigned_zip
        a.expect_manifest_sha256 = self.digest
        a.expect_commit = self.commit
        a.approve_release_id = self.release
        a.approval_reference = 'FCGS-CHANGE-TEST-001'
        a.output = self.root / 'signed.zip'
        return a

    def test_signing_handoff_with_independent_ed25519(self):
        # Fully exercise signing, independent verification and signed ZIP format
        # using a temporary OpenSSL test key. No AWS/private production credentials.
        private = self.root / 'test-private.pem'
        public_pem = self.root / 'test-public.pem'
        public_der = self.root / 'test-public.der'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', str(private)], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(private), '-pubout', '-out', str(public_pem)], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(private), '-pubout', '-outform', 'DER', '-out', str(public_der)], check=True, capture_output=True)
        der = public_der.read_bytes()
        def fake_aws(*params, **kw):
            if params[:2] == ('sts', 'get-caller-identity'):
                return {'Arn': signer.OPERATOR_ARN}
            if params[:2] == ('kms', 'describe-key'):
                return {'KeyMetadata': {'Arn': signer.KMS_KEY_ARN, 'KeyState': 'Enabled', 'KeyUsage': 'SIGN_VERIFY', 'KeySpec': 'ECC_NIST_EDWARDS25519'}}
            if params[:2] == ('kms', 'get-public-key'):
                return {'PublicKey': base64.b64encode(der).decode(), 'SigningAlgorithms':['ED25519_SHA_512']}
            if params[:2] == ('kms', 'sign'):
                message_file = Path(params[params.index('--message')+1].removeprefix('fileb://'))
                signature_file = self.root / 'local-signature'
                subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(private), '-rawin', '-in', str(message_file), '-out', str(signature_file)], check=True, capture_output=True)
                return {'Signature': base64.b64encode(signature_file.read_bytes()).decode(), 'SigningAlgorithm': 'ED25519_SHA_512'}
            if params[:2] == ('kms', 'verify'):
                return {'SignatureValid': True}
            self.fail('Unexpected fake AWS API call ' + str(params))
        args = self.arguments()
        expected_phrase = f'SIGN {self.release} {self.digest[:12]}'
        with patch.object(signer, 'PINNED_PUBLIC_DER_SHA256', hashlib.sha256(der).hexdigest()), \
             patch.object(signer, 'aws', side_effect=fake_aws), \
             patch('builtins.input', return_value=expected_phrase), \
             redirect_stdout(io.StringIO()):
            signer.perform_sign(args)
        self.assertTrue(args.output.exists())
        self.assertTrue(args.output.with_suffix('.approval.json').exists())
        with zipfile.ZipFile(args.output) as signed:
            self.assertEqual(set(signed.namelist()), {'manifest.json', 'manifest.sig', 'signer-key-id.txt', *(f'assets/{n}' for n in signer.ASSET_NAMES)})
            self.assertEqual(signed.read('manifest.json'), self.manifest)
            self.assertEqual(signed.read('signer-key-id.txt').decode().strip(), signer.KMS_KEY_ARN)
            self.assertEqual(len(signed.read('manifest.sig')), 64)

    def test_no_human_approval_must_not_call_sign(self):
        private = self.root / 'test-private.pem'
        public_der = self.root / 'test-public.der'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', str(private)], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(private), '-pubout', '-outform', 'DER', '-out', str(public_der)], check=True, capture_output=True)
        der = public_der.read_bytes()
        def fake_aws(*params, **kw):
            if params[:2] == ('sts', 'get-caller-identity'):
                return {'Arn': signer.OPERATOR_ARN}
            if params[:2] == ('kms', 'describe-key'):
                return {'KeyMetadata': {'Arn': signer.KMS_KEY_ARN, 'KeyState':'Enabled', 'KeyUsage':'SIGN_VERIFY', 'KeySpec':'ECC_NIST_EDWARDS25519'}}
            if params[:2] == ('kms', 'get-public-key'):
                return {'PublicKey': base64.b64encode(der).decode(), 'SigningAlgorithms':['ED25519_SHA_512']}
            self.fail('KMS Sign should never be called without approval')
        args = self.arguments()
        with patch.object(signer, 'PINNED_PUBLIC_DER_SHA256', hashlib.sha256(der).hexdigest()), \
             patch.object(signer, 'aws', side_effect=fake_aws), \
             patch('builtins.input', return_value='NO'), \
             redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(PermissionError, 'approval'):
                signer.perform_sign(args)
        self.assertFalse(args.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
