**SERVE — CTO Submission**

Lakshmi Pranathi Balusu, CTO  
Capstone Project 1  
Prepared with Kruthika Konni (CEO)

In SERVE, students order from the canteen on their phones, the cashier confirms payment, and the kitchen works through paid orders on a live board. For this review, payments are simulated: no real money moves through the system.

The panel asked us to go deeper technically and to show how SERVE would cope with many users at once. My part of our seven-step plan is Steps 1–3 (architecture, load testing and optimisation), plus my role in the validation sessions (Step 5) and the swap demo (Step 7).

# Step 1 — Product architecture

The architecture diagram below shows the three client applications, the shared web packages, the Express backend, PostgreSQL, authentication, realtime updates, background jobs and external services. All client applications communicate with the backend; none connects directly to the database.

![](media/cto-pranathi-image1.png)

*SERVE*

## 

## 

## What each part does

The Student App is built with Flutter and supports sign-in, browsing, cart and checkout, payment, order tracking, order history, notifications and profile screens. The Staff Dashboard is built with React and provides the kitchen board, cashier queue, counter sales, menu management and Pause/Resume controls. The Admin Portal is also built with React and is used to manage canteens, Day/Night schedules, staff approvals, permissions, menus, prices, payment settings and reports.

The two React applications share code through packages/web-shared for authentication, API calls and live updates. packages/contracts defines the API response and event structures used by both applications.

The backend is one Node.js process running Express. Requests pass through logging, security headers, the CORS allowlist, rate limits, session and role checks, and Zod input validation. Feature modules then apply business rules and save changes in database transactions.

Better Auth handles sign-in. Students use Google sign-in, restricted to verified @srmap.edu.in accounts. Staff and administrators use email and password authentication. The backend checks the session and role against the database on each request, so revoked sessions stop working immediately.

PostgreSQL stores the application data and Prisma is used to access it. The schema contains 26 models and the repository has 11 migrations. Database constraints enforce rules such as one active canteen per service area, one approved staff account per canteen, and immutable order lines after placement.

Socket.IO sends updates to the relevant student, canteen staff and administrators. Events are published only after the database transaction commits. Two background timers run in the backend: one checks the Day/Night canteen schedule every 30 seconds, and the other expires unclaimed unpaid orders after the 20-minute payment window.

Google OAuth is used for student sign-in. UPI and Razorpay are shown in the diagram as future real-money options. The Razorpay adapter exists but is not active.

## How one order moves through the system

1.  The student places an order. The app sends item IDs and quantities. The backend calculates the prices, checks that the canteen is open, and saves the order, its items and a pending payment in one transaction.

2.  The student taps “I've paid”. This puts the order in the cashier's queue but does not mark it as paid.

3.  The cashier confirms the payment. Only then does the order appear on the kitchen board.

4.  The kitchen moves the order through Preparing, Ready and Collected. Each status update is sent to the student's screen.

If two people try to update the same order at once, a conditional update allows only the first valid change. The second person receives an order-changed message. The same protection prevents duplicate payment confirmation. An idempotency key also prevents a repeated Place Order request from creating a second order.

## Payments in the demonstration

The student sees a clearly labelled test QR and selects the payment-claim option. The cashier then presses “Simulate payment received”. Simulated payments are stored separately and excluded from revenue reports. No real money moves through this workflow.

One issue must be fixed before any real deployment. On a server running the mock payment provider, calling the simulated-gateway endpoints directly can mark an order as paid without cashier confirmation. This was reproduced on the test database. It does not affect the current demonstration because no money is involved, but it remains a production-readiness issue.

# 

# Step 2 — Load testing

Status: first round complete in a development environment. The same tests still need to be run on our own machine, so these figures are not yet a final statement of how many users SERVE can handle.

I used k6 tests in the load-tests folder. The main test follows the order flow: price quote, place order, payment claim, cashier confirmation, three kitchen status changes and a student order check. Separate tests cover menu browsing, staff pages, realtime connections and a baseline without sign-in. The main test was run with 10, 50, 100, 250 and 500 simulated users, each waiting one second between actions.

The tests create accounts and orders and therefore run only against an isolated test database. They refuse non-local addresses, and all payment confirmations are simulated.

## Results — development container

The container had 4 CPU cores and 16 GB RAM. The backend, database and k6 load generator shared the machine. The results describe this test environment, not the capacity of a production server.

| **Simulated users** | **Requests/sec** | **p95 per request** | **p95 per complete order** | **Errors** | **Backend CPU** |
|---------------------|------------------|---------------------|----------------------------|------------|-----------------|
| 10                  | 54               | 52 ms               | 0.37 s                     | 0%         | 60%             |
| 50                  | 163              | 254 ms              | 1.7 s                      | 0%         | 110%            |
| 100                 | 174              | 575 ms              | 3.8 s                      | 0%         | 120%            |
| 250                 | 181              | 1.56 s              | 10.6 s                     | 0%         | 128%            |
| 500                 | 170              | 3.31 s              | 22.4 s                     | 0%         | 131%            |

The p95 per-request figure is the time within which 95% of individual API calls finished. The complete-order figure is the API time for the eight calls in one test order. It excludes payment time, cashier checking, food preparation and waiting.

## What the results show

- Throughput levelled off at about 163–181 requests per second. Above roughly 50 simulated users, adding more users increased waiting time rather than throughput. No errors were recorded.

- The backend CPU was the main limit in this test, not PostgreSQL. The database had 10 connections available, with at most 6 in use.

- Signed-in requests were more expensive than public requests. The unauthenticated baseline reached 390 requests per second at 44% CPU, while signed-in browsing reached 208 requests per second at 124% CPU.

- Session and role checks add several database round trips to each signed-in request. Prisma query handling accounted for about 27% of sampled CPU time.

- Approximately 500 open realtime connections used around 9% CPU in the separate realtime test.

## 

## Current capacity finding

Our target is for 95% of individual requests to finish within 500 ms. In this development-container test, the main order flow met that target at 50 simulated users (254 ms p95) and missed it at 100 (575 ms p95). This does not mean the system supports a specific number of real concurrent students. Each simulated user repeats actions much more frequently than a typical student. We need actual peak-hour order figures and a test on the intended machine before making a real capacity claim.

Still to do: repeat the same tests on our own machine and record its specifications alongside the results.

# 

# Step 3 — Performance optimisation

Status: planned. No optimisation has been made yet, so there are no before-and-after results.

The existing indexes support the kitchen board, cashier queue and unpaid-order expiry queries. Since the database was not the bottleneck in the first test, adding more indexes is not the immediate priority. This can be reviewed again when the database contains a more realistic volume of orders.

Caching appears more promising. A short-lived cache for user-role information could reduce repeated database lookups, while caching canteen menus could make menu requests cheaper. Any cache must be invalidated when a role, account status, menu or price changes, otherwise users could see stale or incorrect information.

The backend already uses background jobs for Day/Night switching and unpaid-order expiry. The measured bottleneck is work performed during each request, so adding more background jobs is unlikely to improve the main order flow. Running multiple backend processes could use the other CPU cores, but would require a shared Socket.IO adapter so that events reach clients connected to different processes.

After Kruthika and I agree on the first change, I will implement one improvement and repeat the same order-flow test on the same machine. I will compare requests per second, p95 latency and CPU usage. No performance gain will be claimed until the second test confirms it.

# 

# My contribution to Step 5 — Validation sessions

Kruthika and I will conduct the six validation sessions together. She will lead the questions about current customer behaviour, costs and willingness to pay. I will lead at least three sessions myself.

I will observe participants using the demo canteen and note where they hesitate or get stuck, including the screen and task involved. The tasks will reflect each participant's role: students will place and track an order; cashiers will confirm and reject a payment; kitchen staff will move an order from new to collected; and managers will pause and resume orders.

After the sessions, I will group repeated problems into a short list of technical and product improvements and agree priorities with Kruthika. No validation sessions have taken place yet.

# 

# My contribution to Step 7 — Swap demo

During the swap demo, Kruthika will present SERVE and I will answer the business questions. I need to be able to explain who might pay for SERVE, the current status of the six business leads, what users report during validation and the likely operating costs. Pricing remains a hypothesis to test, none of the six leads is a confirmed customer, and hosting costs are not yet known because we do not have hosting quotes.
