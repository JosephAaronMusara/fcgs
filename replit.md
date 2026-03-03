# FCGS School Management System

## Overview

This is a full-stack school management system for First Choice Group of Schools (FCGS), providing comprehensive functionality for managing educational institutions. It supports multi-tenancy, allowing an organization to manage multiple schools, each with role-based access control for administrators, teachers, students, and parents. The system covers student and staff management, academic records, attendance, fees, and includes modules for e-learning resources, timetabling, lesson planning, point of sale, and hostel management. The project aims to streamline school operations, enhance communication, and provide a robust digital platform for the FCGS community.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Components**: Shadcn/ui built on Radix UI
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode)
- **Build Tool**: Vite
- **Architecture**: Page-based with protected routes; authentication managed via React context.
- **Multi-Tenant Fetch Convention**: All frontend API calls MUST use one of: (1) TanStack Query default `queryFn` (auto-includes X-School-Id), (2) `apiRequest` for mutations, or (3) `schoolFetch` for custom fetch calls (e.g., FormData uploads). NEVER use raw `fetch()` for internal API calls -- always use `schoolFetch` from `@/lib/queryClient` which automatically adds X-School-Id header and credentials. Raw `fetch` is only acceptable for external URLs (e.g., presigned upload URLs to cloud storage).

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ESM)
- **API Design**: RESTful JSON API (`/api` prefix)
- **Authentication**: Passport.js (local strategy, session-based) with bcrypt for password hashing
- **Architecture**: Layered approach (Routes, Storage, Auth) for modularity.

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: drizzle-kit

**Key Features & System Design:**
- **Multi-Tenancy**: Support for Organizations managing multiple Schools with configurable feature toggles (e.g., enableHostel, enablePOS).
- **Role-Based Access Control**: Granular permissions system with 79 permissions across 17 categories and 5 default access groups (School Admin, Teacher, Quality Control Officer, Assistant Teacher, Org HQ). Users inherit permissions from groups with individual overrides. Staff page includes per-user Access Rights dialog for modifying permissions beyond group defaults with "Reset to Group Default" button.
- **Multi-Campus Login System**: Role-specific login (School Staff, Student, Parent, Org HQ) with organization-level dashboards for `org_admin` to manage and access multiple schools.
- **Academic Settings**: Configurable academic years, terms, and examination boards (ZIMSEC, Cambridge, HEXCO).
- **School Settings**: Comprehensive school information management including branding (logo, stamp), principal details, and module toggles.
- **School Termination & Archival**: Schools are archived (not deleted) after a 72-hour countdown. During countdown, users can still log in but the system is in read-only mode (all POST/PUT/DELETE blocked via middleware). A yellow persistent banner shows countdown. 15 minutes before lockout (1 hour remaining), a warning modal appears. At 1 hour remaining, all users are forced out and no new logins accepted. After countdown expires, school is archived. Archived schools are accessible by HQ members via the Archive button (next to notifications). Schools can be restored from both pending termination and archived states.
- **Staff Management**: Redesigned interface, Excel/CSV import/export, user account management (create, view, reset password, activate/deactivate), subject/class assignment, mobile ID reset for attendance apps, and per-user access rights management with custom permission overrides.
- **Student Management**: Consistent interface with staff management, bulk operations, filters, Excel/CSV import/export, user account management, subject assignment, and student transfer functionality.
- **Communication System**: Integrated service for sending notifications via Email (SMTP) and SMS (Econet Zimbabwe), with phone number normalization and communication logs. All outgoing communications (email, SMS) automatically create in-app notifications for recipients who have user accounts. Newsletter publishing also broadcasts in-app notifications to all users in the target audience. The notification panel (bell icon in header) shows channel badges (Email, SMS, Newsletter) for each notification.
- **360 Student Profile**: Comprehensive student view accessible via sidebar (school admin/teacher/org admin). Search bar finds students by name or admission number. Three-column layout: Left (personal info, parent, enrolled subjects, fees status), Middle (exam results with dropdown selector, summary stats with class/stream positions, performance-over-time chart, subject performance chart), Right (work written grid with tests/exercises/fortnights counts per subject, subject performance by assessment type). Bottom sections: library book borrowings with pagination, disciplinary records, attendance calendar heatmap showing monthly presence/absence with color-coded status indicators. Backend endpoint: GET /api/student-profile/:studentId (with optional examId query param), GET /api/students/search.
- **360 Staff Profile**: Comprehensive staff view accessible via sidebar under Human Resources (school admin/org admin). Search bar finds staff by name or staff number. Profile header with avatar, contact info, role, and status. Two-column layout: Left (Timetable with today's and upcoming lessons), Right (Subjects Taught with paginated cards showing work given table per assessment type and student performance line charts by exam). Bottom section: Staff Attendance calendar heatmap with color-coded status indicators (present/on_time=emerald, late=amber, absent=red, excused/leave=sky) and summary stats. Backend endpoints: GET /api/staff/search, GET /api/staff-profile/:staffId.
- **Modules Implemented**:
    - **Assessments**: Assessment configuration with dynamic papers (configurable number of papers with weights summing to 100%), exam types, and comment pools.
    - **Marks Entry**: Student marks entry per assessment with dynamic paper columns, automatic weighted percentage calculation, grade assignment based on boundaries, pool-based or custom comments, and attendance status tracking.
    - **Academic Reports Hub**: Three-tier navigation system (Stream Hub → Class Level → Report Cards). Hub view shows stream-level progress/average stats with Options (class-level drill-down, stream merit list, stream analytics) and Reports (class-picker) dropdowns. Class-level view shows subject progress per class with Missing Marks, Merit List, Analytics, and Reports actions. Report Cards view shows individual student report slips with send/download. Backend APIs at `/api/report-hub/*` (stream-stats, class-progress, missing-marks, class-merit, class-analytics, stream-merit, stream-analytics, stream-classes) with school-scoped access control.
    - **Library Management**: Full library system with 5 tabs (Dashboard, Catalog, Circulation, Digital Resources, Fines). Dashboard groups books by title showing per-class/stream cards with availability stats (Available/Borrowed/Damaged/Lost) with subject filter and search. Catalog has category+subject filters. Add Book form has title autocomplete with auto-fill of author/ISBN/publisher/subject/category fields, and Class/Level selector. Backend prevents duplicate books with same title+classId. Books have classId field linking to classes for stream/level tracking.
    - **Timetable/Scheduling**: Class schedule management.
    - **E-Logbook**: Teacher lesson documentation.
    - **POS (Point of Sale)**: Inventory, sales, Sage CSV export.
    - **Newsletters**: School communication publishing.
    - **E-Schemes**: Lesson planning.
    - **Hostel Roll Call**: Boarding student attendance.
    - **Student Applications**: Public admissions form.
    - **Activity Logs**: Comprehensive audit trail with category/date filters, pagination, and TXT export. Tracks login/logout, staff/student/school CRUD, settings changes. Located in Settings > Activity Logs tab. Also available at org-level in Global Settings > Activity Logs with cross-school filtering.

### PWA (Progressive Web App)
- **Manifest**: `client/public/manifest.json` — app name, icons, theme color (#1b2a5c), standalone display
- **Service Worker**: `client/public/sw.js` — network-first strategy with offline cache fallback for static assets; API calls are never cached
- **Icons**: Generated from FCGS logo at 48, 72, 96, 144, 192, 512px sizes + apple-touch-icon (180px)
- **Meta Tags**: Full iOS/Android/Windows compatibility in `client/index.html`
- **Install**: Users can add to home screen on mobile devices for app-like experience

### Security Middleware
- **Helmet.js**: Secure HTTP headers (CSP disabled for compatibility with Vite dev)
- **CORS**: Configurable via `ALLOWED_ORIGINS` env var (comma-separated); defaults to allow all in dev
- **Rate Limiting**: Login endpoint (20 req/15min), general API (200 req/min)
- **Health Check**: `GET /api/health` returns status, timestamp, and uptime

### Build and Deployment
- **Development**: `npm run dev` (Express with tsx)
- **Production Build**: Custom script with esbuild (server) and Vite (client)
- **Path Aliases**: `@/*` (client), `@shared/*` (shared), `@assets` (attached assets)

## External Dependencies

### Database
- **PostgreSQL**: Primary database.
- **pg**: PostgreSQL client.

### Authentication & Security
- **passport**: Authentication middleware.
- **passport-local**: Local authentication strategy.
- **bcrypt**: Password hashing.
- **express-session**: Session management.
- **helmet**: Secure HTTP headers.
- **cors**: Cross-origin resource sharing.
- **express-rate-limit**: API rate limiting.

### UI Component Libraries
- **@radix-ui/***: Headless UI primitives.
- **shadcn/ui**: Pre-styled components.
- **lucide-react**: Icons.
- **class-variance-authority**: Styling utility.
- **cmdk**: Command menu.

### Data & Forms
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling.
- **@hookform/resolvers**: Form validation.
- **zod**: Schema validation.
- **drizzle-zod**: Zod schemas from Drizzle.
- **date-fns**: Date manipulation.

### Development Tools
- **Vite**: Frontend build tool.
- **esbuild**: Server-side bundling.
- **drizzle-kit**: Database migrations.
- **TypeScript**: Type checking.

### Communication Services
- **SMTP**: For email notifications.
- **Econet Mobile Messaging Gateway**: For SMS notifications (Econet Zimbabwe specific).