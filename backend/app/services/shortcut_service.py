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


def _named_var_token(name: str) -> dict:
    """A value that is exactly one magic variable referencing a NAMED variable
    (set via a prior 'Set Variable' action), as opposed to _var_token's
    reference to one specific action's own output. Same attachment shape,
    different attachment "Type" discriminator + key names -- Apple's format
    reuses this pattern (an object-replacement char + attachmentsByRange
    entry) for every kind of magic variable, distinguished only by the
    attachment dict's own "Type" field ("ActionOutput", "Variable",
    "ExtensionInput", etc.)."""
    return {
        "Value": {
            "string": _OBJ,
            "attachmentsByRange": {"{0, 1}": {"Type": "Variable", "VariableName": name}},
        },
        "WFSerializationType": "WFTextTokenString",
    }


def _set_variable_action(name: str, value_token: dict) -> dict:
    """A 'Set Variable' action -- WFInput is the value to store (any text
    token, including a literal string or another magic variable), WFVariableName
    is the name later referenced via _named_var_token."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {"WFVariableName": name, "WFInput": value_token, "UUID": _new_uuid()},
    }


def _choose_from_menu(
    prompt: str, items: List[str], output_name: str, values: Optional[List[str]] = None,
) -> List[dict]:
    """A 'Choose from Menu' action picking one of `items` (the displayed labels),
    each branch setting `output_name` to the corresponding entry in `values`
    (defaults to the label itself) -- so the menu's result is usable afterward
    as a plain named variable via _named_var_token. A label/value split lets a
    menu offer a label like "Auto-detect" that stores an empty string, so the
    backend's own `category or auto-categorize` fallback still fires.

    Schema note (unverified against a real device -- flagged explicitly in the
    calling docstring): Choose-from-Menu is a control-flow action like If/Repeat,
    built from a Start marker (WFControlFlowMode=0) sharing one GroupingIdentifier
    with a case marker (WFControlFlowMode=1) per branch and a single End marker
    (WFControlFlowMode=2)."""
    values = values if values is not None else list(items)
    group = _new_uuid()
    actions: List[dict] = [{
        "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group,
            "UUID": _new_uuid(),
            "WFControlFlowMode": 0,
            "WFMenuPrompt": prompt,
            "WFMenuItems": list(items),
        },
    }]
    for item, value in zip(items, values):
        actions.append({
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": group,
                "UUID": _new_uuid(),
                "WFControlFlowMode": 1,
                "WFMenuItemTitle": item,
            },
        })
        actions.append(_set_variable_action(output_name, _text_token(value)))
    actions.append({
        "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
        "WFWorkflowActionParameters": {"GroupingIdentifier": group, "UUID": _new_uuid(), "WFControlFlowMode": 2},
    })
    return actions


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
    include_category: bool = True,
    include_account: bool = True,
    include_date: bool = False,
    include_notes: bool = False,
    account_names: Optional[List[str]] = None,
    category_names: Optional[List[str]] = None,
    notify_title: str = "Finance Tracker",
) -> bytes:
    """Build the .shortcut plist bytes for an 'Add Transaction' shortcut.

    Type and Account now use a real 'Choose from Menu' picker (see
    _choose_from_menu) instead of free-text entry. That control-flow schema
    (GroupingIdentifier + WFControlFlowMode start/case/end markers) is
    written from documented format knowledge but has not been round-tripped
    against a real device -- if it fails to import or misbehaves, fall back
    to the manual Setup Kit instructions (which build the equivalent menu
    through the Shortcuts app's own UI, so there's no schema risk there)."""
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
        # A real picker (not free text) -- only two possible values, so a menu
        # can't go stale the way a bank-name menu could.
        actions += _choose_from_menu("Type?", ["Expense", "Income"], "Type")
        json_items.append(_dict_item("type", _named_var_token("Type")))

    if include_category:
        if category_names:
            # "Auto-detect" stores an empty string (not the label "Auto-detect"),
            # so the backend's `category or categorize_transaction(description)`
            # fallback still fires when the user doesn't pick a specific one.
            labels = ["Auto-detect"] + list(category_names)
            values = [""] + list(category_names)
            actions += _choose_from_menu("Category?", labels, "Category", values=values)
            json_items.append(_dict_item("category", _named_var_token("Category")))
        else:
            ask_cat, cat_uuid = _ask("Category (leave blank to auto-categorize)", "Text", "Category", default="")
            actions.append(ask_cat)
            json_items.append(_dict_item("category", _var_token(cat_uuid, "Category")))

    if include_account:
        if account_names:
            # A real picker of the caller's actual banks at the time this shortcut
            # was generated. This does go stale if a bank is renamed/added later
            # (unlike the fixed Expense/Income menu above) -- re-download the
            # shortcut after changing banks to refresh the list. If no banks are
            # configured yet, falls back to free text below instead of building a
            # menu with zero items.
            actions += _choose_from_menu("Which account?", list(account_names), "Account")
            json_items.append(_dict_item("account", _named_var_token("Account")))
        else:
            ask_account, account_uuid = _ask(
                "Account (no banks configured yet — leave blank for default)", "Text", "Account", default="",
            )
            actions.append(ask_account)
            json_items.append(_dict_item("account", _var_token(account_uuid, "Account")))

    if include_date:
        # Shortcuts renders the chosen Date using its default textual format when
        # it lands in a dictionary value; the backend's transaction_date parsing
        # already falls back to dateutil.parser for exactly this kind of loosely
        # formatted string, and silently defaults to "now" if parsing fails, so
        # there's no hard failure mode here even if the format is unexpected.
        ask_date, date_uuid = _ask("Date (leave default for now)", "Date", "Date")
        actions.append(ask_date)
        json_items.append(_dict_item("transaction_date", _var_token(date_uuid, "Date")))

    if include_notes:
        ask_notes, notes_uuid = _ask("Notes (optional)", "Text", "Notes", default="")
        actions.append(ask_notes)
        json_items.append(_dict_item("notes", _var_token(notes_uuid, "Notes")))

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
