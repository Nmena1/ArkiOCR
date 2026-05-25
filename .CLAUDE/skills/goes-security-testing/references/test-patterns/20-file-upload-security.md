# Pattern 20: File Upload Security

> **Migration note (skill v1.1):** these patterns were originally written for
> `allure-js-commons`. They now run against the bundled custom HTML reporter
> via `AllureCompat`, which mirrors the same API. The `_setup.md` snippet
> shows the new top-level imports. Existing `await allure.epic(...)`,
> `await allure.step(...)` etc. work identically. Two extras:
>
> - Each `it(...)` block must end with `await allure.flush();` so the metadata
>   reaches the reporter.
> - `attach(name, data)` is now async — call it as `await attach(...)`.

**Covers:** R57 (File Extension + Magic Byte Validation), R58 (File Extension Whitelist), R59 (File Size Limit), R60 (File UUID Rename)

> **3 estados, no 2** (per SKILL.md "notApplicable vs hallazgo"):
>
> 1. Proyecto **NO** acepta uploads (sin `multer`, sin `FileInterceptor`, sin endpoints `multipart/form-data`) → marcar **R57-R60 como `t.notApplicable(...)`** con motivo verificable.
> 2. Proyecto acepta uploads **y** implementa todas las defensas → tests pasan en verde.
> 3. Proyecto acepta uploads **pero falta una o varias defensas** (magic bytes, whitelist, size limit, UUID rename) → tests **FALLAN en rojo**. ESTO ES UN HALLAZGO, **NO un N/A**. Documentarlo en `_recommendations.md`.
>
> Antes de marcar N/A, verificar con `grep` que **ningún** archivo del src usa multer, FileInterceptor, o `@nestjs/platform-express`'s file handling. Si hay aunque sea un endpoint con uploads, se generan los tests y los que fallen se reportan como rojos.

```typescript
it('PENTEST: should validate file extension AND magic bytes', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Files');
  await allure.feature('File Extension + Magic Byte Validation');
  await allure.story('Validate both extension and magic bytes, not just content-type');
  await allure.severity('blocker');
  await allure.tag('Pentest');
  await allure.tag('OWASP A03');
  await allure.tag('GOES Checklist R57');
  await allure.description(
    '## Vulnerability Prevented\n' +
    '**File Type Spoofing** — An attacker renames a PHP/EXE file to .jpg\n' +
    'and sets content-type to image/jpeg. Content-type can be spoofed.\n\n' +
    '## Defense Implemented\n' +
    'Both file extension AND magic bytes (file signature) are validated.\n' +
    'Content-type header alone is never trusted.\n\n' +
    '## Reference\n' +
    'GOES Guide Section 10 — File Upload',
  );

  const maliciousFiles = [
    { name: 'exploit.php.jpg', buffer: Buffer.from('<?php system("rm -rf /");'), reason: 'PHP disguised as JPG' },
    { name: 'virus.exe.pdf', buffer: Buffer.from('MZ'), reason: 'EXE disguised as PDF' },
    { name: 'shell.jsp.png', buffer: Buffer.from('<% Runtime.getRuntime()'), reason: 'JSP disguised as PNG' },
  ];

  for (const file of maliciousFiles) {
    await allure.step(`Test: reject ${file.reason}`, async () => {
      await expect(
        service.uploadFile({
          originalname: file.name,
          buffer: file.buffer,
          mimetype: 'image/jpeg',
          size: file.buffer.length,
        }),
      ).rejects.toThrow();
    });
  }

  await attach('Malicious files tested (input)', {
    total: maliciousFiles.length,
    allRejected: true,
  });
  await allure.flush();
});

it('should only accept files with whitelisted extensions', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Files');
  await allure.feature('File Extension Whitelist');
  await allure.story('Only .pdf, .jpg, .jpeg, .png files are accepted');
  await allure.severity('blocker');
  await allure.tag('Auth');
  await allure.tag('GOES Checklist R58');
  await allure.description(
    '## Objective\n' +
    'Verify that only whitelisted file extensions are accepted.\n' +
    'All other extensions are rejected regardless of content.',
  );

  const blockedExtensions = ['.exe', '.php', '.sh', '.bat', '.js', '.html', '.svg', '.xml'];

  for (const ext of blockedExtensions) {
    await allure.step(`Test: reject file with ${ext} extension`, async () => {
      await expect(
        service.uploadFile({
          originalname: `file${ext}`,
          buffer: Buffer.from('content'),
          mimetype: 'application/octet-stream',
          size: 7,
        }),
      ).rejects.toThrow();
    });
  }

  await attach('Blocked extensions (output)', { extensions: blockedExtensions, allBlocked: true });
  await allure.flush();
});

it('should enforce maximum file size limit', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Files');
  await allure.feature('File Size Limit');
  await allure.story('Reject files exceeding the maximum allowed size');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('OWASP API4');
  await allure.tag('GOES Checklist R59');
  await allure.description(
    '## Objective\n' +
    'Verify that files exceeding the max size (e.g., 10MB) are rejected.\n' +
    'This prevents DoS attacks via large file uploads.',
  );

  await allure.parameter('max_size', '10MB');

  await allure.step('Execute: upload file exceeding limit', async () => {
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
    await expect(
      service.uploadFile({
        originalname: 'large-file.pdf',
        buffer: largeBuffer,
        mimetype: 'application/pdf',
        size: largeBuffer.length,
      }),
    ).rejects.toThrow();
  });

  await attach('File size test (output)', { maxSize: '10MB', oversizeRejected: true });
  await allure.flush();
});

it('should rename uploaded files with UUID (never use original name)', async () => {
  const allure = new AllureCompat();
  const attach = attachFor(allure);
  await allure.epic('Files');
  await allure.feature('File UUID Rename');
  await allure.story('Files are renamed with UUID to prevent path traversal and overwrites');
  await allure.severity('critical');
  await allure.tag('Auth');
  await allure.tag('GOES Checklist R60');
  await allure.description(
    '## Objective\n' +
    'Verify that uploaded files are stored with a UUID-generated name,\n' +
    'never the original filename (which could contain path traversal).\n\n' +
    '## Reference\n' +
    'GOES Guide Section 10 — File Upload',
  );

  const dangerousNames = [
    '../../../etc/passwd',
    '..\\..\\windows\\system32\\config',
    'file with spaces.pdf',
    'normal-file.pdf',
  ];

  for (const name of dangerousNames) {
    await allure.step(`Test: upload "${name.substring(0, 30)}"`, async () => {
      prisma.file.create.mockImplementation(({ data }) => {
        storedFilename = data.filename;
        return Promise.resolve({ id: '1', ...data });
      });

      await service.uploadFile({
        originalname: name,
        buffer: Buffer.from('%PDF-1.4'),
        mimetype: 'application/pdf',
        size: 8,
      });

      // Stored filename should be a UUID, not the original
      expect(storedFilename).not.toBe(name);
      expect(storedFilename).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      expect(storedFilename).not.toContain('..');
    });
  }

  await attach('File rename results (output)', {
    allRenamed: true,
    noPathTraversal: true,
  });
  await allure.flush();
});
```
