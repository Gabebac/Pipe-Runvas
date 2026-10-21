"""Explicit Pipe operations; imported by the installed standalone dashboard loader."""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

try:
    from .. import service
except ImportError:
    # Unique module key, not sys.path mutation or a generic `import service` collision.
    name = "hermes_pipe_bridge_service"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / "service.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    service = sys.modules[name]

router = APIRouter()


def homes():
    from hermes_constants import get_process_hermes_home, get_hermes_home
    return get_process_hermes_home(), get_hermes_home()


async def invoke(request, operation, ids=None):
    try:
        bridge = service.get_bridge()
        bridge.authorize_http(request, *homes())
        query = request.query_params
        allowed = {"profile", "cursor", "limit"} if operation == "list_projects" else {"profile"}
        if set(query) - allowed or any(len(query.getlist(k)) != 1 for k in query):
            raise service.BridgeError(422, "invalid_query")
        if operation == "binding":
            return JSONResponse(bridge.metadata(), headers={"Cache-Control": "no-store"})
        args = dict(ids or {})
        if request.method == "GET":
            if "cursor" in query:
                args["cursor"] = query["cursor"]
            if "limit" in query:
                if not query["limit"].isascii() or not query["limit"].isdigit() or len(query["limit"]) > 3:
                    raise service.BridgeError(422, "invalid_page")
                args["limit"] = int(query["limit"])
        else:
            if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                raise service.BridgeError(422, "json_required")
            data = bytearray()
            async with asyncio.timeout(service.DEADLINE):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > service.MAX_REQUEST:
                        raise service.BridgeError(413, "request_too_large")
                    data.extend(chunk)
            try:
                body = json.loads(data)
            except (ValueError, UnicodeError, RecursionError):
                raise service.BridgeError(422, "invalid_json") from None
            if not isinstance(body, dict) or set(body) & {"project_id", "document_id"}:
                raise service.BridgeError(422, "invalid_fields")
            args.update(body)
        status, result = await run_in_threadpool(bridge.call, operation, args)
        return JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})
    except service.BridgeError as error:
        return JSONResponse(error.payload, status_code=error.status, headers={"Cache-Control": "no-store"})
    except TimeoutError:
        error = service.BridgeError(504, "request_timeout")
        return JSONResponse(error.payload, status_code=504, headers={"Cache-Control": "no-store"})
    except Exception:
        # Never echo host/upstream exception messages, credentials or submitted content.
        error = service.BridgeError(503, "bridge_unavailable")
        return JSONResponse(error.payload, status_code=503, headers={"Cache-Control": "no-store"})


@router.get("/binding")
async def binding(request: Request):
    return await invoke(request, "binding")


@router.get("/projects")
async def projects(request: Request):
    return await invoke(request, "list_projects")


@router.post("/projects")
async def create_project(request: Request):
    return await invoke(request, "create_project")


@router.get("/projects/{project_id}")
async def project(request: Request, project_id: str):
    return await invoke(request, "get_project", {"project_id": project_id})


@router.get("/projects/{project_id}/documents")
async def documents(request: Request, project_id: str):
    return await invoke(request, "list_documents", {"project_id": project_id})


@router.post("/projects/{project_id}/documents")
async def create_document(request: Request, project_id: str):
    return await invoke(request, "create_document", {"project_id": project_id})


@router.get("/projects/{project_id}/documents/{document_id}")
async def document(request: Request, project_id: str, document_id: str):
    return await invoke(request, "get_document", {"project_id": project_id, "document_id": document_id})


@router.put("/projects/{project_id}/documents/{document_id}")
async def update_document(request: Request, project_id: str, document_id: str):
    return await invoke(request, "update_document", {"project_id": project_id, "document_id": document_id})
