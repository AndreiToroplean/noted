# Noted — frontend

Angular 21 SPA. See the root `CLAUDE.md` for the domain model; it matters more than
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

- **Angular 21**, standalone components, zoneless.
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

**Imports** resolve from `src` (`baseUrl`), so import as `app/components/day/day`, not with
deep relative paths. Prettier sorts imports into groups — the grouping is configured in
`.prettierrc.json` and is enforced, so let `npm run format` arrange them.

**Styling.** Layout and spacing in Tailwind utility classes in the template. Colours come
from the CSS custom properties in `src/styles.css` — those are lifted from the original
spreadsheet and are the app's identity, so pull from them rather than inventing new
values or hardcoding hex. The `--app-*` aliases in that file are the single place that
decides which palette colour plays which UI role; change the mapping there.

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
    app-data.ts     # root-provided signal store
```

`AppData` is the single root-provided store. It currently holds a hardcoded list of weeks
as a placeholder; that goes away once it talks to the API.
