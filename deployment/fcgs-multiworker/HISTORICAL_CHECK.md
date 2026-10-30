# Historical runtime double-check

Checked against the current Git repository/history and the August 2026 production handover/runtime documentation supplied with the FCGS project.

Findings:

- The current tracked repository history contains no PM2 `ecosystem` configuration or other committed PM2 worker definition.
- The August 2026 handover explicitly records that production process management is **systemd, not PM2**.
- The August 2026 production runtime snapshot records one `fcgs.service` Node process behind Nginx at `127.0.0.1:5000`.
- Therefore the previously remembered four-PM2-worker arrangement was removed before the current documented baseline and appears to have been an operational/server configuration rather than a surviving tracked repository configuration.

This build intentionally does not restore PM2. It implements the deferred improvement as four independent systemd workers behind the existing Nginx TLS endpoint, with application changes required for safe horizontal execution inside the same EC2 host.
