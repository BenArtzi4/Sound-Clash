# Frontend tests

Most frontend tests are **co-located** with the component they test:

```
frontend/src/hooks/useBuzzer.ts
frontend/src/hooks/useBuzzer.test.ts        ← test next to source

frontend/src/components/BuzzButton.tsx
frontend/src/components/BuzzButton.test.tsx
```

This directory is reserved for **cross-component integration tests** that don't naturally belong next to a single source file (e.g., a test that exercises `useGameChannel` + `useBuzzer` + a router page together with a mocked Supabase client).

If you don't need this, the directory can stay nearly empty.

## Running

```bash
cd frontend
npm test                  # watch mode (vitest)
npm run test:run          # single run
npm run test:coverage     # with coverage
```

## Conventions

- Mock the Supabase client at the boundary (`frontend/src/lib/supabase.ts`); don't reach into Realtime internals.
- Use `@testing-library/react` queries (`getByRole`, `findByText`, …); avoid querying by class or id.
- For async hooks, use `waitFor` with default timeout; don't add `await new Promise(setTimeout, N)`.
- Assert on user-visible behavior, not implementation details.
