# Support Files — Templates

These files must be created during STEP 3 (Configure Jest + Allure).

## 1. test/allure-setup.ts

```typescript
import * as fs from 'fs';
import * as path from 'path';

const resultsDir = path.resolve(__dirname, '..', 'allure-results');
const categoriesSource = path.resolve(__dirname, '..', 'allure-categories.json');
const categoriesDest = path.resolve(resultsDir, 'categories.json');

// Ensure allure-results directory exists
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Copy categories.json to allure-results so it appears in the report
if (fs.existsSync(categoriesSource)) {
  fs.copyFileSync(categoriesSource, categoriesDest);
}

// Write environment info — appears in the "Environment" widget on the dashboard
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'),
);
const envContent = [
  `Project.Name=${packageJson.name || 'Unknown'}`,
  `Project.Version=${packageJson.version || '0.0.0'}`,
  `Test.Date=${new Date().toISOString().split('T')[0]}`,
  `Framework=NestJS + Jest`,
  `Node.Version=${process.version}`,
  `Environment=${process.env.NODE_ENV || 'test'}`,
  `Coverage=GOES Checklist + OWASP Top 10 + API Security Top 10`,
].join('\n');
fs.writeFileSync(path.join(resultsDir, 'environment.properties'), envContent);

// Write executor info — shows who/what ran the tests
const executor = {
  name: process.env.CI ? 'CI Pipeline' : 'Local Developer',
  type: process.env.CI ? 'github' : 'local',
  buildName: `Security Tests — ${new Date().toISOString().split('T')[0]}`,
};
fs.writeFileSync(
  path.join(resultsDir, 'executor.json'),
  JSON.stringify(executor, null, 2),
);

// Preserve history from previous report for trend graphs
const reportHistoryDir = path.resolve(__dirname, '..', 'allure-report', 'history');
const resultsHistoryDir = path.resolve(resultsDir, 'history');
if (fs.existsSync(reportHistoryDir)) {
  if (!fs.existsSync(resultsHistoryDir)) {
    fs.mkdirSync(resultsHistoryDir, { recursive: true });
  }
  const historyFiles = fs.readdirSync(reportHistoryDir);
  for (const file of historyFiles) {
    fs.copyFileSync(
      path.join(reportHistoryDir, file),
      path.join(resultsHistoryDir, file),
    );
  }
}
```

## 2. allure-categories.json

Place this in the project root:

```json
[
  {
    "name": "PENTEST — XSS / Injection",
    "messageRegex": ".*XSS.*|.*injection.*|.*sanitiz.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "PENTEST — Authentication Bypass",
    "messageRegex": ".*auth.*|.*token.*|.*credentials.*|.*login.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "PENTEST — Access Control",
    "messageRegex": ".*IDOR.*|.*privilege.*|.*RBAC.*|.*unauthorized.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "Configuration Issue",
    "messageRegex": ".*header.*|.*CORS.*|.*cookie.*|.*debug.*|.*CSP.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "Input Validation",
    "messageRegex": ".*DTO.*|.*validat.*|.*type.*|.*length.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "File Upload",
    "messageRegex": ".*file.*|.*upload.*|.*extension.*|.*magic.*",
    "matchedStatuses": ["failed", "broken"],
    "traceRegex": ".*"
  },
  {
    "name": "Product Defect",
    "messageRegex": ".*",
    "matchedStatuses": ["failed"],
    "traceRegex": ".*"
  },
  {
    "name": "Test Infrastructure",
    "messageRegex": ".*",
    "matchedStatuses": ["broken"],
    "traceRegex": ".*"
  }
]
```

## 3. package.json — Jest configuration

Add or merge into the existing `jest` section in `package.json`:

```json
{
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": ".",
    "testRegex": ".*\\.spec\\.ts$",
    "testMatch": [
      "<rootDir>/test/security/**/*.security.spec.ts",
      "<rootDir>/src/**/*.spec.ts"
    ],
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "./coverage",
    "testEnvironment": "allure-jest/node",
    "testEnvironmentOptions": {
      "resultsDir": "allure-results"
    },
    "setupFiles": ["./test/allure-setup.ts"]
  }
}
```

If the project uses a separate `jest.config.ts`, adapt accordingly:

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testMatch: [
    '<rootDir>/test/security/**/*.security.spec.ts',
    '<rootDir>/src/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'allure-jest/node',
  testEnvironmentOptions: {
    resultsDir: 'allure-results',
  },
  setupFiles: ['./test/allure-setup.ts'],
};

export default config;
```

## 4. package.json — npm scripts

Add these scripts:

```json
{
  "scripts": {
    "test:security": "jest --testPathPattern=test/security --verbose",
    "test:allure": "npm run test:security && npx allure generate allure-results --clean -o allure-report && npx allure open allure-report",
    "allure:generate": "npx allure generate allure-results --clean -o allure-report",
    "allure:open": "npx allure open allure-report"
  }
}
```

## 5. .gitignore additions

Append to the project's `.gitignore`:

```
# Allure Report
/allure-results
/allure-report
/reports
```

## 6. ESLint override for test files

If the project uses `@typescript-eslint/require-await`, add an override for test files.

In `.eslintrc.js` or `eslint.config.js`:

```javascript
// .eslintrc.js
{
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.test.ts'],
      rules: {
        '@typescript-eslint/require-await': 'off',
      },
    },
  ],
}
```

This is needed because Allure's API (epic, feature, story, etc.) is async but many
test steps don't use await for the actual assertion.
