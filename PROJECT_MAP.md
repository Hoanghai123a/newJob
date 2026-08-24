# PROJECT_MAP.md

## Purpose

This file is the project map for AI coding agents.

Agents must read this file or query CodeGraph before editing code.

## Tech stack

- Frontend: React 19, TanStack Router (file-based routes), TanStack Query, TanStack Start (SSR)
- Backend: PocketBase (BaaS) + Nitro server (SSR/API routes)
- Database: PocketBase (SQLite-based, accessed via JS SDK `pocketbase@0.26`)
- UI library: Radix UI + shadcn/ui components, Tailwind CSS v4, Framer Motion
- Build tool: Vite 7 (with `@lovable.dev/vite-tanstack-config`)
- Deploy: PM2 (Node server from `.output/server/index.mjs`), Netlify optional
- Other: PWA (service worker), Recharts, xlsx, Zod

## Entry points

| File                    | Role                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `src/server.ts`         | Nitro server entry — wraps TanStack Start server-entry, error handling |
| `src/start.ts`          | TanStack Start instance — request middleware                           |
| `src/router.tsx`        | Creates TanStack Router with `routeTree.gen.ts` + QueryClient          |
| `src/routes/__root.tsx` | Root layout — QueryClientProvider, AuthProvider, Toaster, PWA init     |
| `src/routeTree.gen.ts`  | Auto-generated route tree (do NOT edit manually)                       |

## Important directories

| Path                     | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `src/routes/`            | File-based routes (TanStack Router convention)                   |
| `src/routes/api/`        | Server-side API routes (Nitro handlers)                          |
| `src/components/ui/`     | shadcn/ui primitive components (button, dialog, card, etc.)      |
| `src/components/layout/` | Layout components (BottomNav, PageContainer, BackButton, etc.)   |
| `src/components/`        | Feature-specific components (approvals, employment, staff, etc.) |
| `src/lib/`               | Business logic, PocketBase client, auth, utilities               |
| `src/hooks/`             | Custom React hooks                                               |
| `public/`                | Static public files, service worker                              |

## Route structure

### Public routes

| Route       | File                  | Description               |
| ----------- | --------------------- | ------------------------- |
| `/login`    | `routes/login.tsx`    | Login page                |
| `/register` | `routes/register.tsx` | Registration page         |
| `/pending`  | `routes/pending.tsx`  | Waiting-for-approval page |
| `/about`    | `routes/about.tsx`    | About page                |

### Authenticated layout (`/_authenticated`)

Layout file: `routes/_authenticated.tsx` — guards auth, renders `<BottomNav>`.

| Route                    | File                                              | Description                              |
| ------------------------ | ------------------------------------------------- | ---------------------------------------- |
| `/` (index)              | `routes/index.tsx`                                | Dashboard — feature tiles, unread badges |
| `/check-attendance`      | `routes/_authenticated/check-attendance.tsx`      | View attendance/salary sheets            |
| `/advances`              | `routes/_authenticated/advances.tsx`              | Salary advance requests                  |
| `/work-history`          | `routes/_authenticated/work-history.tsx`          | Employment history                       |
| `/news`                  | `routes/_authenticated/news.tsx`                  | Recruitment news board                   |
| `/chat`                  | `routes/_authenticated/chat.tsx`                  | Group chat                               |
| `/notebook`              | `routes/_authenticated/notebook.tsx`              | Daily notebook (admin)                   |
| `/account`               | `routes/_authenticated/account.tsx`               | User profile/settings                    |
| `/force-change-password` | `routes/_authenticated/force-change-password.tsx` | Forced password change                   |

### Staff routes

| Route                      | File                                                | Description        |
| -------------------------- | --------------------------------------------------- | ------------------ |
| `/staff`                   | `routes/_authenticated/staff.tsx`                   | Staff layout/index |
| `/staff` (index)           | `routes/_authenticated/staff.index.tsx`             | Staff dashboard    |
| `/staff/workers`           | `routes/_authenticated/staff.workers.index.tsx`     | Worker list        |
| `/staff/workers/:workerId` | `routes/_authenticated/staff.workers.$workerId.tsx` | Worker detail      |
| `/staff/recruited`         | `routes/_authenticated/staff.recruited.tsx`         | Recruited workers  |
| `/staff/export`            | `routes/_authenticated/staff.export.tsx`            | Export data        |
| `/staff/approvals`         | `routes/_authenticated/staff.approvals.tsx`         | Approval requests  |

### Admin routes

| Route                       | File                                                 | Description                 |
| --------------------------- | ---------------------------------------------------- | --------------------------- |
| `/admin/accounts`           | `routes/_authenticated/admin/accounts.tsx`           | Accounts layout             |
| `/admin/accounts` (index)   | `routes/_authenticated/admin/accounts.index.tsx`     | Account list                |
| `/admin/accounts/stats`     | `routes/_authenticated/admin/accounts.stats.tsx`     | Account statistics          |
| `/admin/accounts/factories` | `routes/_authenticated/admin/accounts.factories.tsx` | Factory management          |
| `/admin/accounts/logs`      | `routes/_authenticated/admin/accounts.logs.tsx`      | Activity logs               |
| `/admin/staff`              | `routes/_authenticated/admin/staff.tsx`              | Staff management layout     |
| `/admin/staff` (index)      | `routes/_authenticated/admin/staff.index.tsx`        | Staff list                  |
| `/admin/approvals`          | `routes/_authenticated/admin/approvals.tsx`          | Admin approval management   |
| `/admin/imports`            | `routes/_authenticated/admin/imports.tsx`            | Excel imports               |
| `/admin/settings`           | `routes/_authenticated/admin/settings.tsx`           | System settings             |
| `/admin/workforce`          | `routes/_authenticated/admin/workforce.tsx`          | Workforce/recruitment stats |

### API routes (server-side)

| Route                              | File                                        | Description             |
| ---------------------------------- | ------------------------------------------- | ----------------------- |
| `/api/public/pb/*`                 | `routes/api/public/pb.$.ts`                 | PocketBase proxy        |
| `/api/public/pocketbase-auth`      | `routes/api/public/pocketbase-auth.ts`      | Auth config endpoint    |
| `/api/public/app-logo`             | `routes/api/public/app-logo.ts`             | Dynamic app logo        |
| `/api/public/app-icon`             | `routes/api/public/app-icon.ts`             | App icon (favicon)      |
| `/api/public/app-icon-192`         | `routes/api/public/app-icon-192.ts`         | PWA icon 192px          |
| `/api/public/app-icon-512`         | `routes/api/public/app-icon-512.ts`         | PWA icon 512px          |
| `/api/public/manifest.webmanifest` | `routes/api/public/manifest.webmanifest.ts` | PWA manifest            |

## Key libraries (`src/lib/`)

| File                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `pocketbase.ts`              | PocketBase client instance (`pb`)                        |
| `pocketbase-config.ts`       | PocketBase URL config                                    |
| `auth.tsx`                   | AuthProvider context, useAuth hook, login/logout/refresh |
| `user-approval.ts`           | Check if user is approved                                |
| `profile.ts`                 | Profile completeness check                               |
| `factories.ts`               | Factory CRUD helpers                                     |
| `main-houses.ts`             | Main-house data helpers                                  |
| `employment.ts`              | Employment record helpers                                |
| `salary.ts`                  | Salary calculation                                       |
| `payroll-cycle.ts`           | Payroll cycle utilities                                  |
| `advances` (in advances.tsx) | Advance request logic (inline)                           |
| `delegations.ts`             | Permission delegation                                    |
| `staff-permissions.ts`       | Staff permission checks                                  |
| `staff-cache.ts`             | Staff list caching                                       |
| `staff-log.ts`               | Staff activity logging                                   |
| `approval-requests.ts`       | Approval request types & helpers                         |
| `app-settings.ts`            | App settings (company name, logo, etc.)                  |
| `excel.ts`                   | Excel import/export utilities                            |
| `money.ts`                   | Currency formatting                                      |
| `date-utils.ts`              | Date formatting helpers                                  |
| `vn-banks.ts`                | Vietnamese bank list                                     |
| `seen.ts`                    | "Last seen" timestamps for unread badges                 |
| `image-compress.ts`          | Image compression before upload                          |
| `cccd-qr.ts`                 | CCCD (citizen ID) QR parsing                             |
| `cccd-versions.ts`           | CCCD version tracking                                    |
| `account-identity.ts`        | Account identity helpers                                 |
| `uid.ts`                     | UID generation                                           |
| `pwa-install.ts`             | PWA install prompt logic                                 |
| `error-capture.ts`           | Global error capture for SSR                             |
| `error-page.ts`              | Branded error page HTML                                  |
| `server-app-brand.ts`        | Server-side branding (logo from PB)                      |
| `utils.ts`                   | `cn()` classname merge utility                           |

## Key components

| File                                              | Purpose                         |
| ------------------------------------------------- | ------------------------------- |
| `components/layout/BottomNav.tsx`                 | Bottom navigation bar           |
| `components/layout/PageContainer.tsx`             | Standard page wrapper           |
| `components/layout/BackButton.tsx`                | Navigation back button          |
| `components/layout/InstallFloatingBanner.tsx`     | PWA install banner              |
| `components/layout/IosInstallGuideDialog.tsx`     | iOS install instructions        |
| `components/layout/DesktopInstallGuideDialog.tsx` | Desktop install instructions    |
| `components/layout/BrandHeadLinks.tsx`            | Dynamic brand head tags         |
| `components/dashboard/FeatureTile.tsx`            | Dashboard feature tile card     |
| `components/approvals/ApprovalForm.tsx`           | Approval request form           |
| `components/approvals/ApprovalDetail.tsx`         | Approval detail view            |
| `components/approvals/ExcelPreview.tsx`           | Excel file preview              |
| `components/approvals/ImageViewer.tsx`            | Image viewer                    |
| `components/staff/WorkerQuickDrawer.tsx`          | Quick worker info drawer        |
| `components/staff/QuickWorkerAccountDialog.tsx`   | Quick create worker account     |
| `components/employment/UserWorkHistoryPanel.tsx`  | Work history panel              |
| `components/users/UserCombobox.tsx`               | User search combobox            |
| `components/factories/FactoryManagersDialog.tsx`  | Factory managers dialog         |
| `components/cccd/CccdManager.tsx`                 | CCCD document manager           |
| `components/cccd/CccdVersionViewer.tsx`           | CCCD version viewer             |
| `components/workforce/RecruitChartDialog.tsx`     | Recruitment chart dialog        |

## Agent navigation rule

Before editing:

1. Use CodeGraph first.
2. Read this file if needed.
3. Identify the smallest relevant file set.
4. Do not scan the whole repository unless necessary.
5. Do not refactor unrelated code.

## Common task routing

| Task type          | Start here                                                                      |
| ------------------ | ------------------------------------------------------------------------------- |
| UI bug             | `src/routes/` (page) or `src/components/`                                       |
| API/data issue     | `src/lib/` or `src/routes/api/`                                                 |
| Business logic     | `src/lib/` or inline in the route file                                          |
| Routing issue      | `src/routes/`, `src/router.tsx`, `src/routeTree.gen.ts`                         |
| Build error        | exact file from build error, `vite.config.ts`                                   |
| Styling issue      | related component first, `src/styles.css` second                                |
| Auth issue         | `src/lib/auth.tsx`, `src/lib/user-approval.ts`, `src/routes/_authenticated.tsx` |
| PWA issue          | `src/lib/pwa-install.ts`, `public/sw.js`, manifest route                        |

## Do not edit unless required

- `node_modules/`
- `.output/` (build output)
- `src/routeTree.gen.ts` (auto-generated)
- unrelated formatting
- lockfile unless dependency changed
