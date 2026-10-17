# n8n-nodes-xmlvalid

An [n8n](https://n8n.io) community node for [xmlvalid](https://xmlvalid.com): validate XML documents and e-invoices against XSD, DTD, RelaxNG and Schematron business rules in your workflows.

Check incoming invoices before they reach your ERP, validate the XML your system generates before it is sent, or watch a supplier's feed: Peppol BIS Billing 3.0, EN 16931 (UBL and CII), XRechnung, ZUGFeRD / Factur-X (the XML inside the PDF), France CTC, FatturaPA, KSeF, Peppol PINT and the other formats among the 146 schemas of the [schema catalog](https://xmlvalid.com/schemas). Each finding comes with its line, the business rule's id (such as `BR-CO-16`) and a link that explains how to fix it.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Example workflows](#example-workflows) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

In n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-xmlvalid`. See the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. Sign up at [xmlvalid.com](https://xmlvalid.com/register) and confirm your email. The Free plan includes 100 API validations a month; Pro, 10,000.
2. Create a key under [Dashboard → API](https://xmlvalid.com/dashboard/api). It starts with `xv_`.
3. In n8n, create an **Xmlvalid API** credential and paste the key. Leave **API URL** as it is.

The node sends the key as `Authorization: Bearer xv_…`. Saving the credential checks it against the API.

## Operations

### Validation

- **Validate**: validates a document and waits for the result.
  - **Document Source**: a **binary file** from a previous node (XML, gzip, ZIP archive, Factur-X / ZUGFeRD PDF), a **URL** xmlvalid downloads, or the XML as **text**.
  - **Schema**: **Auto-Detect** picks the e-invoice profile the document names (its specification identifier, BT-24) and otherwise checks well-formedness and the document's DOCTYPE. Or choose a catalog schema or one of your saved schemas from the list.
  - **Simplify** (on by default) returns the verdict and the findings only; off, the full API response.
  - Options: **Wait for Result** (off returns the validation queued, to fetch later with Get), **Timeout**, **File Name**.
- **Get**: a validation by its ID, finished or not. Results are kept for 24 hours.
- **Cancel**: cancels a validation that is still queued or running.
- **Share Report**: one public HTML report link for one or more finished validations, open for 30 days (Pro).

### Account

- **Get Usage**: the plan, the validations used this month and the limits.
- **List Schemas**: your saved schemas and the public catalog, with the name to pass as the schema.

The node can also be used as a tool by n8n's AI Agent.

### Output

With **Simplify** on:

```json
{
  "id": "val_01m55dyd6x75pr1e626mp09zr5",
  "status": "done",
  "valid": false,
  "outcome": "invalid",
  "schema": "peppol-bis-3-invoice",
  "errors_total": 1,
  "warnings_total": 0,
  "errors": [
    {
      "line": 139,
      "level": "error",
      "rule": "BR-CO-16",
      "message": "Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) -Paid amount (BT-113) +Rounding amount (BT-114).",
      "help_url": "https://xmlvalid.com/rules/BR-CO-16"
    }
  ],
  "warnings": [],
  "error": null
}
```

`outcome` is `valid`, `warnings` (valid, with warnings), `invalid`, `schema` (the schema or rules could not be used), `input` (the document could not be read) or `failed`. Route on `valid` with an **If** node.

## Example workflows

**Check e-invoices that arrive by email.** Gmail Trigger (or IMAP Email) with attachments → **xmlvalid: Validate** (Binary File, field `attachment_0`, Schema Auto-Detect) → **If** `{{ $json.valid }}` → true: pass the invoice on to your accounting system; false: reply to the sender with `{{ $json.errors[0].message }}` (line `{{ $json.errors[0].line }}`).

**Validate before you send.** The node that generates your UBL or CII invoice → **xmlvalid: Validate** (Text, Schema `peppol-bis-3-invoice` or `xrechnung-3-cii`) → **If** valid → send through your Peppol access point; otherwise post the findings to Slack.

**Watch a feed or export.** Schedule Trigger → **xmlvalid: Validate** (URL) → **If** not valid → alert, with a **Share Report** link for the team.

## Compatibility

Built and tested with n8n 1.123. Requires n8n 1.0 or later.

## Resources

- [xmlvalid API reference](https://xmlvalid.com/docs/api)
- [Schema catalog](https://xmlvalid.com/schemas) and [business rules](https://xmlvalid.com/rules)
- [Error message guide](https://xmlvalid.com/errors)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- Support: support@xmlvalid.com

## License

[MIT](LICENSE)
