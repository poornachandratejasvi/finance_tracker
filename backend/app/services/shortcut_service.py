"""Generate an importable iOS Shortcut (.shortcut / WFWorkflow plist) that posts a
transaction to this app's ingestion API.

The produced file is an UNSIGNED shortcut (a plain XML plist). On modern iOS it is
imported by opening the file with "Allow Untrusted Shortcuts" enabled
(Settings → Shortcuts → Advanced). We bake in the server URL and an API token so the
shortcut works with no manual setup.

Schema references: the Shortcuts app stores a workflow as a plist with a top-level
``WFWorkflowActions`` array. Each action is ``{WFWorkflowActionIdentifier, WFWorkflowActionParameters}``.
Action outputs are named (``CustomOutputName`` + ``UUID``) and referenced elsewhere as a
"magic variable" text token (an object-replacement char U+FFFC whose range maps to the
action's output).
"""
from __future__ import annotations

import plistlib
import uuid as _uuid
from typing import List, Optional

# U+FFFC OBJECT REPLACEMENT CHARACTER — placeholder a magic-variable attachment binds to.
_OBJ = "￼"


def _new_uuid() -> str:
    return str(_uuid.uuid4()).upper()


def _text_token(s: str) -> dict:
    """A dictionary/parameter value that is plain literal text."""
    return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}


def _var_token(output_uuid: str, output_name: str) -> dict:
    """A value that is exactly one magic variable (an earlier action's output)."""
    return {
        "Value": {
            "string": _OBJ,
            "attachmentsByRange": {
                "{0, 1}": {"Type": "ActionOutput", "OutputUUID": output_uuid, "OutputName": output_name},
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def _dict_item(key: str, value_token: dict, item_type: int = 0) -> dict:
    """One key/value row inside a WFDictionaryFieldValue (item_type 0 = Text)."""
    return {"WFItemType": item_type, "WFKey": _text_token(key), "WFValue": value_token}


def _dict_field(items: List[dict]) -> dict:
    return {"Value": {"WFDictionaryFieldValueItems": items}, "WFSerializationType": "WFDictionaryFieldValue"}


def _ask(prompt: str, input_type: str, output_name: str, default: Optional[str] = None) -> tuple:
    """Return (action_dict, output_uuid). input_type is 'Number' or 'Text'."""
    u = _new_uuid()
    params = {
        "WFInputType": input_type,
        "WFAskActionPrompt": prompt,
        "UUID": u,
        "CustomOutputName": output_name,
    }
    if default is not None:
        params["WFAskActionDefaultAnswer"] = default
    return ({"WFWorkflowActionIdentifier": "is.workflow.actions.ask", "WFWorkflowActionParameters": params}, u)


def _shortcut_input_token() -> dict:
    """A value that is exactly the shortcut's own input (what an Automation passed
    it -- e.g. the body of the message that triggered a "When I receive a message"
    automation), shown in the Shortcuts editor as the "Shortcut Input" magic
    variable. No prior action/UUID needed since it references the workflow's own
    input, not another action's output."""
    return {
        "Value": {"string": _OBJ, "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}}},
        "WFSerializationType": "WFTextTokenString",
    }


def build_add_transaction_shortcut(
    base_url: str,
    token: str,
    include_type: bool = True,
    include_category: bool = False,
    include_account: bool = True,
    account_names: Optional[List[str]] = None,
    notify_title: str = "Finance Tracker",
) -> bytes:
    """Build the .shortcut plist bytes for an 'Add Transaction' shortcut."""
    base = (base_url or "").rstrip("/")
    url = f"{base}/api/ingest/transaction"

    actions: List[dict] = []

    ask_amount, amount_uuid = _ask("Amount", "Number", "Amount")
    ask_desc, desc_uuid = _ask("Description", "Text", "Description")
    actions += [ask_amount, ask_desc]

    json_items = [
        _dict_item("amount", _var_token(amount_uuid, "Amount")),
        _dict_item("description", _var_token(desc_uuid, "Description")),
    ]

    if include_type:
        ask_type, type_uuid = _ask("Type (expense or income)", "Text", "Type", default="expense")
        actions.append(ask_type)
        json_items.append(_dict_item("type", _var_token(type_uuid, "Type")))

    if include_category:
        ask_cat, cat_uuid = _ask("Category (leave blank to auto-categorize)", "Text", "Category", default="")
        actions.append(ask_cat)
        json_items.append(_dict_item("category", _var_token(cat_uuid, "Category")))

    if include_account:
        # Free-text (not "Choose from Menu") because /api/ingest/transaction already
        # fuzzy-matches this against the caller's real bank names (exact, then
        # contains, then code) -- a fixed menu baked in at shortcut-creation time
        # would go stale the moment a bank is renamed or added.
        names_hint = ", ".join(account_names or []) or "no banks configured yet"
        ask_account, account_uuid = _ask(
            f"Account (e.g. one of: {names_hint} — leave blank for default)", "Text", "Account", default="",
        )
        actions.append(ask_account)
        json_items.append(_dict_item("account", _var_token(account_uuid, "Account")))

    # Get Contents of URL — POST JSON with the API-key header.
    actions.append({
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": _new_uuid(),
            "WFURL": url,
            "WFHTTPMethod": "POST",
            "ShowHeaders": True,
            "WFHTTPHeaders": _dict_field([
                _dict_item("X-API-Key", _text_token(token)),
                _dict_item("Content-Type", _text_token("application/json")),
            ]),
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": _dict_field(json_items),
        },
    })

    # Show a confirmation notification.
    actions.append({
        "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
        "WFWorkflowActionParameters": {
            "WFNotificationActionTitle": notify_title,
            "WFNotificationActionBody": "Saved ✓",
        },
    })

    root = {
        "WFWorkflowClientVersion": "1146.14",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4271458815,   # a teal/green
            "WFWorkflowIconGlyphNumber": 59511,        # a generic glyph
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["NCWidget", "WatchKit"],
        "WFWorkflowInputContentItemClasses": [
            "WFAppStoreAppContentItem", "WFArticleContentItem", "WFContactContentItem",
            "WFDateContentItem", "WFEmailAddressContentItem", "WFGenericFileContentItem",
            "WFImageContentItem", "WFiTunesProductContentItem", "WFLocationContentItem",
            "WFDCMapsLinkContentItem", "WFAVAssetContentItem", "WFPDFContentItem",
            "WFPhoneNumberContentItem", "WFRichTextContentItem", "WFSafariWebPageContentItem",
            "WFStringContentItem", "WFURLContentItem",
        ],
        "WFWorkflowActions": actions,
    }

    return plistlib.dumps(root, fmt=plistlib.FMT_XML)


def build_sms_forward_shortcut(
    base_url: str,
    token: str,
    notify_title: str = "Finance Tracker",
) -> bytes:
    """Build a Shortcut meant to run from a Settings -> Shortcuts -> Automation
    with trigger "When I receive a message" (with "Run Immediately" enabled, no
    confirmation). It forwards the message's own text as-is to
    /api/ingest/sms, which does the parsing server-side (Apple gives no way for
    an app or Shortcut to read/parse SMS content beyond what an Automation itself
    hands the Shortcut as input) -- this keeps the Shortcut itself trivial (no
    fragile client-side regex extraction) since all the actual amount/direction
    parsing is testable Python, not an unverifiable on-device action chain.
    """
    base = (base_url or "").rstrip("/")
    url = f"{base}/api/ingest/sms"

    actions: List[dict] = [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": _new_uuid(),
                "WFURL": url,
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": _dict_field([
                    _dict_item("X-API-Key", _text_token(token)),
                    _dict_item("Content-Type", _text_token("application/json")),
                ]),
                "WFHTTPBodyType": "JSON",
                "WFJSONValues": _dict_field([
                    _dict_item("text", _shortcut_input_token()),
                ]),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "WFNotificationActionTitle": notify_title,
                "WFNotificationActionBody": "Transaction logged from SMS ✓",
            },
        },
    ]

    root = {
        "WFWorkflowClientVersion": "1146.14",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4271458815,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [
            "WFAppStoreAppContentItem", "WFArticleContentItem", "WFContactContentItem",
            "WFDateContentItem", "WFEmailAddressContentItem", "WFGenericFileContentItem",
            "WFImageContentItem", "WFiTunesProductContentItem", "WFLocationContentItem",
            "WFDCMapsLinkContentItem", "WFAVAssetContentItem", "WFPDFContentItem",
            "WFPhoneNumberContentItem", "WFRichTextContentItem", "WFSafariWebPageContentItem",
            "WFStringContentItem", "WFURLContentItem",
        ],
        "WFWorkflowActions": actions,
    }

    return plistlib.dumps(root, fmt=plistlib.FMT_XML)
