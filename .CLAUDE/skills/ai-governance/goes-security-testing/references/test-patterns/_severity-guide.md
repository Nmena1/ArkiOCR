# Severity Assignment Guide

| Severity | When to use | Example |
|----------|-------------|---------|
| blocker | If it fails, the system cannot operate securely | Login broken, RBAC bypassed, SQL injection possible, XSS via unsanitized input |
| critical | Critical functionality compromised | Token not validated, password not hashed, CORS open, secrets exposed |
| normal | Standard functionality | Filters, pagination, audit log, 404 handling |
| minor | Non-critical edge cases | Logout without token, cosmetic error messages |
| trivial | Cosmetic | Response format, field ordering |

## PENTEST test rules

- Prefix: `'PENTEST: ...'` in the `it()` name
- Epic: `'Security'`
- Tags: `'Pentest'` + `'OWASP Axx'` + `'GOES Checklist Rxx'`
- Description must include `## Vulnerability Prevented` and `## Defense Implemented`
- Attachments: attacker payload (input) + defense response (output)
