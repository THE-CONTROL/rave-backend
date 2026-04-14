# Rave Backend API

Production-ready Express.js + Prisma REST API for the Rave food delivery platform.

## Tech Stack

| Layer      | Choice                                |
| ---------- | ------------------------------------- |
| Runtime    | Node.js 20 + TypeScript               |
| Framework  | Express.js                            |
| ORM        | Prisma                                |
| Database   | PostgreSQL                            |
| Auth       | JWT (access + refresh token rotation) |
| Validation | Zod                                   |
| Email      | Nodemailer                            |
| Logging    | Winston + Morgan                      |
| Security   | Helmet, CORS, express-rate-limit      |

---

## Project Structure

```
src/
├── config/          # Env config, database client, logger
├── controllers/     # Thin HTTP handlers — call services, return responses
├── middleware/      # auth (JWT guard), validate (Zod), upload (Multer), errorHandler
├── routes/          # Express routers — wire controllers + middleware
├── services/        # All business logic (auth, user, vendor, catalog, policy, ad)
├── types/           # Shared TypeScript interfaces
├── utils/           # AppError, jwt helpers, email, response helpers, pagination
└── validators/      # Zod schemas for every request body
prisma/
├── schema.prisma    # Full data model (18 models)
└── seed.ts          # Sample data for dev
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT secrets, SMTP settings
```

### 3. Database setup

```bash
# 1. Generate the Prisma client (always do this first on a fresh clone)
npm run db:generate

# 2. Run migrations to create all tables
npm run db:migrate

# 3. Seed with sample data
npm run db:seed
```

### 4. Start development server

```bash
npm run dev
# → http://localhost:5000/api/v1/health
```

> **Important:** Always run `db:generate` before `db:migrate` on a fresh clone.
> `db:migrate` also calls generate internally, but calling it explicitly first
> avoids the `@prisma/client did not initialize yet` error when running seed
> or dev server in the same shell session.

---

## API Overview

All routes are prefixed with `/api/v1`.

### Auth — `/auth`

| Method | Path                    | Description                       |
| ------ | ----------------------- | --------------------------------- |
| POST   | `/auth/signup`          | Register new user or vendor       |
| POST   | `/auth/signin`          | Sign in, returns token pair       |
| POST   | `/auth/verify-email`    | Submit 6-digit OTP                |
| POST   | `/auth/forgot-password` | Send password reset OTP           |
| POST   | `/auth/reset-password`  | Set new password                  |
| POST   | `/auth/resend-code`     | Resend OTP                        |
| POST   | `/auth/refresh`         | Rotate tokens                     |
| POST   | `/auth/signout`         | 🔒 Revoke session                 |
| PATCH  | `/auth/push-token`      | 🔒 Update push notification token |

### User — `/user` 🔒 (role: user)

| Group         | Endpoints                                                  |
| ------------- | ---------------------------------------------------------- |
| Profile       | `GET/PATCH /profile`, `PATCH /password`, `DELETE /account` |
| Addresses     | Full CRUD on `/addresses`, set default                     |
| Locations     | Full CRUD on `/locations`                                  |
| Wallet        | `GET /wallet`, top-up, withdraw                            |
| Cards         | CRUD on `/wallet/cards`                                    |
| Banks         | CRUD on `/wallet/banks`                                    |
| Transactions  | `GET /transactions`, `GET /transactions/:id`               |
| Cart          | `GET/POST /cart`, update qty, remove, clear, checkout      |
| Orders        | `GET /orders`, get by id, cancel, submit review            |
| Refunds       | List, get detail, request refund                           |
| Referrals     | Stats, apply code                                          |
| Notifications | List, mark read, delete, settings                          |
| Favorites     | Toggle restaurant/product favorites                        |

### Vendor — `/vendor` 🔒 (role: vendor)

| Group         | Endpoints                                                  |
| ------------- | ---------------------------------------------------------- |
| Profile       | `GET/PATCH /profile`, `PATCH /password`, `DELETE /account` |
| Dashboard     | `GET /dashboard`                                           |
| Store         | `GET/PATCH /store`, toggle open, schedules                 |
| Categories    | Full CRUD, add items to category                           |
| Menu          | Full CRUD on `/menu`                                       |
| Orders        | List (by tab), get detail, update status                   |
| Analytics     | `GET /analytics`                                           |
| Earnings      | Summary, transactions, payout request                      |
| Banks         | CRUD, set primary                                          |
| Promotions    | Full CRUD                                                  |
| Reviews       | Stats, paginated list                                      |
| Badges        | Stats, list, detail                                        |
| Referrals     | Stats                                                      |
| Notifications | List, mark read, delete, settings                          |

### Catalog — `/catalog` (public)

| Method | Path                                  | Description                    |
| ------ | ------------------------------------- | ------------------------------ |
| GET    | `/catalog/restaurants`                | Nearby restaurants (paginated) |
| GET    | `/catalog/restaurants/:id`            | Restaurant details             |
| GET    | `/catalog/restaurants/:id/menu`       | Menu items, filter by category |
| GET    | `/catalog/restaurants/:id/categories` | Restaurant categories          |
| GET    | `/catalog/restaurants/:id/reviews`    | Paginated reviews              |
| GET    | `/catalog/products/:id`               | Product details                |
| GET    | `/catalog/products/:id/reviews`       | Product reviews                |
| GET    | `/catalog/search?q=&type=`            | Search restaurants/foods       |
| GET    | `/catalog/categories`                 | All food categories            |
| GET    | `/catalog/categories/:name/items`     | Items by category              |

### Policy — `/policy` 🔒

| Method | Path                 | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/policy/issues`     | My reported issues                 |
| GET    | `/policy/issues/:id` | Issue detail                       |
| POST   | `/policy/issues`     | Submit issue (multipart/form-data) |
| POST   | `/policy/feedback`   | Submit feedback                    |

### Ads — `/ads`

| Method | Path           | Description                |
| ------ | -------------- | -------------------------- |
| GET    | `/ads/startup` | 🔒 Get startup ad for role |
| POST   | `/ads/track`   | 🔒 Track ad event          |

---

## Auth Flow

```
1. POST /auth/signup         → OTP sent to email
2. POST /auth/verify-email   → { tokens: { accessToken, refreshToken, expiresAt } }
3. Client stores tokens securely
4. Attach: Authorization: Bearer <accessToken>
5. POST /auth/refresh        → new token pair (refresh token rotated)
```

## Response Format

All responses follow this shape:

```json
{
  "success": true,
  "message": "Human readable message",
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 }
}
```

## Error Codes

| Status | Meaning                               |
| ------ | ------------------------------------- |
| 400    | Bad request / business rule violation |
| 401    | Missing or invalid token              |
| 403    | Insufficient role/permissions         |
| 404    | Resource not found                    |
| 409    | Conflict (duplicate)                  |
| 422    | Validation failed (Zod)               |
| 429    | Rate limit exceeded                   |
| 500    | Internal server error                 |
