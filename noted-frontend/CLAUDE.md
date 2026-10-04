# Noted — frontend

Angular 22 SPA. See the root `CLAUDE.md` for the domain model; it matters more than anything here.

## Commands

```bash
npm start     # ng serve, http://localhost:4200
npm run build
npm test      # Vitest
npm run lint  # eslint --fix
npm run format
```

## Stack

- **Angular 22**, standalone components, zoneless. Change detection is OnPush by default, so never write `changeDetection:` in a `@Component` — opting out is a lint error and restating the default is noise.
- **Angular Material** for components, themed from the palette in `src/styles.css` via the `--mat-sys-*` tokens. Add a component's module to a component's `imports`; there is no shared barrel module.
- **Tailwind v4** for layout and spacing, via `@import 'tailwindcss'` in `src/styles.css`. There is no `tailwind.config`; configure in CSS.

## Conventions

**Signals everywhere.** Use `input()` / `output()`, `signal`, `computed`, `linkedSignal`, and `resource` for async. Do not add `@Input()`/`@Output()` decorators, `BehaviorSubject` state, or `ngOnChanges`. RxJS is available but is not the default answer.

**Components** are standalone with a separate `.html` template. One folder per component under `src/app/components/<name>/`, files named `<name>.ts` / `<name>.html`. Class names are plain and undecorated — `Week`, `Day`, `Topbar` — not `WeekComponent`. Selector prefix is `app-`.

**Templates** use built-in control flow (`@if`, `@for`, `@let`), never `*ngIf` / `*ngFor`.

**Imports** of app code are written as `app/components/day/day`, not as deep relative paths; `tsconfig.json` maps `app/*` for it. Prettier sorts imports into groups — the grouping is configured in `.prettierrc.json` and is enforced, so let `npm run format` arrange them.

**Styling.** Every value comes from a scale, never written inline:

- **Colour** from Material's theme, `theme.scss`, generated from the spreadsheet's colours (regenerate it rather than overriding its tokens). The `--app-*` aliases in `styles.css` are the one place that decides which tone plays which part. Only the colours that *mean* something keep literal values there: time in magenta, failure in red.
- **Corners** from Material's shape scale, `--mat-sys-corner-*`; Tailwind's `rounded-*` classes are mapped onto it.
- **Spacing** from Tailwind's scale: `p-2` in a template, `--spacing(2)` in CSS.
- **Text** from Material's type scale, `--mat-sys-label-medium` and the like.

Layout and spacing go in Tailwind classes in the template; anything else in `styles.css`.

Only chrome lives in CSS. Category and project colours come from the API, because they are the user's data and he edits them — read them off `AppData`, never off a stylesheet.

**Tests** sit next to what they cover as `<name>.spec.ts` and are written before the code they describe. Vitest with `TestBed`; components get their inputs through `componentRef.setInput`, and anything touching the API uses `provideHttpClientTesting` rather than a live server. A flushed response needs a turn of the event loop before it reaches the resource that asked for it; `await settle()` from `testing/settle` covers that.

**Icons** are Material Symbols (rounded), and nothing else: `<mat-icon>add</mat-icon>`. The font is served from `node_modules`, not a CDN.

**Dates** are shown with `| date` and no format argument (or an injected `DatePipe`); the format is set once in `services/dates.ts`.

**Browser support:** current Chromium (Edge, Chrome) only. Noted runs locally for one user, so any feature current Chromium ships may be used without fallbacks.

**Strictness.** TypeScript `strict` plus `strictTemplates`, `noImplicitReturns`, and `noPropertyAccessFromIndexSignature` are on. Keep them on; don't reach for `any` (it lints as a warning, which is not an invitation).

## Layout

Components live in `src/app/components/`, services in `src/app/services/`. `AppData` (`services/app-data.ts`) is the single root-provided store: it reads the week being edited from the API and writes the whole week back once the edits settle. `services/api.ts` holds the wire types, which mirror `noted-api/schemas.py`, and the API's address.
