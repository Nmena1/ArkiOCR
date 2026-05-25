# Security Recommendations — For NOT IMPLEMENTED items

When an item from the GOES Checklist is NOT IMPLEMENTED in the project,
include the corresponding recommendation from this file in the coverage report.

## Category 1: Web Content

| ID | Recommendation |
|----|---------------|
| R3 | Audit all source files and remove hardcoded secrets (API keys, passwords, tokens). Use environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault). |
| R4 | Move sensitive business logic to the backend. Never expose pricing algorithms, discount calculations, or validation rules in client-side code. |
| R5 | Add input sanitization using a library like `class-validator` + `class-transformer` with `@IsString()`, `@MaxLength()`, `@Matches()` decorators on all DTOs. Use `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. |
| R6 | Add `robots.txt` and `sitemap.xml` to the public directory if the site is publicly accessible. |

## Category 2: Server Input/Output

| ID | Recommendation |
|----|---------------|
| R8 | Create a global exception filter that catches all errors and returns generic messages. Never expose stack traces, SQL queries, or file paths. Use correlation IDs for debugging. |
| R9 | Add a `RolesGuard` that checks `@Roles()` decorator metadata on every endpoint. Apply it globally or per controller. |
| R10 | Remove all `console.log` statements from production code. Use a structured logger (Winston, Pino) with log levels. Never log passwords, tokens, or secrets. |
| R11 | Add `class-validator` decorators to all DTOs: `@IsString()`, `@MaxLength(255)`, `@IsEmail()`, `@Min()`, `@Max()`. Apply `ValidationPipe` globally. |

## Category 3: Authentication & Sessions

| ID | Recommendation |
|----|---------------|
| R13 | Set JWT access token expiry to 5-15 minutes. Use refresh tokens (stored in httpOnly cookies) for renewal. |
| R14 | Add MFA support (TOTP via `otplib`). Implement rate limiting on auth endpoints. Add session invalidation on password change. |
| R15 | Use `bcrypt` with cost factor >= 12 or `argon2id`. Never use MD5, SHA1, or plain SHA256 for password hashing. |
| R16 | Configure JWT module with RS256 algorithm using asymmetric key pair. Never use HS256 with a weak secret or the "none" algorithm. |
| R17 | Use `crypto.randomBytes(32)` (256 bits) for session ID generation. Never use `Math.random()` or sequential IDs. |
| R18 | Regenerate the session/token after successful login. Invalidate any pre-authentication session ID. |
| R19 | Configure JWT verification to validate: signature, `exp` (expiration), `iat` (issued at), `iss` (issuer), `aud` (audience). Reject tokens missing any claim. |
| R20 | JWT payload should only contain `sub` (user ID), `role`, `iat`, `exp`. Never include email, password hash, personal data, or secrets. |
| R21 | Apply `JwtAuthGuard` globally or on all private routes. Use `@Public()` decorator only for explicitly public endpoints. |
| R22 | Add a catch-all route handler that returns 404 for undefined routes. In NestJS: the framework does this by default, but verify no debug pages are exposed. |
| R23 | In every service method that accesses a resource by ID, verify that the resource belongs to the authenticated user (`resource.userId === currentUser.id`). |
| R24 | Add `@Roles('ADMIN')` decorator to all admin endpoints. Apply `RolesGuard` globally. Prevent users from accessing actions above their privilege level. |
| R25 | Check if email already exists before creating a new user. Return a generic error (not "email already registered" — that leaks info). |
| R26 | Validate email domain against a blocklist of disposable email providers (mailinator.com, tempmail.com, etc.). Use a library like `disposable-email-domains`. |
| R27 | Track failed login attempts per email+IP. After 5 failures, lock the account for 15 minutes. Use a `loginAttempt` table with timestamps. |
| R28 | Implement password reset via email with a secure, time-limited token (max 1 hour). The reset endpoint should not reveal whether the email exists. |
| R29 | If implementing "remember me", store only an encrypted/hashed token in a secure cookie — never the plain password. |
| R30 | Never return password hashes in any API response. Use DTOs or `select` to exclude the password field from all queries. |
| R31 | Add password policy validation: minimum 12 characters, cannot match email/username, reject common passwords (check against a dictionary). |
| R32 | Implement refresh token rotation: every time a refresh token is used, issue a new one and revoke the old. If a revoked token is reused, revoke all tokens in the family (replay attack detection). |
| R33 | Apply `JwtAuthGuard` on every private endpoint. The guard must verify the token on EVERY request, not rely on cached state. |
| R34 | Implement RBAC with a `RolesGuard` and `@Roles()` decorator. Define roles (USER, MODERATOR, ADMIN) and restrict endpoints based on the user's role. |
| R35 | Add session inactivity timeout (15-30 minutes). Use short-lived access tokens and check `iat` to enforce idle timeout. Redirect to login when expired. |

## Category 4: Configuration

| ID | Recommendation |
|----|---------------|
| R37 | Use Prisma or TypeORM for all database queries. Never concatenate user input into SQL strings. If raw queries are unavoidable, use parameterized queries. |
| R38 | Configure CORS with a whitelist of specific origins: `app.enableCors({ origin: ['https://yourapp.com'] })`. Never use `origin: '*'`. |
| R39 | Restrict CORS methods to only those used by the API: `methods: ['GET', 'POST', 'PATCH', 'DELETE']`. Remove PUT, TRACE, OPTIONS if not needed. |
| R40 | Set `credentials: true` in CORS only if the app uses cookies for auth. If using Bearer tokens only, set it to `false`. |
| R41 | Set `maxAge: 3600` in CORS config to cache preflight requests for 1 hour. |
| R42 | Set cookies with: `httpOnly: true`, `secure: true`, `sameSite: 'strict'`, `path: '/'`. Use the `cookie-parser` package and configure in the response. |
| R43 | Ensure `NODE_ENV=production` in deployment. Disable NestJS debug mode, GraphQL playground, and Swagger in production. |
| R44 | Add Content-Security-Policy header via Helmet: `helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } } })`. |
| R45 | Helmet enables X-Content-Type-Options and X-Frame-Options by default. Verify they are present: `nosniff` and `DENY`. |
| R46 | Add HSTS header via Helmet: `helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } })`. |
| R47 | Set X-XSS-Protection to `0` (it's deprecated). Rely on CSP instead. Helmet handles this by default. |
| R48 | Add Referrer-Policy: `strict-origin-when-cross-origin` via Helmet or manually. |
| R49 | Add Permissions-Policy header: `geolocation=(), camera=(), microphone=()`. Can be set via Helmet or a custom middleware. |
| R50 | Add `Cache-Control: no-store` header to all endpoints that return sensitive data (user profiles, auth responses, admin data). |
| R51 | Ensure cookie `maxAge` matches the refresh token TTL exactly. If refresh token lives 7 days, cookie must also expire in 7 days. |
| R52 | Disable HTTP PUT if the API uses PATCH for updates. Return 405 Method Not Allowed for PUT requests. |
| R53 | Disable HTTP TRACE method. It can be exploited for Cross-Site Tracing (XST) attacks. Most frameworks disable it by default — verify with a test. |
| R54 | Disable HTTP method override (`X-HTTP-Method-Override` header). Do not use `method-override` middleware. |
| R55 | Add rate limiting with `@nestjs/throttler`: 100 req/min for normal endpoints, 5 req/min for login. Use `@Throttle()` decorator on sensitive endpoints. |

## Category 5: File Handling

| ID | Recommendation |
|----|---------------|
| R57 | Validate both file extension AND magic bytes. Use a library like `file-type` to check the actual file content, not just the extension or content-type header. |
| R58 | Define a whitelist of allowed extensions: `.pdf`, `.jpg`, `.jpeg`, `.png`. Reject all others. |
| R59 | Set a maximum file size limit (e.g., 10MB) using Multer's `limits` option or a custom pipe. |
| R60 | Rename uploaded files with `crypto.randomUUID()` before storing. Never use the original filename (prevents path traversal and overwrites). |
