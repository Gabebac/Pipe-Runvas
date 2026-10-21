"""One operator-bound Pipe service. No user-selected destination or file storage."""
import asyncio
import hmac
import ipaddress
import json
import os
import re
import stat
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 4 * 1024 * 1024
DEADLINE = 10
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
OPERATIONS = {
    "list_projects": ("GET", {"limit", "cursor"}, set()),
    "get_project": ("GET", {"project_id"}, {"project_id"}),
    "create_project": ("POST", {"title"}, {"title"}),
    "list_documents": ("GET", {"project_id"}, {"project_id"}),
    "get_document": ("GET", {"project_id", "document_id"}, {"project_id", "document_id"}),
    "create_document": ("POST", {"project_id", "title", "kind", "content"}, {"project_id", "title", "kind", "content"}),
    "update_document": ("PUT", {"project_id", "document_id", "title", "content", "expected_revision"},
                        {"project_id", "document_id", "title", "content", "expected_revision"}),
}
MESSAGES = {
    401: "Sign in again or ask the operator to renew Pipe access.",
    403: "This identity or profile is not allowed to use this Pipe connection.",
    404: "This project or document was not found.",
    409: "Someone saved a newer version. Your draft has not been applied. Read the latest version before saving again.",
    413: "This request or response is too large for the Pipe bridge.",
    422: "Check the supplied fields and try again.",
    502: "Pipe returned an unsupported response. No automatic retry was made.",
    503: "Pipe is unavailable or not configured. Keep your draft; check the saved version before retrying.",
    504: "The request timed out. A save may have completed. Check the saved version before retrying.",
}


class BridgeError(Exception):
    def __init__(self, status, code, **extra):
        self.status = status
        self.payload = {"code": code, "message": MESSAGES[status], **extra}
        super().__init__(code)


def private_read(path, maximum):
    """Read only an operator-owned regular file; never return its path in errors."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and
                    (info.st_uid != os.getuid() or info.st_mode & 0o077)):
                raise ValueError
            data = file.read(maximum + 1)
            if len(data) > maximum:
                raise ValueError
            return data
    except (OSError, ValueError):
        raise BridgeError(503, "configuration_unavailable") from None


def checked_origin(value, allow_loopback_http):
    try:
        parts = urlsplit(value)
        if (not isinstance(value, str) or len(value) > 2048 or
                parts.scheme not in {"https", "http"} or not parts.hostname or
                parts.username is not None or parts.password is not None or
                parts.path or parts.query or parts.fragment or
                any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value):
            raise ValueError
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError
        if parts.scheme == "http" and not (allow_loopback_http is True and
                ipaddress.ip_address(parts.hostname).is_loopback):
            raise ValueError
        return value
    except (ValueError, TypeError, AttributeError):
        raise BridgeError(503, "invalid_configuration") from None


class Bridge:
    def __init__(self, config, process_home):
        try:
            required = {"deployment_home", "binding_id", "generation", "profile", "origin", "token_file",
                        "auth_mode", "principal", "agent_process_grant", "local_process_grant", "allow_loopback_http"}
            if set(config) != required:
                raise ValueError
            self.home = Path(process_home).resolve(strict=True)
            if str(self.home) != config["deployment_home"]:
                raise ValueError
            for key in ("binding_id", "generation", "profile"):
                if not isinstance(config[key], str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", config[key]):
                    raise ValueError
            for key in ("agent_process_grant", "local_process_grant", "allow_loopback_http"):
                if type(config[key]) is not bool:
                    raise ValueError
            if config["auth_mode"] not in {"verified-session", "local-process-capability", "agent-only"}:
                raise ValueError
            principal = config["principal"]
            if config["auth_mode"] == "agent-only":
                if (principal is not None or config["local_process_grant"] is not False
                        or config["agent_process_grant"] is not True):
                    raise ValueError
            elif config["auth_mode"] == "verified-session":
                if (not isinstance(principal, dict) or set(principal) != {"provider", "user_id", "org_id"}
                        or not all(isinstance(v, str) and len(v) <= 256 for v in principal.values())
                        or not principal["provider"] or not principal["user_id"]):
                    raise ValueError
            elif principal is not None or config["local_process_grant"] is not True:
                raise ValueError
            self.origin = checked_origin(config["origin"], config["allow_loopback_http"])
            self.token_file = Path(config["token_file"])
            if not self.token_file.is_absolute() or self.token_file.is_symlink():
                raise ValueError
            self.config = dict(config)
        except (ValueError, TypeError, KeyError, OSError):
            raise BridgeError(503, "invalid_configuration") from None

    def check_home(self, process_home, active_home):
        if Path(process_home).resolve() != self.home or Path(active_home).resolve() != self.home:
            raise BridgeError(403, "deployment_mismatch")

    def metadata(self):
        return {key: self.config[key] for key in ("binding_id", "generation", "profile", "auth_mode")}

    def authorize_agent(self, process_home, active_home):
        self.check_home(process_home, active_home)
        if self.config["agent_process_grant"] is not True:
            raise BridgeError(403, "agent_grant_required")

    def authorize_http(self, request, process_home, active_home):
        self.check_home(process_home, active_home)
        if self.config["auth_mode"] == "agent-only":
            raise BridgeError(403, "http_disabled")
        # Selectors only reject mismatch; they never choose a home or connection.
        selectors = request.query_params.getlist("profile")
        if len(selectors) > 1 or (selectors and selectors[0] != self.config["profile"]):
            raise BridgeError(403, "profile_mismatch")
        if request.headers.get("origin") is not None:
            raise BridgeError(403, "native_transport_required")
        if self.config["auth_mode"] == "verified-session":
            session = getattr(request.state, "session", None)
            auth = request.headers.getlist("authorization")
            if (getattr(request.app.state, "auth_required", False) is not True or session is None or
                    len(auth) != 1 or not auth[0].startswith("Bearer ") or not auth[0][7:] or
                    not hmac.compare_digest(auth[0][7:].encode(), str(getattr(session, "access_token", "")).encode())):
                raise BridgeError(401, "verified_session_required")
            principal = self.config["principal"]
            if (any(getattr(session, key, None) != value for key, value in principal.items()) or
                    not isinstance(getattr(session, "expires_at", None), (int, float)) or
                    not session.expires_at > time.time()):
                raise BridgeError(403, "principal_not_allowed")
        else:
            # Installed host has no state principal for this mode. Call its real verifier;
            # do not create request.state authentication or treat a header as verified.
            host = sys.modules.get("hermes_cli.web_server")
            if (self.config["local_process_grant"] is not True or host is None or
                    getattr(host, "app", None) is not request.app or
                    getattr(request.app.state, "auth_required", True) is not False or
                    not request.client or request.client.host not in {"127.0.0.1", "::1"} or
                    not host._has_valid_session_token(request)):
                raise BridgeError(401, "local_capability_required")

    def call(self, operation, args):
        if operation not in OPERATIONS:
            raise BridgeError(403, "operation_not_allowed")
        method, allowed, required = OPERATIONS[operation]
        if not isinstance(args, dict) or set(args) - allowed or not required <= set(args):
            raise BridgeError(422, "invalid_fields")
        for key in ("project_id", "document_id"):
            if key in args and (not isinstance(args[key], str) or not UUID.fullmatch(args[key])):
                raise BridgeError(422, "invalid_identifier")
        if "expected_revision" in args and (type(args["expected_revision"]) is not int or
                not 1 <= args["expected_revision"] < 2**63):
            raise BridgeError(422, "invalid_revision")
        if "limit" in args and (type(args["limit"]) is not int or not 1 <= args["limit"] <= 100):
            raise BridgeError(422, "invalid_page")
        if "cursor" in args and (not isinstance(args["cursor"], str) or len(args["cursor"]) > 512):
            raise BridgeError(422, "invalid_page")
        path = "/api/projects"
        if "project_id" in args:
            path += "/" + args["project_id"]
        if "document" in operation:
            path += "/documents"
        if "document_id" in args:
            path += "/" + args["document_id"]
        body = {k: v for k, v in args.items() if k not in {"project_id", "document_id"}}
        try:
            encoded = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise BridgeError(422, "invalid_json") from None
        if len(encoded) > MAX_REQUEST:
            raise BridgeError(413, "request_too_large")
        token = private_read(self.token_file, 128).decode("ascii", errors="replace").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            raise BridgeError(503, "credential_unavailable")
        return asyncio.run(self._send(method, path, body if method == "GET" else None,
                                      encoded if method != "GET" else None, token))

    async def _send(self, method, path, params, body, token):
        try:
            async with asyncio.timeout(DEADLINE):
                async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=5) as client:
                    async with client.stream(method, self.origin + path, params=params, content=body,
                            headers={"Authorization": "Bearer " + token, "Accept": "application/json",
                                     "Content-Type": "application/json", "Accept-Encoding": "identity"}) as response:
                        if response.headers.get("content-encoding", "identity").lower() != "identity":
                            raise BridgeError(502, "compressed_response_refused")
                        data = bytearray()
                        async for chunk in response.aiter_raw():
                            if len(data) + len(chunk) > MAX_RESPONSE:
                                raise BridgeError(413, "response_too_large")
                            data.extend(chunk)
                        try:
                            result = json.loads(data)
                        except (ValueError, UnicodeError, RecursionError):
                            raise BridgeError(502, "invalid_upstream_response") from None
                        status = response.status_code
                        if status not in {200, 201}:
                            extra = {}
                            if status == 409 and isinstance(result, dict) and type(result.get("current_revision")) is int:
                                extra["current_revision"] = result["current_revision"]
                            safe_status = status if status in {401, 403, 404, 409, 413, 422, 503} else 502
                            raise BridgeError(safe_status, "revision_conflict" if status == 409 else "upstream_refused", **extra)
                        if not isinstance(result, dict):
                            raise BridgeError(502, "invalid_upstream_response")
                        return status, result
        except (TimeoutError, httpx.TimeoutException):
            raise BridgeError(504, "upstream_timeout") from None
        except httpx.HTTPError:
            raise BridgeError(503, "upstream_unavailable") from None


# Capture process home at module import, never from a renderer or an ambient profile.
# Config is lazy so validation/registration needs no live credentials.
_bridge = None
try:
    from hermes_constants import get_process_hermes_home as _process_home
    _launch_home = _process_home().resolve()
except ImportError:
    _launch_home = None  # Standalone configure.py and explicit Bridge test fixtures only.


def get_bridge():
    global _bridge
    from hermes_constants import get_process_hermes_home, get_hermes_home
    process_home = get_process_hermes_home().resolve()
    if _launch_home is None or _launch_home != process_home:
        raise BridgeError(403, "deployment_mismatch")
    if _bridge is None:
        try:
            config = json.loads(private_read(_launch_home / "pipe-bridge.json", 16384))
            _bridge = Bridge(config, _launch_home)
        except (ValueError, TypeError, UnicodeError):
            raise BridgeError(503, "invalid_configuration") from None
    _bridge.check_home(process_home, get_hermes_home())
    return _bridge
