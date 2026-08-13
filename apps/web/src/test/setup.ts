import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

// Register jest-dom's matchers on BOTH expect instances. With `globals: true`
// the global `expect` that test files use is not the same object as the one
// exported by 'vitest', and '@testing-library/jest-dom/vitest' only extends the
// latter. That mismatch is why assertions like toBeInTheDocument failed with
// "Invalid Chai property" even in files that imported the matchers directly.
expect.extend(jestDomMatchers)

const globalExpect = (globalThis as { expect?: typeof expect }).expect
if (globalExpect && globalExpect !== expect) {
  globalExpect.extend(jestDomMatchers)
}
