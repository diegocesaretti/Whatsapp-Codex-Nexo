# Nexo identities

Nexo 0.6 treats a human identity as the primary concept above WhatsApp phone numbers.

## Automatic INPUT enrollment

When an INPUT WhatsApp account becomes linked and exposes its own phone JID, Nexo creates or updates an identity for that phone.

Defaults for a newly discovered INPUT identity:

- `displayName`: WhatsApp display name, falling back to the Nexo account label;
- `nickname`: first word of the display name;
- `role`: `member`;
- `codexConversationEnabled`: `true`;
- `source`: `input`;
- the INPUT account ID is stored in `linkedInputAccountIds`.

Nexo deliberately does **not** infer `owner` from possession of a linked WhatsApp account. Roles are assigned explicitly.

## Identity-derived allowlist

`outputConversation.authorizedNumbers` remains in settings for backwards compatibility, but it is now derived from identities whose `codexConversationEnabled` flag is true.

The phone number is still the technical authentication factor for an inbound OUTPUT conversation. Human-facing context lives on the identity:

```json
{
  "id": "input-...",
  "displayName": "Diego Cesaretti",
  "nickname": "Diego",
  "role": "owner",
  "phoneNumbers": ["549..."],
  "linkedInputAccountIds": ["..."],
  "codexConversationEnabled": true,
  "source": "input"
}
```

Existing numeric allowlists are migrated automatically to `legacy` identities so an upgrade does not remove access. Legacy callers that still write `authorizedNumbers` are translated back into identity permission switches.

## UI

The admin page contains **Personas e identidades**. It supports:

- editing name and nickname;
- assigning `owner`, `adult`, `member`, `child`, or `guest`;
- editing phone numbers;
- enabling/disabling OUTPUT conversation access;
- adding/removing manual identities;
- seeing which linked INPUT accounts belong to the identity.

The old numeric allowlist field remains visible as a read-only technical view.

## MCP

`list_nexo_identities` exposes the identity registry and derived allowlist.

`configure_nexo_identity` creates or edits an identity and requires explicit current-human confirmation.

`get_codex_whatsapp_replies` and `get_codex_whatsapp_conversation` enrich OUTPUT messages with matching identity metadata when a phone number resolves to an identity.

The general WhatsApp INPUT archive remains untrusted evidence. Identity metadata does not change that trust boundary.
