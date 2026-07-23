import { describe, it, expect } from 'vitest'
import { sortMigrationFileNames } from '../src/db/migrationFiles.js'

describe('sortMigrationFileNames', () => {
  it('keeps only NNN_*.sql files, ordered by numeric prefix', () => {
    const input = ['010_late.sql', '002_auth.sql', 'README.md', '001_init.sql', '.keep']
    expect(sortMigrationFileNames(input)).toEqual([
      '001_init.sql',
      '002_auth.sql',
      '010_late.sql',
    ])
  })
})
