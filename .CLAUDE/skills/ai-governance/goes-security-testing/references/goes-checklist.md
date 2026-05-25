# GOES Cybersecurity Checklist — Full Reference

Each item MUST have at least 1 test. Traceability tag: `GOES Checklist Rxx`.

## Category 1: Web Content

| ID | Task | Epic | Feature | Severity |
|----|------|------|---------|----------|
| R3 | No sensitive data (keys, IDs, personal info) in project files or bundles | Security | Sensitive Data Exposure | critical |
| R4 | No sensitive JS logic or business rules exposed in client-side code | Security | Business Logic Exposure | critical |
| R5 | Sanitize all user input (test XSS injection via scripts, HTML, SQL) | Security | XSS Prevention / Input Sanitization | blocker |
| R6 | Configure robots.txt and sitemap.xml if public site | Configuration | Public Site Config | minor |

## Category 2: Server Input/Output

| ID | Task | Epic | Feature | Severity |
|----|------|------|---------|----------|
| R8 | Generic error messages for 2xx, 4xx, 5xx (never expose stack traces, queries, internals) | Security | Generic Error Messages | critical |
| R9 | Role or permission-based validation on the server side | Authentication | RBAC Enforcement | blocker |
| R10 | Remove all user-visible logs (no console.log in production) | Security | Log Exposure Prevention | critical |
| R11 | Input validation via DTO: data type, field length, max records | Domain | DTO Validation / Input Constraints | critical |

## Category 3: Authentication, Registration and User Actions

| ID | Task | Epic | Feature | Severity |
|----|------|------|---------|----------|
| R13 | Short-lived access tokens (5 min) and refresh token rotation | Security | Token Lifetime Enforcement | critical |
| R14 | Auth failure handling: MFA, rate limit, session management | Security | Auth Failure Handling | blocker |
| R15 | Password hashing with bcrypt, Argon2, or PBKDF2 | Security | Password Hashing Strength | blocker |
| R16 | RS256 algorithm for JWT token signing | Security | JWT Signing Algorithm | blocker |
| R17 | Session ID with minimum 128 bits of entropy generated via CSPRNG | Security | Session ID Entropy | critical |
| R18 | Session ID regenerated after login (prevents session fixation) | Security | Session Fixation Prevention | critical |
| R19 | Validate signature, exp, iat, iss, aud on every JWT request | Security | JWT Claims Validation | blocker |
| R20 | NO sensitive data stored in JWT payload | Security | JWT Payload Security | critical |
| R21 | Block forced navigation to routes the user should not access | Authentication | Forced Browsing Prevention | critical |
| R22 | Return 404 for any route that does not match defined routes | Configuration | Unknown Route Handling | normal |
| R23 | IDOR protection (modifying query/URI params must not expose other users' data) | Security | IDOR Prevention | blocker |
| R24 | Low-privilege users cannot access high-privilege actions | Authentication | Privilege Escalation Prevention | blocker |
| R25 | Prevent duplicate user registration | Authentication | Duplicate Registration Prevention | critical |
| R26 | Reject disposable email addresses | Authentication | Disposable Email Rejection | normal |
| R27 | Lock account after 3-5 failed login attempts | Security | Brute Force Protection | blocker |
| R28 | Implement account recovery method | Authentication | Account Recovery | critical |
| R29 | If "remember me" is used, password must be encrypted | Security | Remember Me Security | critical |
| R30 | Server-side password storage (never on client) | Security | Server-side Password Storage | blocker |
| R31 | Do not allow username as password | Security | Weak Password Prevention | critical |
| R32 | Rotate refresh token after every use | Security | Token Rotation | blocker |
| R33 | Validate token on every private request | Authentication | Token Validation Per Request | blocker |
| R34 | Implement RBAC (Role-Based Access Control) | Authentication | Role-Based Access Control | blocker |
| R35 | Inactivity timeout: end session after idle period | Security | Session Inactivity Timeout | critical |

## Category 4: Configuration

| ID | Task | Epic | Feature | Severity |
|----|------|------|---------|----------|
| R37 | Use ORM (no raw queries, prevent SQL injection) | Security | ORM Usage / SQL Injection Prevention | blocker |
| R38 | CORS: Access-Control-Allow-Origin only allowed origins (no wildcard *) | Configuration | CORS Origin Restriction | critical |
| R39 | CORS: Access-Control-Allow-Methods only allowed methods (remove unused) | Configuration | CORS Methods Restriction | critical |
| R40 | Access-Control-Allow-Credentials: true only if cookies are needed | Configuration | CORS Credentials Policy | normal |
| R41 | Access-Control-Max-Age: 3600 (cache preflight for 1 hour) | Configuration | CORS Preflight Cache | normal |
| R42 | Cookies with HttpOnly, Secure, SameSite=Strict, Path=/ | Security | Cookie Security Flags | blocker |
| R43 | Debug mode disabled in production | Configuration | Debug Mode Disabled | critical |
| R44 | Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' | Configuration | CSP Header | critical |
| R45 | X-Content-Type-Options: nosniff, X-Frame-Options: DENY (or SAMEORIGIN) | Configuration | Security Headers (XCT, XFO) | critical |
| R46 | Strict-Transport-Security: max-age=31536000; includeSubDomains; preload | Configuration | HSTS Header | critical |
| R47 | X-XSS-Protection: 0 (deprecated, use CSP instead) | Configuration | XSS Protection Header | normal |
| R48 | Referrer-Policy: strict-origin-when-cross-origin | Configuration | Referrer Policy Header | normal |
| R49 | Permissions-Policy: geolocation=(), camera=(), microphone=() | Configuration | Permissions Policy Header | normal |
| R50 | Cache-Control: no-store for sensitive responses | Configuration | Cache Control Header | critical |
| R51 | Cookie max-age and refresh token must have the same duration | Configuration | Cookie Lifetime Alignment | critical |
| R52 | Disable HTTP PUT method | Configuration | HTTP PUT Disabled | normal |
| R53 | Disable HTTP TRACE method | Configuration | HTTP TRACE Disabled | critical |
| R54 | Disable HTTP method override | Configuration | HTTP Override Disabled | critical |
| R55 | Rate limit: 100 req/min normal, 5 req/min login | Security | Rate Limiting | blocker |

## Category 5: File Handling

| ID | Task | Epic | Feature | Severity |
|----|------|------|---------|----------|
| R57 | Validate file extension AND magic bytes (content-type can be spoofed) | Files | File Extension + Magic Byte Validation | blocker |
| R58 | Whitelist of allowed extensions (.pdf, .jpg, .png) | Files | File Extension Whitelist | blocker |
| R59 | Limit file size (e.g., 10MB max) | Files | File Size Limit | critical |
| R60 | Rename files with UUID (never use original name) | Files | File UUID Rename | critical |

---

## OWASP Top 10 — Test Mapping

| ID | Vulnerability | Tests to Generate | Tag |
|----|--------------|-------------------|-----|
| A01 | Broken Access Control | IDOR, Privilege Escalation, Forced Browsing, Missing Auth | OWASP A01 |
| A02 | Cryptographic Failures | Weak Hashing, Sensitive Data in JWT, Missing TLS | OWASP A02 |
| A03 | Injection | SQL Injection (ORM bypass), XSS, Command Injection | OWASP A03 |
| A04 | Insecure Design | Business Logic Flaws, Missing Rate Limit | OWASP A04 |
| A05 | Security Misconfiguration | Debug Mode, Default Creds, Missing Headers, CORS wildcard | OWASP A05 |
| A06 | Vulnerable Components | (SCA — outside the scope of unit tests) | OWASP A06 |
| A07 | Auth Failures | Brute Force, Timing Attack, Weak Password, Token Replay, Enumeration | OWASP A07 |
| A08 | Data Integrity Failures | (CI/CD — outside the scope of unit tests) | OWASP A08 |
| A09 | Logging Failures | Missing Audit Log, Sensitive Data in Logs | OWASP A09 |
| A10 | SSRF | URL Validation, Whitelist Enforcement | OWASP A10 |

## OWASP API Security Top 10 — Test Mapping

| ID | Vulnerability | Tests to Generate | Tag |
|----|--------------|-------------------|-----|
| API1 | Broken Object Level Auth | Access another user's resource by ID | OWASP API1 |
| API2 | Broken Authentication | Rate limit on login, MFA bypass | OWASP API2 |
| API3 | Broken Object Property Auth | Do not expose sensitive properties, role-based DTOs | OWASP API3 |
| API4 | Unrestricted Resource Consumption | Rate limit, pagination limit, max payload size | OWASP API4 |
| API5 | Broken Function Level Auth | Admin endpoint accessed by regular user | OWASP API5 |
| API6 | Unrestricted Access to Flows | Validate business sequences | OWASP API6 |
| API7 | Server Side Request Forgery | URL whitelist, schema validation | OWASP API7 |
| API8 | Security Misconfiguration | Headers, CORS, unnecessary HTTP methods | OWASP API8 |
| API9 | Improper Inventory Management | Document APIs, deprecate old versions | OWASP API9 |
| API10 | Unsafe Consumption of APIs | Validate third-party responses, timeouts, circuit breakers | OWASP API10 |

---

## GOES Guide — Reference Sections

### Section 3: Input Validation
- Validate on the server (never trust the client)
- Whitelist over Blacklist
- Sanitize and Escape
- Validate type, length, format, and range
- Canonicalize before validating (UTF-8)

### Section 4: Authentication and Authorization
- 4.1 Password Policies: minimum 12 chars, check against compromised lists (HaveIBeenPwned), bcrypt(12)/Argon2(memory=64MB,iterations=3)/PBKDF2
- 4.2 Session Management: 128 bits entropy CSPRNG, regenerate after login, HttpOnly/Secure/SameSite=Strict/Path=/, inactivity timeout 15-30 min, absolute timeout 4-8 hours, invalidate on server-side logout
- 4.3 JWT Best Practices: RS256 or ES256 (NEVER none or HS256 with weak secret), validate signature/exp/iat/iss/aud, access token 15 min max, refresh in httpOnly cookie with per-use rotation, NO sensitive data in payload
- 4.4 RBAC/ABAC Access Control: deny by default, validate on EVERY endpoint, do not trust URL IDs (verify ownership), least privilege, log denied access

### Section 5: Cryptography
- Password hashing: Argon2id, bcrypt, PBKDF2 (NEVER MD5, SHA1, SHA256 alone)
- TLS 1.2 minimum, ideally 1.3
- DO NOT hardcode secrets, use vault (HashiCorp, AWS Secrets Manager)
- .gitignore for sensitive files, git-secrets for pre-commit hooks

### Section 6: API Security
- Rate Limiting: 5 attempts/min login per IP, 100-1000 req/min APIs, respond 429 + Retry-After
- Token bucket or sliding window algorithm

### Section 7: Database Security
- ALWAYS use parameterized queries / ORM (Prisma, TypeORM, Hibernate)
- NEVER concatenate strings: "SELECT * FROM users WHERE id = " + userId // NEVER
- Least privilege principle: app-specific DB user, only SELECT/INSERT/UPDATE/DELETE, NEVER root/sa/admin, NO DDL permissions (CREATE, DROP, ALTER)

### Section 8: HTTP Security Headers
- Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY (or SAMEORIGIN if iframes are needed)
- Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
- X-XSS-Protection: 0 (deprecated, use CSP)
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: geolocation=(), camera=(), microphone=()
- Cache-Control: no-store (for sensitive responses)
- CORS: specific origins (NEVER *), only necessary methods (GET, POST), credentials only if needed, max-age 3600

### Section 9: Error Handling and Logging
- 9.1 Secure Errors: generic messages "An error occurred", NEVER expose stack traces/SQL queries/file paths/software versions, correlation IDs, log details on server (not to client), debug mode disabled in production
- 9.2 What to Log: login attempts (successful and failed) with IP and timestamp, password and profile changes, access denied (403), admin operations and role changes, input validation errors (potential attacks), creation/deletion of sensitive resources
- 9.3 What NOT to Log: passwords (plain text or hashed), session tokens/JWTs/API keys, full card numbers, sensitive personal data (SSN, medical records), configuration secrets

### Section 10: File Upload
- Validate extension AND magic bytes (content-type can be spoofed)
- Whitelist of extensions (.pdf, .jpg, .png)
- Limit max file size (e.g., 10MB)
- Rename with UUID (never use original name)
- Store outside webroot or in external storage (S3)
- Scan with antivirus before processing
- Serve with Content-Disposition: attachment
- DO NOT execute uploaded files (disable execution in uploads directory)
