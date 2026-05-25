# ORM Mock Reference — Prisma & TypeORM

Read the project's `package.json` to detect which ORM is used:
- `@prisma/client` → use Prisma mocks
- `typeorm` → use TypeORM mocks
- `@nestjs/typeorm` → use TypeORM mocks

## Prisma Mock Setup

```typescript
import { PrismaService } from '../../src/prisma/prisma.service';

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    loginAttempt: {
      create: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    // Add more models as needed based on the project's schema.prisma
  };
}

// In the test module:
const module: TestingModule = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: PrismaService, useValue: createMockPrisma() },
    { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } },
  ],
}).compile();

// Usage in tests:
prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@test.com' });
prisma.user.create.mockResolvedValue({ id: '1', ...dto });
prisma.user.findMany.mockResolvedValue([user1, user2]);
prisma.loginAttempt.count.mockResolvedValue(3);
```

## TypeORM Mock Setup

```typescript
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../src/modules/users/entities/user.entity';
import { RefreshToken } from '../../src/modules/auth/entities/refresh-token.entity';

function createMockRepository<T>(): Partial<Record<keyof Repository<T>, jest.Mock>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
      getCount: jest.fn(),
      execute: jest.fn(),
    }),
  };
}

// In the test module:
const module: TestingModule = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: getRepositoryToken(User), useValue: createMockRepository<User>() },
    { provide: getRepositoryToken(RefreshToken), useValue: createMockRepository<RefreshToken>() },
    { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } },
  ],
}).compile();

const userRepo = module.get<Repository<User>>(getRepositoryToken(User));

// Usage in tests:
(userRepo.findOneBy as jest.Mock).mockResolvedValue({ id: '1', email: 'test@test.com' });
(userRepo.save as jest.Mock).mockResolvedValue({ id: '1', ...dto });
(userRepo.find as jest.Mock).mockResolvedValue([user1, user2]);
(userRepo.count as jest.Mock).mockResolvedValue(3);

// QueryBuilder usage:
const qb = userRepo.createQueryBuilder();
(qb.getMany as jest.Mock).mockResolvedValue([user1]);
(qb.getCount as jest.Mock).mockResolvedValue(1);
```

## Mapping Prisma patterns to TypeORM

| Operation | Prisma | TypeORM |
|-----------|--------|---------|
| Find by ID | `prisma.user.findUnique({ where: { id } })` | `userRepo.findOneBy({ id })` |
| Find by field | `prisma.user.findFirst({ where: { email } })` | `userRepo.findOneBy({ email })` |
| Find all | `prisma.user.findMany({ skip, take })` | `userRepo.find({ skip, take })` |
| Create | `prisma.user.create({ data: dto })` | `userRepo.save(userRepo.create(dto))` |
| Update | `prisma.user.update({ where: { id }, data })` | `userRepo.update(id, data)` |
| Delete | `prisma.user.delete({ where: { id } })` | `userRepo.delete(id)` or `userRepo.remove(entity)` |
| Count | `prisma.user.count({ where })` | `userRepo.count({ where })` |
| Bulk update | `prisma.token.updateMany({ where, data })` | `tokenRepo.update({ familyId }, { isRevoked: true })` |
| Bulk delete | `prisma.attempt.deleteMany({ where })` | `attemptRepo.delete({ email })` |

## How to adapt patterns

When reading a test pattern that uses Prisma (e.g., `prisma.user.findUnique.mockResolvedValue(...)`),
translate it to the TypeORM equivalent using the mapping table above.

Example — Prisma pattern:
```typescript
await allure.step('Prepare: user exists in DB', async () => {
  prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'user@test.com' });
});
```

Same pattern for TypeORM:
```typescript
await allure.step('Prepare: user exists in DB', async () => {
  (userRepo.findOneBy as jest.Mock).mockResolvedValue({ id: '1', email: 'user@test.com' });
});
```
