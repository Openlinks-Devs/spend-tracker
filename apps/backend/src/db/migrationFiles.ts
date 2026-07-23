// Ordered list of migration file names. Only NNN_*.sql files run, sorted by the
// leading number so 010 lands after 002 (lexical sort would misorder them).
export function sortMigrationFileNames(fileNames: string[]): string[] {
  return fileNames
    .filter((fileName) => /^\d+_.*\.sql$/.test(fileName))
    .sort((first, second) => Number(first.split('_')[0]) - Number(second.split('_')[0]))
}
