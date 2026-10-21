"""Pipe tools use the same fixed service and revision checks as Desktop."""
import json
from . import service


def homes():
    from hermes_constants import get_process_hermes_home, get_hermes_home
    return get_process_hermes_home(), get_hermes_home()


FIELDS = {
    "project_id": {"type": "string", "pattern": "^" + service.UUID.pattern.replace(r"\Z", "$")},
    "document_id": {"type": "string", "pattern": "^" + service.UUID.pattern.replace(r"\Z", "$")},
    "title": {"type": "string", "minLength": 1, "maxLength": 200},
    "kind": {"type": "string", "enum": ["note", "board"]},
    "content": {"type": "object", "description": "Note: {text:string}, at most 100000 characters. Board: {nodes:[{id,position:{x,y},type:note|step|reference,data:{label,text}}],edges:[{id,source,target,relation:reference|dependency}]}. Max 500 nodes, 2000 edges, 1 MiB. Boards are saved designs, never executable."},
    "expected_revision": {"type": "integer", "minimum": 1,
                          "description": "Revision returned by the last read. Never guess or automatically retry a conflict."},
    "limit": {"type": "integer", "minimum": 1, "maximum": 100},
    "cursor": {"type": "string", "maxLength": 512},
}
DESCRIPTIONS = {
    "list_projects": "List private Pipe projects in the operator-bound workspace. Follow next_cursor for more.",
    "get_project": "Read one Pipe project's metadata by ID.",
    "create_project": "Create a Pipe project draft. Do not retry an uncertain result; list projects first.",
    "list_documents": "List a Pipe project's documents. Boards are saved designs, not executable workflows.",
    "get_document": "Read a Pipe document, including its current revision and content.",
    "create_document": "Create a note or board design in Pipe. No external actions are executed. Do not blindly retry.",
    "update_document": "Save a Pipe document against expected_revision. Preserve the draft on conflict; read and ask before reapplying. No automatic retry.",
}


def handler_for(operation):
    def handler(args, **kwargs):
        try:
            bridge = service.get_bridge()
            bridge.authorize_agent(*homes())
            _, result = bridge.call(operation, args)
            return json.dumps(result, ensure_ascii=False)
        except service.BridgeError as error:
            return json.dumps({**error.payload, "status": error.status})
        except Exception:
            return json.dumps({**service.BridgeError(503, "bridge_unavailable").payload, "status": 503})
    return handler


def register(ctx):
    for operation, (_, allowed, required) in service.OPERATIONS.items():
        name = "pipe_" + operation
        description = DESCRIPTIONS[operation]
        ctx.register_tool(name=name, toolset="pipe", description=description,
            schema={"name": name, "description": description, "parameters": {
                "type": "object", "properties": {key: FIELDS[key] for key in sorted(allowed)},
                "required": sorted(required), "additionalProperties": False}},
            handler=handler_for(operation))
