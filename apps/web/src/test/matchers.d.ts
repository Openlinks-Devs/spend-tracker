import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// jest-dom 7 ships an augmentation of `Assertion`, which was vitest 2's
// extension point. Vitest 4 moved it to `Matchers`, so that augmentation now
// declares an interface nothing reads and every toBeInTheDocument call fails
// the typecheck. Augment the interface this vitest version actually uses.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
}
