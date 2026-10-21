"""Operator-only binding setup. No credentials in argv, stdout, or package files."""
import argparse
import json
import os
import re
import secrets
from pathlib import Path

from service import Bridge, BridgeError, private_read


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True, help="Approved fixed backend process home")
    parser.add_argument("--origin", required=True, help="Exact HTTPS Pipe origin; no path or credentials")
    parser.add_argument("--token-file", type=Path, required=True, help="Existing private file from Pipe issue-token")
    parser.add_argument("--profile", required=True, help="Fixed backend profile label (comparison only)")
    parser.add_argument("--auth-mode", choices=["verified-session", "local-process-capability", "agent-only"], default="verified-session")
    parser.add_argument("--provider")
    parser.add_argument("--user-id")
    parser.add_argument("--org-id")
    parser.add_argument("--grant-single-workspace", action="store_true", required=True)
    parser.add_argument("--grant-agent-process", action="store_true")
    parser.add_argument("--grant-local-process", action="store_true")
    parser.add_argument("--allow-loopback-http", action="store_true", help="Only numeric loopback origins; never LAN/plain HTTP")
    args = parser.parse_args()
    try:
        if args.home.is_symlink() or args.token_file.is_symlink():
            raise ValueError
        home = args.home.resolve(strict=True)
        token_file = args.token_file.resolve(strict=True)
        raw = private_read(token_file, 128).decode("ascii").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", raw):
            raise ValueError
        principal = None
        if args.auth_mode == "verified-session":
            if not args.provider or not args.user_id or args.org_id is None or args.grant_local_process:
                raise ValueError
            principal = {"provider": args.provider, "user_id": args.user_id, "org_id": args.org_id}
        else:
            if any(v is not None for v in (args.provider, args.user_id, args.org_id)):
                raise ValueError
            if args.auth_mode == "agent-only":
                if not args.grant_agent_process or args.grant_local_process:
                    raise ValueError
            elif not args.grant_local_process:
                raise ValueError
        config = {"deployment_home": str(home), "binding_id": secrets.token_hex(12),
                  "generation": secrets.token_hex(12), "profile": args.profile, "origin": args.origin,
                  "token_file": str(token_file), "auth_mode": args.auth_mode, "principal": principal,
                  "agent_process_grant": args.grant_agent_process,
                  "local_process_grant": args.grant_local_process, "allow_loopback_http": args.allow_loopback_http}
        Bridge(config, home)
        path = home / "pipe-bridge.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(config, file, indent=2)
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        print("Pipe binding created. No credentials displayed. Review the fixed host policy before enabling.")
    except (OSError, ValueError, UnicodeError, BridgeError):
        parser.exit(1, "Binding not created. Check explicit grants, identity, origin, private token file and unused destination. Existing files were not replaced.\n")


if __name__ == "__main__":
    main()
