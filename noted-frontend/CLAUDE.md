# Noted — frontend

Angular 22 SPA. See the root `CLAUDE.md` for the domain model; it matters more than
anything here.

## Commands

```bash
npm start     # ng serve, http://localhost:4200
npm run build
npm test      # Vitest
npm run lint  # eslint --fix
npm run format
```

## Stack

- **Angular 22**, standalone components, zoneless. Change detection is OnPush by
  default, so never write `changeDetection:` in a `@Component` — opting out is a lint
  error and restating the default is noise.
- **Angular Material** for components, themed from the palette in `src/styles.css` via
  the `--mat-sys-*` tokens. Add a component's module to a component's `imports`; there is
  no shared barrel module.
- **Tailwind v4** for layout and spacing, via `@import 'tailwindcss'` in `src/styles.css`.
  There is no `tailwind.config`; configure in CSS.

## Conventions

**Signals everywhere.** Use `input()` / `output()`, `signal`, `computed`, `linkedSignal`,
and `resource` for async. Do not add `@Input()`/`@Output()` decorators, `BehaviorSubject`
state, or `ngOnChanges`. RxJS is available but is not the default answer.

**Components** are standalone with a separate `.html` template. One folder per component
under `src/app/components/<name>/`, files named `<name>.ts` / `<name>.html`. Class names
are plain and undecorated — `Week`, `Day`, `Topbar` — not `WeekComponent`. Selector prefix
is `app-`.

**Templates** use built-in control flow (`@if`, `@for`, `@let`), never `*ngIf` / `*ngFor`.

**Imports** of app code are written as `app/components/day/day`, not as deep relative
paths; `tsconfig.json` maps `app/*` for it. Prettier sorts imports into groups — the
grouping is configured in `.prettierrc.json` and is enforced, so let `npm run format`
arrange them.

**Styling.** Layout and spacing in Tailwind utility classes in the template. Colours come
from the CSS custom properties in `src/styles.css` — those are lifted from the original
spreadsheet and are the app's identity, so pull from them rather than inventing new
values or hardcoding hex. The `--app-*` aliases in that file are the single place that
decides which palette colour plays which UI role; change the mapping there.

Only chrome lives in CSS. Category and project colours come from the API, because they are
the user's data and he edits them — read them off `AppData`, never off a stylesheet.

**Tests** sit next to what they cover as `<name>.spec.ts` and are written before the code
they describe. Vitest with `TestBed`; components get their inputs through
`componentRef.setInput`, and anything touching the API uses `provideHttpClientTesting`
rather than a live server. A flushed response needs a turn of the event loop before it
reaches the resource that asked for it; `await settle()` from `testing/settle` covers that.

**Icons** are Material Symbols (rounded), and nothing else: `<mat-icon>add</mat-icon>`.
The font is served from `node_modules`, not a CDN.

**Dates** are shown with `| date` and no format argument (or an injected `DatePipe`); the
format is set once in `services/dates.ts`.

**Strictness.** TypeScript `strict` plus `strictTemplates`, `noImplicitReturns`, and
`noPropertyAccessFromIndexSignature` are on. Keep them on; don't reach for `any` (it lints
as a warning, which is not an invitation).

## Layout

```
src/app/
  app.ts / app.html / app.config.ts / app.routes.ts
  components/
    topbar/  week/  day/  footer/  week-selector/
  services/
    api.ts          # wire types and the API's address
    app-data.ts     # root-provided signal store
```

`AppData` is the single root-provided store: it reads the week being edited from the API
and writes the whole week back once the edits settle. `api.ts` holds the wire types, which
mirror `noted-api/schemas.py`.
