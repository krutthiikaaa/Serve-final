# SERVE — Order. Track. Collect.

A digital food-ordering and kitchen-operations platform for the hostel canteens of SRM University-AP.

SERVE helps students order food ahead, track their orders in real time and collect them when ready. Canteen staff can manage incoming orders, verify payment claims, update food availability and coordinate kitchen operations. Administrators manage canteens, staff access, permissions and reports through a centralized dashboard.

> **Project status:** Under active development. The backend and all three client applications are implemented and integrated, with unit, widget, integration and end-to-end tests. Real Razorpay payment processing, push notifications and public production deployment are not yet complete.

> **Role-specific authentication**
>
> - Students: Google sign-in using verified `@srmap.edu.in` accounts.
> - Staff: Email and password; new accounts remain pending until approved by an administrator.
> - Admins: Email and password; accounts are provisioned through the `admin:create` command.



## 1. Project Overview

### The problem

During peak hours, students queue in person at hostel night canteens to order and pay for food. They often do not know:

- How long the queue will take.
- Whether their preferred food is available.
- Whether their order is ready.
- What stage their order is currently at.

Behind the counter, staff handle incoming orders, check UPI payments and coordinate food preparation. They also need a way to manage incoming orders when the kitchen is overloaded.

### Our solution

SERVE provides a centralized digital platform connecting students, canteen staff and administrators.

Students can browse menus, place orders, submit payment claims and track their orders. Staff can manage the kitchen queue, verify payments and update order statuses. Administrators can manage canteens, staff permissions and operational reports.

### How SERVE works

1. A student signs in to the app and selects a night canteen. The default canteen is linked to their hostel.
2. The student browses the menu, adds items to the cart and checks out.
3. The student completes the displayed UPI payment process and submits a payment claim.
4. The student receives an order number, such as `SV1024`, and can track the order.
5. Staff see the order after payment confirmation and update its preparation status.
6. When the order is ready, the student visits the canteen and collects it.

**SERVE is a pickup-based platform.** It does not provide room delivery or cash on delivery.

---

## 2. Features

Feature status: **Implemented**, **Partially Implemented** or **Planned**.

### Student Application

| Feature                                               | Status                |
| ----------------------------------------------------- | --------------------- |
| Google sign-in with verified `@srmap.edu.in` accounts | Implemented           |
| Student registration with hostel selection            | Implemented           |
| Home screen with recommendations                      | Implemented           |
| Menu browsing, search, filters and live availability  | Implemented           |
| Day/Night pricing                                     | Implemented           |
| Cart and server-generated price quotes                | Implemented           |
| Pickup-only checkout                                  | Implemented           |
| UPI payment claim submission                          | Implemented           |
| Order number and live order tracking                  | Implemented           |
| Order history and cancellation before preparation     | Implemented           |
| In-app notifications and profile                      | Implemented           |
| Favourites and recently viewed (saved on device)      | Partially Implemented |
| Native Android/iOS Google sign-in                     | Partially Implemented |
| Push notifications through FCM/APNs                   | Planned               |

### Staff Dashboard

| Feature                                           | Status      |
| ------------------------------------------------- | ----------- |
| Email and password sign-in                        | Implemented |
| Staff registration and admin approval workflow    | Implemented |
| Live dashboard counters                           | Implemented |
| Kitchen order board                               | Implemented |
| Order status: New → Preparing → Ready → Collected | Implemented |
| Menu and price management                         | Implemented |
| Food availability management                      | Implemented |
| UPI payment claim verification                    | Implemented |
| Counter sales (cash/UPI) and receipts             | Implemented |
| Pause and resume incoming orders (manual)         | Implemented |
| Account and password management                   | Implemented |
| Automatic capacity-based order pausing            | Planned     |

Staff permissions are controlled through capabilities assigned by an administrator:

- `KITCHEN`
- `MENU`
- `PAUSE`
- `CASHIER`

### Admin / Management Portal

| Feature                                        | Status                |
| ---------------------------------------------- | --------------------- |
| Admin email and password sign-in               | Implemented           |
| Dashboard with order and operational summaries | Implemented           |
| Canteen activation and pausing                 | Implemented           |
| Day/Night service area management              | Implemented           |
| Staff approval and rejection                   | Implemented           |
| Staff assignment and permissions               | Implemented           |
| Staff deactivation                             | Implemented           |
| Menu catalogue and Day/Night pricing           | Implemented           |
| DEMO/LIVE payment mode configuration           | Implemented           |
| Official UPI QR upload                         | Implemented           |
| Orders and sales reports                       | Implemented           |
| Top-selling items and daily sales series       | Implemented           |
| Searchable activity history                    | Partially Implemented |
| Real Razorpay payment processing               | Planned               |
| Demand forecasting                             | Planned               |

### Three Interfaces

| Interface       | Users          | Technology | Status      |
| --------------- | -------------- | ---------- | ----------- |
| Student App     | Students       | Flutter    | Implemented |
| Staff Dashboard | Canteen staff  | React      | Implemented |
| Admin Portal    | Administrators | React      | Implemented |

All three interfaces communicate with one shared backend.

---

## 3. Technology Stack

| Layer                  | Technology                       | Version / Details           | Purpose                             |
| ---------------------- | -------------------------------- | --------------------------- | ----------------------------------- |
| Student Application    | Flutter, Dart                    | Flutter 3.47+, Dart 3.13.3  | Cross-platform student app          |
| State Management       | Provider                         | Flutter package             | Application state                   |
| API Communication      | HTTP                             | Flutter package             | REST API requests                   |
| Realtime Client        | Socket.IO Client                 | 4.x                         | Live order updates                  |
| Staff Dashboard        | React, TypeScript                | React 19.3                  | Staff web interface                 |
| Admin Portal           | React, TypeScript                | React 19.3                  | Admin web interface                 |
| Build Tool             | Vite                             | 8.3                         | Web development and builds          |
| Routing                | React Router                     | 7.18                        | Dashboard navigation                |
| Backend                | Node.js, Express                 | Node.js ≥22.12, Express 5.2 | Server and REST APIs                |
| Backend Language       | TypeScript                       | 6.x                         | Backend development                 |
| Database               | PostgreSQL                       | 16                          | Persistent data storage             |
| ORM                    | Prisma                           | 7.10                        | Database access and migrations      |
| Authentication         | Better Auth                      | 1.7.25                      | Authentication and sessions         |
| Realtime Communication | Socket.IO                        | 4.8                         | Live events                         |
| Validation             | Zod                              | 4.6                         | Request and API contract validation |
| Testing                | Vitest, Playwright, flutter_test | Repository versions         | Automated testing                   |
| Security               | Helmet, express-rate-limit       | Repository versions         | Security headers and rate limiting  |

---

## 4. System Architecture

SERVE follows a client-server architecture.

The three client applications communicate with a shared Node.js and Express backend. The backend handles authentication, authorization, business logic, database operations and realtime communication.

### Architecture diagram

```
flowchart TD
    S["Student App<br/>Flutter"]
    ST["Staff Dashboard<br/>React"]
    A["Admin Portal<br/>React"]

    AUTH["Better Auth<br/>Authentication"]
    API["REST API<br/>Express"]
    RT["Socket.IO<br/>Realtime Updates"]
    JOB["Background Jobs"]

    DB[("PostgreSQL<br/>Prisma ORM")]
    GOOGLE["Google OAuth<br/>Students"]

    S --> AUTH
    ST --> AUTH
    A --> AUTH

    AUTH --> GOOGLE

    S --> API
    ST --> API
    A --> API

    S <--> RT
    ST <--> RT
    A <--> RT

    AUTH --> DB
    API --> DB
    RT --> DB
    JOB --> DB
```

### How the architecture works

1. **Client applications:** Students, staff and administrators use their respective interfaces.
2. **Authentication:** Better Auth verifies user identity and manages sessions.
3. **Backend:** Express handles API requests, validates input and applies business rules.
4. **Database:** PostgreSQL stores users, menus, orders, payments, assignments and notifications.
5. **Prisma:** Provides database access and manages migrations.
6. **Realtime communication:** Socket.IO sends updates to the relevant connected clients.
7. **Background jobs:** The backend handles Day/Night switching and unpaid-order expiry.

### Important architectural decisions

- All applications use one shared backend.
- Clients never connect directly to PostgreSQL.
- The backend determines user roles and permissions.
- Prices and totals are calculated and verified server-side.
- Staff access is restricted to their assigned canteen.
- Socket.IO rooms are assigned by the server, not selected by clients.

For deployment, the backend can serve the built applications from one domain:

- Student App: `/`
- Staff Dashboard: `/staff/`
- Admin Portal: `/admin/`
- API: `/api`
- Socket.IO: `/socket.io`

---

## 5. Repository Structure

```
Serve-final/
│
├── apps/
│   ├── student/              # Flutter student application
│   ├── staff/                # React staff dashboard
│   └── admin/                # React admin portal
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema
│   │   ├── migrations/       # Database migrations
│   │   └── seed.ts           # Initial seed data
│   │
│   ├── scripts/              # Admin creation and database scripts
│   ├── src/
│   │   ├── config/           # Configuration and environment validation
│   │   ├── lib/              # Shared backend utilities and auth
│   │   ├── middleware/       # Authentication and authorization
│   │   ├── modules/          # Backend feature modules
│   │   ├── realtime/         # Socket.IO and event handling
│   │   ├── web/              # Built web application hosting
│   │   ├── app.ts            # Express application
│   │   └── server.ts         # Server entry point
│   │
│   └── tests/                # Backend tests
│
├── packages/
│   ├── contracts/            # Shared Zod schemas and API types
│   └── web-shared/           # Shared web authentication and API code
│
├── e2e/                      # Playwright end-to-end tests
├── deploy/                   # Deployment and reverse-proxy configs
├── scripts/                  # Development and build scripts
├── docs/                     # Project documentation
├── brand/                    # Official branding assets
│
├── .env.example              # Environment variable overview
├── Dockerfile
├── package.json              # npm workspaces
├── package-lock.json
└── README.md
```

The Flutter application is managed separately using `pubspec.yaml`; it is not an npm workspace.

---

## 6. Prerequisites

Install the following software before setting up SERVE.

| Software      | Required version      | Download                                                                                                     |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Git           | Recent version        | [https://git-scm.com/downloads](https://git-scm.com/downloads)                                               |
| Node.js       | 22.12 or newer        | [https://nodejs.org/](https://nodejs.org/)                                                                   |
| npm           | Included with Node.js | Included                                                                                                     |
| PostgreSQL    | 16                    | [https://www.postgresql.org/download/](https://www.postgresql.org/download/)                                 |
| Flutter SDK   | 3.47 or newer         | [https://docs.flutter.dev/get-started/install/windows](https://docs.flutter.dev/get-started/install/windows) |
| Google Chrome | Current version       | [https://www.google.com/chrome/](https://www.google.com/chrome/)                                             |
| VS Code       | Recommended           | [https://code.visualstudio.com/](https://code.visualstudio.com/)                                             |

A Google Cloud account is required to configure real Google sign-in for students.

### Verify installations

Open PowerShell and run:

```
git --version
node --version
npm --version
psql --version
flutter --version
```

If `psql` is not recognized, use its full installation path, for example:

```
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

---

## 7. Clone and Setup

The following instructions primarily use Windows PowerShell.

### 7.1 Clone the GitHub repository

Open the SERVE repository on GitHub.

1. Click the green **Code** button.
2. Select **HTTPS**.
3. Copy the repository URL.

Repository:

[https://github.com/pranathigit11/Serve-final](https://github.com/pranathigit11/Serve-final)

Open PowerShell:

```
cd $HOME
git clone https://github.com/pranathigit11/Serve-final.git
cd Serve-final
```

### 7.2 Open in VS Code

```
code .
```

If the command is unavailable, open VS Code and select **File → Open Folder**, then select the `Serve-final` directory.

### 7.3 Verify the repository

```
git status
git branch
```

### 7.4 Install dependencies

From the repository root:

```
npm ci
```

Install Flutter dependencies:

```
cd apps\student
flutter pub get
cd ..\..
```

`npm ci` installs the npm workspaces using the committed lockfile.

If PowerShell blocks npm scripts, run:

```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 7.5 Create environment files

From the repository root:

```
Copy-Item backend\.env.example backend\.env
Copy-Item backend\.env.example backend\.env.test
Copy-Item apps\staff\.env.example apps\staff\.env.development.local
Copy-Item apps\admin\.env.example apps\admin\.env.development.local
```

These files contain local configuration and must not be committed to GitHub.

### 7.6 Configure environment variables

Open the backend environment file:

```
notepad backend\.env
```

Configure the following values:

| Variable               | Example / Purpose                                                   |
| ---------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                                                       |
| `PORT`                 | `5001`                                                              |
| `DATABASE_URL`         | PostgreSQL connection string                                        |
| `CORS_ORIGINS`         | `http://localhost:5173,http://localhost:5174,http://localhost:5555` |
| `BETTER_AUTH_URL`      | `http://localhost:5001`                                             |
| `BETTER_AUTH_SECRET`   | Your generated secret                                               |
| `GOOGLE_CLIENT_ID`     | Your Google OAuth client ID                                         |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret                                     |
| `STUDENT_APP_URL`      | `http://localhost:5555`                                             |
| `STAFF_DASHBOARD_URL`  | `http://localhost:5173`                                             |
| `ADMIN_PORTAL_URL`     | `http://localhost:5174`                                             |
| `PAYMENT_MODE`         | `mock`                                                              |
| `PAYMENT_SECRET`       | Your generated payment secret                                       |

Check `backend/.env.example` for the complete variable list and optional configuration.

### Generate secrets

Run these commands in PowerShell and copy their outputs into the corresponding environment variables.

For `BETTER_AUTH_SECRET`:

```
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

For `PAYMENT_SECRET`:

```
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

Use your own secrets. Never commit them.

### Configure the test environment

Edit `backend\.env.test` for automated tests.

Use:

- `NODE_ENV=test`
- `PORT=5101`
- `DATABASE_URL` pointing to `serve_test`
- `PAYMENT_MODE=mock`
- A separate `PAYMENT_SECRET`
- `LOG_LEVEL=silent`

Follow the test-specific notes in `backend/.env.example`. Do not point the test configuration at a database containing data you need.

The staff and admin development environment files use:

```
VITE_API_URL=http://localhost:5001
```

The Flutter student app uses its development API defaults and does not require an environment file for the standard local setup.

### 7.7 Configure PostgreSQL

Start your PostgreSQL service.

On Windows, you can check for the service using:

```
Get-Service postgresql*
```

Open PowerShell and create the project role and databases.

```
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

& $psql -U postgres -c "CREATE ROLE serve LOGIN CREATEDB PASSWORD 'choose-a-db-password';"

& $psql -U postgres -c "CREATE DATABASE serve_dev OWNER serve;"

& $psql -U postgres -c "CREATE DATABASE serve_test OWNER serve;"
```

Use the same database password in `DATABASE_URL`.

Example:

```
DATABASE_URL=postgresql://serve:your-password@localhost:5432/serve_dev?schema=public
```

If your password contains special characters such as `@`, `:`, `/`, `?` or `#`, URL-encode them in the connection string.

The `serve_test` database is rebuilt during automated test runs. Never use it for important data.

### 7.8 Prisma: Generate, migrate and seed

Run the following commands from the repository root:

```
npm run prisma:generate --workspace backend
npm run prisma:migrate:deploy --workspace backend
npm run db:seed --workspace backend
```

What these commands do:

- `prisma:generate`: Generates the Prisma Client.
- `prisma:migrate:deploy`: Applies existing database migrations.
- `db:seed`: Adds initial hostel, canteen and menu data.

The seed operation is safe to rerun without creating duplicate seed records.

### 7.9 Create an administrator account

SERVE does not provide public administrator registration.

Create an administrator using:

```
npm run admin:create --workspace backend -- --email your.name@example.com --name "Your Name"
```

The script asks for a password through a hidden prompt.

Keep the credentials secure.

### 7.10 Configure Google OAuth

Student sign-in requires a Google OAuth web client.

1. Open [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Create or select a Google Cloud project.
3. Configure Google Auth Platform branding and audience.
4. Create a Web Application OAuth client.
5. Configure the following URLs:

**Authorized JavaScript origin:**

```
http://localhost:5555
```

**Authorized redirect URI:**

```
http://localhost:5001/api/auth/callback/google
```

6. Copy the Client ID and Client Secret into `backend\.env`.

Students must use verified `@srmap.edu.in` accounts.

Staff registration does not require Google OAuth.

---

## 8. Run the Complete Application

This section explains how to start the entire SERVE application locally.

### 8.1 Start PostgreSQL

Make sure PostgreSQL is running before starting the backend.

The local database should be accessible at:

```
localhost:5432
```

### 8.2 Start the backend

Open a new PowerShell terminal in the repository root:

```
npm run dev:backend
```

The backend runs at:

```
http://localhost:5001
```

Check its health:

```
Invoke-RestMethod http://localhost:5001/api/health
```

Check database connectivity:

```
Invoke-RestMethod http://localhost:5001/api/health/db
```

### 8.3 Start the Staff Dashboard

Open another terminal in the repository root:

```
npm run dev:staff
```

Open:

[http://localhost:5173](http://localhost:5173)

### 8.4 Start the Admin Portal

Open another terminal:

```
npm run dev:admin
```

Open:

[http://localhost:5174](http://localhost:5174)

### 8.5 Start the Student Application

Open another terminal:

```
npm run dev:student
```

Open:

[http://localhost:5555](http://localhost:5555)

This runs the Flutter student application in Chrome.

### 8.6 Quick-start reference

Start PostgreSQL first, then run each application in its own terminal.

| Terminal | Service         | Command                  | Local URL        |
| -------- | --------------- | ------------------------ | ---------------- |
| —        | PostgreSQL      | Start PostgreSQL service | `localhost:5432` |
| 1        | Backend         | `npm run dev:backend`    | `localhost:5001` |
| 2        | Staff Dashboard | `npm run dev:staff`      | `localhost:5173` |
| 3        | Admin Portal    | `npm run dev:admin`      | `localhost:5174` |
| 4        | Student App     | `npm run dev:student`    | `localhost:5555` |

Keep all four application terminals running while using SERVE.

Use `localhost`, not `127.0.0.1`, for the local browser applications.

### 8.7 Run the Student App on Android

First check available devices:

```
flutter devices
```

For an Android emulator:

```
npm run dev:student -- -d emulator-5554
```

Use the actual device ID displayed by `flutter devices`.

Android emulators access the host computer through:

```
http://10.0.2.2:5001
```

For a physical Android phone connected to the same Wi-Fi:

```
npm run dev:student -- -d <device-id> --lan
```

Allow port `5001` through Windows Firewall if required.

Google sign-in on an emulator or physical device additionally requires the backend to be accessible through a public HTTPS URL registered with Google. Refer to `docs/authentication.md`.

### 8.8 Test the complete workflow

Before demonstrating SERVE, verify the following workflow.

**Step 1 — Administrator**

- Open `http://localhost:5174`.
- Sign in using the account created through `admin:create`.

**Step 2 — Staff registration**

- Open `http://localhost:5173` in a separate browser profile.
- Select **Request access**.
- Enter name, email, password and canteen.
- The account remains pending until approved.

**Step 3 — Approve staff**

- Return to the Admin Portal.
- Open **Change requests**.
- Approve the staff member.
- Open the Staff page and select that staff member.
- Assign the required capabilities.
- Tick `CASHIER` if payment verification is needed.
- Click **Save permissions**.

Note: Approval grants `KITCHEN`, `MENU` and `PAUSE`. `CASHIER` must be assigned separately.

**Step 4 — Student sign-in**

- Open `http://localhost:5555` in a third browser profile.
- Select **Continue with Google**.
- Sign in using a verified `@srmap.edu.in` account.
- Register with the appropriate hostel.

**Step 5 — Place an order**

- Browse the menu.
- Add food items to the cart.
- Proceed to checkout.
- Submit the payment claim.

In DEMO mode, the app displays a labelled test QR. No real money is transferred.

**Step 6 — Verify payment**

- Open the Staff Dashboard.
- Go to the Cashier section.
- Review the pending payment claim.
- Confirm the payment.

**Step 7 — Prepare the order**

- Open the Orders section.
- Update the order through:

  `New → Preparing → Ready → Collected`
- Verify that the student app receives the status updates.

**Step 8 — Test order control**

- Use **Pause orders** in the Staff Dashboard.
- Verify that the canteen stops accepting new orders.
- Resume orders afterward.

**Step 9 — Verify reports**

- Open the Admin Portal.
- Check the Reports page for the order.

### Important: Browser sessions

All three web applications currently share one session cookie on `localhost`.

Signing in or signing out in one portal can replace or invalidate the session used by another portal.

For a multi-role demonstration, use separate browser profiles or Chrome Guest windows:

- Profile 1: Admin
- Profile 2: Staff
- Profile 3: Student

This is the expected workaround with the current authentication design.

---

## 9. Authentication and API

### Authentication

SERVE uses Better Auth for authentication and session management.

| Role    | Sign-in method     | Access rules                            |
| ------- | ------------------ | --------------------------------------- |
| Student | Google OAuth       | Verified `@srmap.edu.in` accounts       |
| Staff   | Email and password | Registration requires admin approval    |
| Admin   | Email and password | Accounts created through `admin:create` |

The backend validates the sign-in method and role.

Passwords are hashed using scrypt.

Web applications use HttpOnly session cookies. The native student application uses Bearer tokens.

Sessions last seven days.

### API structure

All main API routes are under `/api`.

| Base path        | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `/auth`          | Authentication, registration and session management |
| `/native-auth`   | Native mobile authentication                        |
| `/hostels`       | Hostel information                                  |
| `/service-areas` | Service area information                            |
| `/canteens`      | Canteen information                                 |
| `/menu`          | Menu browsing and management                        |
| `/cart`          | Cart quotes                                         |
| `/orders`        | Order creation, tracking and cancellation           |
| `/payments`      | Payment configuration and payment claims            |
| `/staff`         | Staff operations and kitchen management             |
| `/admin`         | Administrative operations and reports               |
| `/notifications` | Notification retrieval and read status              |
| `/health`        | Server and database health checks                   |

Examples of important endpoints:

| Method | Endpoint                 | Purpose                       |
| ------ | ------------------------ | ----------------------------- |
| GET    | `/api/health`            | Backend health                |
| GET    | `/api/health/db`         | Database health               |
| GET    | `/api/canteens`          | Retrieve canteens             |
| POST   | `/api/cart/quote`        | Calculate cart quote          |
| POST   | `/api/orders`            | Create an order               |
| GET    | `/api/orders/:id`        | Retrieve order details        |
| POST   | `/api/orders/:id/cancel` | Cancel an eligible order      |
| GET    | `/api/staff/orders`      | Retrieve staff orders         |
| GET    | `/api/admin/dashboard`   | Retrieve admin dashboard data |

The backend uses a consistent error response structure:

```
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Description of the error"
  }
}
```

For complete API details, see `docs/api.md`.

### Realtime communication

SERVE uses Socket.IO for live updates.

Important events include:

- `order.created`
- `order.payment_confirmed`
- `order.preparing`
- `order.ready`
- `order.collected`
- `order.cancelled`
- `payment.queue_changed`
- `menu.item_updated`
- `menu.item_availability_changed`
- `canteen.status_changed`
- `staff.approved`
- `staff.rejected`
- `notification.created`
- `auth.expired`

The backend assigns Socket.IO rooms according to the authenticated user's access.

---

## 10. Database

SERVE uses PostgreSQL with Prisma ORM.

The database contains 26 models and 11 migrations in the current repository.

### Important database models

| Model                       | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `ServiceArea`               | Groups related hostel and canteen operations |
| `Canteen`                   | Stores canteen information                   |
| `Hostel`                    | Stores hostel information                    |
| `Student`                   | Stores student profiles                      |
| `MenuCategory`              | Organizes menu categories                    |
| `MenuItem`                  | Stores food item information                 |
| `MenuItemService`           | Stores Day/Night pricing and availability    |
| `Order`                     | Stores student orders                        |
| `OrderItem`                 | Stores ordered items and price snapshots     |
| `Payment`                   | Stores payment status and claim information  |
| `Staff`                     | Stores staff information                     |
| `Admin`                     | Stores administrator information             |
| `StaffCanteenAssignment`    | Assigns staff to a canteen                   |
| `StaffAssignmentCapability` | Stores staff permissions                     |
| `AuthUser`                  | Authentication identities                    |
| `AuthSession`               | Authentication sessions                      |
| `Notification`              | Stores in-app notifications                  |
| `CanteenChangeRequest`      | Stores staff access requests                 |

### Database relationship overview

```
erDiagram
    ServiceArea ||--o{ Canteen : contains
    ServiceArea ||--o{ Hostel : serves
    Hostel ||--o{ Student : houses

    Canteen ||--o{ MenuCategory : has
    MenuCategory ||--o{ MenuItem : contains
    MenuItem ||--o{ MenuItemService : pricing

    Student ||--o{ Order : places
    Canteen ||--o{ Order : receives
    Order ||--o{ OrderItem : contains
    Order ||--|| Payment : has

    Canteen ||--o{ Staff : assigns
    Staff ||--|| StaffCanteenAssignment : assigned
    StaffCanteenAssignment ||--o{ StaffAssignmentCapability : grants

    AuthUser ||--o{ AuthSession : owns
    AuthUser ||--o| Student : linked
    AuthUser ||--o| Staff : linked
    AuthUser ||--o| Admin : linked
```

### Database design decisions

- PostgreSQL provides persistent relational data storage.
- Prisma manages database access and migrations.
- IDs use UUIDs.
- Monetary values are stored as integer paise.
- Order items preserve price snapshots.
- Staff assignments and permissions are stored separately.
- The backend enforces order and payment rules.

For more information, see `docs/database.md`.

---

## 11. Testing and Build

SERVE uses multiple testing tools to verify application behaviour.

### Available testing commands

Run commands from the repository root unless specified otherwise.

| Task                    | Command                                        |
| ----------------------- | ---------------------------------------------- |
| Backend tests           | `npm test --workspace backend`                 |
| Shared web tests        | `npm test --workspace @serve/web-shared`       |
| Staff dashboard tests   | `npm test --workspace @serve/staff`            |
| Admin portal tests      | `npm test --workspace @serve/admin`            |
| Flutter analysis        | `cd apps\student; flutter analyze`             |
| Flutter tests           | `cd apps\student; flutter test`                |
| Playwright E2E tests    | `npm run test:e2e`                             |
| Type checking           | `npm run typecheck`                            |
| Linting                 | `npm run lint`                                 |
| Formatting check        | `npm run format:check`                         |
| Build npm applications  | `npm run build`                                |
| Build Flutter web       | `cd apps\student; flutter build web --release` |
| Single-domain web build | `npm run build:web`                            |

### End-to-end testing

Playwright tests verify important workflows, including:

- Staff registration and approval.
- Payment confirmation.
- Order preparation and pickup.
- Realtime updates.
- Menu changes.
- Canteen pausing.
- Staff access restrictions.

The E2E suite uses its own test database and test application ports.

> **Warning:** Automated backend and E2E tests rebuild `serve_test`. Do not point the test environment at a database containing important data.

---

## 12. Troubleshooting

| Problem                                     | Possible solution                                       |
| ------------------------------------------- | ------------------------------------------------------- |
| `npm ci` fails                              | Check that Node.js 22.12 or newer is installed          |
| `psql` is not recognized                    | Use the full PostgreSQL installation path               |
| Backend environment validation fails        | Compare `backend/.env` with `backend/.env.example`      |
| `BETTER_AUTH_SECRET` is missing             | Generate and configure the secret                       |
| PostgreSQL connection refused               | Start PostgreSQL and check port 5432                    |
| Database password authentication fails      | Verify the database username and password               |
| Prisma Client is missing                    | Run `npm run prisma:generate --workspace backend`       |
| Database tables are missing                 | Run `npm run prisma:migrate:deploy --workspace backend` |
| Canteen dropdown is empty                   | Run `npm run db:seed --workspace backend`               |
| Flutter command not found                   | Install Flutter and add it to PATH                      |
| Flutter SDK version mismatch                | Install the required Flutter/Dart version               |
| Port already in use                         | Stop the process using that port                        |
| Staff or admin dashboard cannot reach SERVE | Check that the backend is running                       |
| `VITE_API_URL` missing                      | Create the relevant dashboard environment file          |
| Google redirect URI mismatch                | Verify the OAuth redirect URI                           |
| Student is not eligible                     | Use a verified `@srmap.edu.in` account                  |
| Staff cannot access Cashier                 | Ask an admin to grant the `CASHIER` capability          |
| Session expires after using another portal  | Use separate browser profiles                           |
| Android emulator cannot connect             | Use `10.0.2.2` instead of `localhost`                   |
| `db:setup:local` fails on Windows           | Use the PostgreSQL `psql` commands in section 7         |

For more setup help, see `docs/development.md`.

---

## 13. GitHub Contribution Guide

Contributions should be made through feature branches and pull requests.

Do not commit directly to `main`.

### Step 1: Fork the repository

If you do not have direct write access:

1. Open the SERVE repository on GitHub.
2. Click **Fork**.
3. Select your GitHub account.

### Step 2: Clone your fork

```
git clone https://github.com/<your-username>/Serve-final.git
cd Serve-final
```

### Step 3: Add the original repository

```
git remote add upstream https://github.com/pranathigit11/Serve-final.git
git remote -v
```

- `origin` refers to your fork.
- `upstream` refers to the original repository.

### Step 4: Create a feature branch

```
git checkout main
git pull upstream main
git checkout -b feature/short-description
```

Example:

```
git checkout -b feature/student-order-history
```

### Step 5: Make changes and test

Before committing, run the relevant checks:

```
npm run lint
npm run typecheck
npm run build
```

Run the appropriate tests for the modules you changed.

### Step 6: Commit your changes

```
git add <changed-files>
git commit -m "feat: add student order history"
```

Use clear commit messages.

Common prefixes:

| Prefix     | Purpose            |
| ---------- | ------------------ |
| `feat`     | New feature        |
| `fix`      | Bug fix            |
| `docs`     | Documentation      |
| `refactor` | Code restructuring |
| `test`     | Tests              |
| `chore`    | Maintenance        |

### Step 7: Push your branch

```
git push -u origin feature/short-description
```

### Step 8: Create a Pull Request

1. Open your fork on GitHub.
2. Select **Compare & pull request**.
3. Set the original repository as the base repository.
4. Select `main` as the base branch.
5. Add a clear title and description.
6. Explain what changed and how it was tested.
7. Submit the Pull Request for review.

### Step 9: Synchronize your fork

```
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

Resolve merge conflicts carefully and test the project before pushing.

---

## 14. Project Status and License

### Current development status

| Component                                        | Status                 |
| ------------------------------------------------ | ---------------------- |
| Backend foundation                               | Complete               |
| PostgreSQL schema, migrations and seed           | Complete               |
| Authentication and authorization                 | Complete               |
| REST APIs                                        | Complete               |
| Socket.IO realtime communication                 | Complete               |
| Flutter Student App                              | Complete               |
| React Staff Dashboard                            | Complete               |
| React Admin Portal                               | Complete               |
| Unit, integration, widget and E2E tests          | Complete               |
| Single-domain deployment preparation             | Complete, not deployed |
| Real Razorpay integration                        | Not started            |
| Independent security review of deployed instance | Not started            |

### Planned enhancements

- Complete real Razorpay payment integration.
- Add push notifications through FCM/APNs.
- Deploy SERVE on a public domain.
- Add Redis adapter support for multiple backend instances.
- Explore student hostel/canteen change requests.
- Explore demand forecasting and operational analytics.

### License

No license file is currently included in this repository.

Until the project owners specify a license, ask for permission before reusing or redistributing the code.

### Brand

The official SERVE logo and colour palette are maintained in `brand/`.

The project tagline is:

**Order. Track. Collect.**

### Further documentation

- Architecture
- API Reference
- Database
- Authentication
- Development Setup
- Deployment
- Frontend Architecture
- Frontend Integration
- Student Application

---

**SERVE — Order. Track. Collect.**

A connected platform for a more organized campus canteen experience.
